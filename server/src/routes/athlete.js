'use strict';
/**
 * The athlete portal.
 *
 * Athlete credentials live in their own table, not in `users`, and the tokens
 * issued here carry a different audience. That separation is the whole point:
 *
 *   - There is no role on an athlete login, so one cannot be promoted into a
 *     coach or an administrator. There is no field to change.
 *   - A staff route rejects an athlete token and this route rejects a staff
 *     token, so a credential from one side is useless on the other.
 *   - Every endpoint reads the athlete's own id from the token. None of them
 *     takes an athlete id as a parameter, so asking for somebody else's record
 *     is not a permission that has been withheld — it is a request that cannot
 *     be expressed.
 *
 * A login is always attached to an athlete who already exists. Nothing here
 * creates a `players` row, so the portal can never introduce a duplicate
 * athlete.
 */
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { z } = require('zod');
const config = require('../config');
const { db, parseJson } = require('../db');
const { audit } = require('../middleware/audit');
const { asyncHandler, ApiError } = require('../middleware/error');
const { playerCareerAllSports, playerSummary } = require('../lib/repo');

const router = express.Router();

const AUDIENCE = 'athlete';

function issueToken(login) {
  return jwt.sign(
    { sub: login.id, aud: AUDIENCE, player: login.player_id },
    config.jwtSecret,
    { expiresIn: config.jwtExpiresIn },
  );
}

/**
 * Resolve the athlete from the bearer token.
 * A staff token fails here because its audience is not `athlete`.
 */
function requireAthlete(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Sign in to continue.' });

  try {
    const payload = jwt.verify(token, config.jwtSecret);
    if (payload.aud !== AUDIENCE) {
      return res.status(403).json({ error: 'That sign-in is not valid for the athlete portal.' });
    }
    const login = db
      .prepare(`SELECT a.*, p.first_name, p.last_name, p.display_name, p.athlete_id, p.photo_url
                FROM athlete_logins a JOIN players p ON p.id = a.player_id WHERE a.id = ?`)
      .get(payload.sub);
    if (!login || login.status !== 'active') {
      return res.status(401).json({ error: 'This account is no longer active. Speak to the club.' });
    }
    req.athlete = login;
    return next();
  } catch {
    return res.status(401).json({ error: 'Sign in to continue.' });
  }
}

const profileOf = (login) => ({
  id: login.id,
  playerId: login.player_id,
  athleteId: login.athlete_id,
  email: login.email,
  name: login.display_name || `${login.first_name} ${login.last_name}`,
  photoUrl: login.photo_url,
  mustChangePassword: !!login.must_change_password,
  // Stated explicitly so a client is never tempted to infer capability from
  // the absence of a role.
  capabilities: ['view own record'],
});

/* ------------------------------------------------------------------ */
/* Sign in                                                            */
/* ------------------------------------------------------------------ */

router.post('/athlete/login', asyncHandler(async (req, res) => {
  const body = z.object({
    email: z.string().min(3),
    password: z.string().min(1),
  }).parse(req.body);

  const login = db
    .prepare(`SELECT a.*, p.first_name, p.last_name, p.display_name, p.athlete_id, p.photo_url
              FROM athlete_logins a JOIN players p ON p.id = a.player_id
              WHERE lower(a.email) = lower(?)`)
    .get(body.email);

  // The same message either way, so this cannot be used to find out which
  // addresses the club holds.
  const ok = login && await bcrypt.compare(body.password, login.password_hash);
  if (!ok) throw new ApiError(401, 'Email or password is incorrect.');
  if (login.status !== 'active') throw new ApiError(403, 'This account is not active. Speak to the club.');

  db.prepare(`UPDATE athlete_logins SET last_login_at = datetime('now') WHERE id = ?`).run(login.id);
  audit(req, { action: 'login', entity: 'athlete_logins', entityId: login.id, summary: `Athlete signed in: ${login.email}` });

  res.json({ token: issueToken(login), athlete: profileOf(login) });
}));

router.get('/athlete/me', requireAthlete, (req, res) => {
  res.json({ athlete: profileOf(req.athlete) });
});

router.post('/athlete/change-password', requireAthlete, asyncHandler(async (req, res) => {
  const body = z.object({
    currentPassword: z.string().min(1),
    newPassword: z.string().min(8, 'Use at least 8 characters'),
  }).parse(req.body);

  const ok = await bcrypt.compare(body.currentPassword, req.athlete.password_hash);
  if (!ok) throw new ApiError(400, 'Your current password is incorrect.');

  db.prepare(`UPDATE athlete_logins SET password_hash = ?, must_change_password = 0,
              updated_at = datetime('now') WHERE id = ?`)
    .run(await bcrypt.hash(body.newPassword, 10), req.athlete.id);

  audit(req, { action: 'update', entity: 'athlete_logins', entityId: req.athlete.id, summary: 'Athlete changed their password' });
  res.json({ ok: true });
}));

/* ------------------------------------------------------------------ */
/* Their own record                                                   */
/* ------------------------------------------------------------------ */

/**
 * The athlete's record. There is no id in this path: the only athlete this
 * can ever return is the one the token belongs to.
 */
router.get('/athlete/record', requireAthlete, (req, res) => {
  const playerId = req.athlete.player_id;
  const player = db.prepare('SELECT * FROM players WHERE id = ?').get(playerId);
  if (!player) throw new ApiError(404, 'That athlete record no longer exists.');

  const teams = db
    .prepare(`SELECT t.id, t.name, t.age_group, t.level, s.name AS sport_name, tm.role, tm.jersey_number,
                     tm.start_date, tm.end_date
              FROM team_memberships tm JOIN teams t ON t.id = tm.team_id JOIN sports s ON s.id = t.sport_id
              WHERE tm.player_id = ? ORDER BY tm.end_date IS NOT NULL, tm.start_date DESC`)
    .all(playerId);

  const upcoming = db
    .prepare(`SELECT m.id, m.scheduled_at, m.venue, m.opponent_name, s.name AS sport_name, t.name AS team_name
              FROM match_players mp JOIN matches m ON m.id = mp.match_id
              JOIN sports s ON s.id = m.sport_id LEFT JOIN teams t ON t.id = m.home_team_id
              WHERE mp.player_id = ? AND m.scheduled_at >= datetime('now')
              ORDER BY m.scheduled_at LIMIT 10`)
    .all(playerId);

  const sessions = db
    .prepare(`SELECT ts.id, ts.session_date, ts.start_time, ts.title, ts.training_type, ts.location,
                     s.name AS sport_name, ta.status
              FROM training_attendance ta JOIN training_sessions ts ON ts.id = ta.session_id
              JOIN sports s ON s.id = ts.sport_id
              WHERE ta.player_id = ? ORDER BY ts.session_date DESC LIMIT 15`)
    .all(playerId);

  res.json({
    athlete: {
      athleteId: player.athlete_id,
      name: player.display_name || `${player.first_name} ${player.last_name}`,
      photoUrl: player.photo_url,
      dob: player.dob,
      nationality: player.nationality,
      status: player.status,
      preferredHand: player.preferred_hand,
      preferredFoot: player.preferred_foot,
      registeredSince: player.registration_date,
    },
    summary: playerSummary(playerId),
    careers: playerCareerAllSports(playerId).map((c) => ({
      sport: c.sport,
      matchesPlayed: c.matchesPlayed,
      headline: c.headline,
      rating: c.rating ? { overall: c.rating.overall } : null,
      career: { groups: c.career.groups },
    })),
    teams,
    upcoming,
    sessions,
    achievements: db
      .prepare(`SELECT a.title, a.category, a.level, a.awarded_date, s.name AS sport_name
                FROM achievements a LEFT JOIN sports s ON s.id = a.sport_id
                WHERE a.player_id = ? ORDER BY a.awarded_date DESC`)
      .all(playerId),
    timeline: db
      .prepare(`SELECT event_date, event_type, title, description, importance FROM player_timeline
                WHERE player_id = ? ORDER BY event_date DESC LIMIT 40`)
      .all(playerId),
  });
});

module.exports = router;
module.exports.requireAthlete = requireAthlete;
module.exports.AUDIENCE = AUDIENCE;
