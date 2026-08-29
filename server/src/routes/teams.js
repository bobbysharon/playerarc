'use strict';
const express = require('express');
const { z } = require('zod');
const { db } = require('../db');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { audit } = require('../middleware/audit');
const { asyncHandler, ApiError } = require('../middleware/error');
const { allowedTeamIds, canAccessTeam, scopeClause } = require('../middleware/scope');
const timeline = require('../lib/timeline');

const router = express.Router();

router.get('/', requireAuth, (req, res) => {
  const where = ['1 = 1'];
  const params = [];
  if (req.query.sport) { where.push('t.sport_id = ?'); params.push(Number(req.query.sport)); }
  if (req.query.season) { where.push('t.season_id = ?'); params.push(Number(req.query.season)); }
  if (req.query.ageGroup) { where.push('t.age_group = ?'); params.push(req.query.ageGroup); }
  if (req.query.level) { where.push('t.level = ?'); params.push(req.query.level); }
  if (req.query.active === 'true') where.push('t.is_active = 1');
  if (req.query.q) { where.push('t.name LIKE ?'); params.push(`%${req.query.q}%`); }

  const scope = scopeClause('t.id', allowedTeamIds(req.user));
  const rows = db
    .prepare(`SELECT t.*, s.name AS sport_name, s.code AS sport_code, s.color, se.name AS season_name,
                     c.full_name AS coach_name,
                     (SELECT COUNT(*) FROM team_memberships tm WHERE tm.team_id = t.id AND tm.end_date IS NULL) AS squad_size,
                     (SELECT COUNT(*) FROM matches m WHERE m.home_team_id = t.id OR m.away_team_id = t.id) AS match_count
              FROM teams t
              JOIN sports s ON s.id = t.sport_id
              LEFT JOIN seasons se ON se.id = t.season_id
              LEFT JOIN coaches c ON c.id = t.head_coach_id
              WHERE ${where.join(' AND ')}${scope.sql}
              ORDER BY s.sort_order, t.name`)
    .all(...params, ...scope.params);
  res.json({ teams: rows });
});

router.get('/:id', requireAuth, (req, res) => {
  const team = db
    .prepare(`SELECT t.*, s.name AS sport_name, s.code AS sport_code, s.color, se.name AS season_name, c.full_name AS coach_name
              FROM teams t JOIN sports s ON s.id = t.sport_id
              LEFT JOIN seasons se ON se.id = t.season_id
              LEFT JOIN coaches c ON c.id = t.head_coach_id WHERE t.id = ?`)
    .get(req.params.id);
  if (!team) throw new ApiError(404, 'That team does not exist.');
  if (!canAccessTeam(req.user, team.id)) throw new ApiError(403, 'That team is not assigned to you.');

  const roster = db
    .prepare(`SELECT tm.*, p.athlete_id, p.first_name, p.last_name, p.display_name, p.photo_url, p.status AS player_status,
                     ps.position, ps.playing_role
              FROM team_memberships tm
              JOIN players p ON p.id = tm.player_id
              LEFT JOIN player_sports ps ON ps.player_id = p.id AND ps.sport_id = ?
              WHERE tm.team_id = ? ORDER BY tm.end_date IS NOT NULL, p.last_name`)
    .all(team.sport_id, team.id);

  const matches = db
    .prepare(`SELECT m.*, t.name AS tournament_name, ht.name AS home_team_name, at.name AS away_team_name
              FROM matches m
              LEFT JOIN tournaments t ON t.id = m.tournament_id
              LEFT JOIN teams ht ON ht.id = m.home_team_id
              LEFT JOIN teams at ON at.id = m.away_team_id
              WHERE m.home_team_id = ? OR m.away_team_id = ? ORDER BY m.scheduled_at DESC`)
    .all(team.id, team.id);

  const training = db
    .prepare(`SELECT ts.*, c.full_name AS coach_name,
                     (SELECT COUNT(*) FROM training_attendance ta WHERE ta.session_id = ts.id AND ta.status IN ('present','late')) AS attended,
                     (SELECT COUNT(*) FROM training_attendance ta WHERE ta.session_id = ts.id) AS invited
              FROM training_sessions ts LEFT JOIN coaches c ON c.id = ts.coach_id
              WHERE ts.team_id = ? ORDER BY ts.session_date DESC LIMIT 20`)
    .all(team.id);

  const record = {
    played: matches.filter((m) => m.status === 'completed').length,
    won: matches.filter((m) => m.status === 'completed' && m.winner_team_id === team.id).length,
  };
  record.lost = matches.filter((m) => m.status === 'completed' && m.winner_team_id && m.winner_team_id !== team.id).length;
  record.drawn = record.played - record.won - record.lost;

  res.json({ team, roster, matches, training, record });
});

const teamSchema = z.object({
  name: z.string().min(2),
  code: z.string().optional().nullable(),
  sport_id: z.coerce.number().int(),
  age_group: z.string().optional().nullable(),
  gender: z.enum(['male', 'female', 'mixed']).default('male'),
  level: z.enum(['academy', 'development', 'senior', 'representative', 'recreational']).default('academy'),
  season_id: z.coerce.number().int().optional().nullable(),
  head_coach_id: z.coerce.number().int().optional().nullable(),
  home_venue: z.string().optional().nullable(),
  description: z.string().optional().nullable(),
  is_active: z.coerce.number().int().min(0).max(1).default(1),
});

router.post('/', requirePermission('teams.write'), asyncHandler(async (req, res) => {
  const body = teamSchema.parse(req.body);
  const cols = Object.keys(body);
  const info = db
    .prepare(`INSERT INTO teams (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`)
    .run(...cols.map((c) => body[c] ?? null));
  if (body.head_coach_id) {
    db.prepare('INSERT OR IGNORE INTO team_coaches (team_id, coach_id, role) VALUES (?,?,?)').run(info.lastInsertRowid, body.head_coach_id, 'head_coach');
  }
  audit(req, { action: 'create', entity: 'teams', entityId: info.lastInsertRowid, summary: `Team created: ${body.name}` });
  res.status(201).json({ team: db.prepare('SELECT * FROM teams WHERE id = ?').get(info.lastInsertRowid) });
}));

router.put('/:id', requirePermission('teams.write'), asyncHandler(async (req, res) => {
  const before = db.prepare('SELECT * FROM teams WHERE id = ?').get(req.params.id);
  if (!before) throw new ApiError(404, 'That team does not exist.');
  if (!canAccessTeam(req.user, before.id)) throw new ApiError(403, 'That team is not assigned to you.');
  const body = teamSchema.partial().parse(req.body);
  const sets = Object.keys(body).map((k) => `${k} = ?`);
  if (sets.length) {
    db.prepare(`UPDATE teams SET ${sets.join(', ')}, updated_at = datetime('now') WHERE id = ?`)
      .run(...Object.values(body).map((v) => (v === '' ? null : v)), before.id);
  }
  audit(req, { action: 'update', entity: 'teams', entityId: before.id, summary: `Team updated: ${before.name}`, before, after: body });
  res.json({ team: db.prepare('SELECT * FROM teams WHERE id = ?').get(before.id) });
}));

/* ---- Roster -------------------------------------------------------- */
router.post('/:id/members', requirePermission('teams.write'), asyncHandler(async (req, res) => {
  const team = db.prepare('SELECT * FROM teams WHERE id = ?').get(req.params.id);
  if (!team) throw new ApiError(404, 'That team does not exist.');
  if (!canAccessTeam(req.user, team.id)) throw new ApiError(403, 'That team is not assigned to you.');

  const schema = z.object({
    player_id: z.coerce.number().int(),
    role: z.enum(['player', 'captain', 'vice_captain', 'wicket_keeper', 'goalkeeper']).default('player'),
    jersey_number: z.coerce.number().int().min(0).max(999).optional().nullable(),
    start_date: z.string().optional(),
    notes: z.string().optional().nullable(),
  });
  const body = schema.parse(req.body);
  const player = db.prepare('SELECT * FROM players WHERE id = ?').get(body.player_id);
  if (!player) throw new ApiError(404, 'That athlete does not exist.');

  const open = db.prepare('SELECT id FROM team_memberships WHERE team_id = ? AND player_id = ? AND end_date IS NULL').get(team.id, player.id);
  if (open) throw new ApiError(409, `${player.first_name} ${player.last_name} is already on this roster.`);

  if (body.jersey_number != null) {
    const clash = db
      .prepare('SELECT p.first_name, p.last_name FROM team_memberships tm JOIN players p ON p.id = tm.player_id WHERE tm.team_id = ? AND tm.jersey_number = ? AND tm.end_date IS NULL')
      .get(team.id, body.jersey_number);
    if (clash) throw new ApiError(409, `Jersey ${body.jersey_number} is already worn by ${clash.first_name} ${clash.last_name}.`);
  }

  // Registering for the team also registers the player for the sport.
  const registered = db.prepare('SELECT id FROM player_sports WHERE player_id = ? AND sport_id = ?').get(player.id, team.sport_id);
  if (!registered) {
    const isFirst = db.prepare('SELECT COUNT(*) AS c FROM player_sports WHERE player_id = ?').get(player.id).c === 0;
    db.prepare('INSERT INTO player_sports (player_id, sport_id, is_primary, joined_date) VALUES (?,?,?,?)')
      .run(player.id, team.sport_id, isFirst ? 1 : 0, body.start_date || new Date().toISOString().slice(0, 10));
  }

  const start = body.start_date || new Date().toISOString().slice(0, 10);
  const info = db
    .prepare('INSERT INTO team_memberships (team_id, player_id, role, jersey_number, start_date, notes) VALUES (?,?,?,?,?,?)')
    .run(team.id, player.id, body.role, body.jersey_number ?? null, start, body.notes ?? null);

  timeline.addEvent({
    playerId: player.id, date: start, type: 'team_joined',
    title: `Joined ${team.name}`,
    description: [team.age_group, body.role !== 'player' ? body.role.replace('_', ' ') : null].filter(Boolean).join(' · ') || null,
    sportId: team.sport_id, refTable: 'team_memberships', refId: info.lastInsertRowid, importance: 3, userId: req.user.id,
  });
  audit(req, { action: 'create', entity: 'team_memberships', entityId: info.lastInsertRowid, summary: `${player.athlete_id} added to ${team.name}` });
  res.status(201).json({ ok: true });
}));

/** Close a membership. History is preserved — nothing is deleted. */
router.put('/:id/members/:membershipId', requirePermission('teams.write'), asyncHandler(async (req, res) => {
  const membership = db.prepare('SELECT * FROM team_memberships WHERE id = ? AND team_id = ?').get(req.params.membershipId, req.params.id);
  if (!membership) throw new ApiError(404, 'That roster entry does not exist.');
  const team = db.prepare('SELECT * FROM teams WHERE id = ?').get(membership.team_id);
  if (!canAccessTeam(req.user, team.id)) throw new ApiError(403, 'That team is not assigned to you.');

  const schema = z.object({
    role: z.enum(['player', 'captain', 'vice_captain', 'wicket_keeper', 'goalkeeper']).optional(),
    jersey_number: z.coerce.number().int().min(0).max(999).optional().nullable(),
    end_date: z.string().optional().nullable(),
    status: z.enum(['active', 'ended', 'transferred', 'promoted']).optional(),
    notes: z.string().optional().nullable(),
  });
  const body = schema.parse(req.body);
  if (body.end_date && body.end_date < membership.start_date) {
    throw new ApiError(422, 'A membership cannot end before it started.');
  }

  const sets = Object.keys(body).map((k) => `${k} = ?`);
  if (sets.length) {
    db.prepare(`UPDATE team_memberships SET ${sets.join(', ')} WHERE id = ?`)
      .run(...Object.values(body).map((v) => (v === '' ? null : v)), membership.id);
  }

  if (body.end_date && !membership.end_date) {
    const player = db.prepare('SELECT * FROM players WHERE id = ?').get(membership.player_id);
    timeline.addEvent({
      playerId: player.id, date: body.end_date,
      type: body.status === 'promoted' ? 'promotion' : 'team_left',
      title: body.status === 'promoted' ? `Promoted from ${team.name}` : `Left ${team.name}`,
      sportId: team.sport_id, refTable: 'team_memberships_end', refId: membership.id, importance: 2, userId: req.user.id,
    });
  }
  audit(req, { action: 'update', entity: 'team_memberships', entityId: membership.id, summary: `Roster updated for ${team.name}`, before: membership, after: body });
  res.json({ ok: true });
}));

module.exports = router;
