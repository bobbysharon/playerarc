'use strict';
const express = require('express');
const crypto = require('crypto');
const { z } = require('zod');
const { db, parseJson, tx } = require('../db');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { audit } = require('../middleware/audit');
const { asyncHandler, ApiError } = require('../middleware/error');
const { allowedPlayerIds, canAccessPlayer, scopeClause } = require('../middleware/scope');
const { redactPlayer, can } = require('../lib/permissions');
const { nextAthleteId } = require('../lib/ids');
const timeline = require('../lib/timeline');
const { getSport, playerCareer, playerCareerAllSports, playerSummary } = require('../lib/repo');
const config = require('../config');

const router = express.Router();

/* ------------------------------------------------------------------ */
/* Listing and search                                                   */
/* ------------------------------------------------------------------ */
router.get('/', requireAuth, (req, res) => {
  const {
    q, sport, team, status, position, ageGroup, level, gender, nationality,
    season, coach, sort = 'name', dir = 'asc', page = 1, pageSize = 25, includeDemo = 'true',
  } = req.query;

  const where = ['1 = 1'];
  const params = [];

  if (q) {
    where.push(`(p.first_name LIKE ? OR p.last_name LIKE ? OR p.display_name LIKE ? OR p.athlete_id LIKE ?)`);
    const like = `%${q}%`;
    params.push(like, like, like, like);
  }
  if (status) { where.push('p.status = ?'); params.push(status); }
  if (gender) { where.push('p.gender = ?'); params.push(gender); }
  if (nationality) { where.push('p.nationality = ?'); params.push(nationality); }
  if (includeDemo === 'false') where.push('p.is_demo = 0');
  if (sport) {
    where.push('EXISTS (SELECT 1 FROM player_sports ps WHERE ps.player_id = p.id AND ps.sport_id = ?)');
    params.push(Number(sport));
  }
  if (position) {
    where.push('EXISTS (SELECT 1 FROM player_sports ps WHERE ps.player_id = p.id AND ps.position = ?)');
    params.push(position);
  }
  if (level) {
    where.push('EXISTS (SELECT 1 FROM player_sports ps WHERE ps.player_id = p.id AND ps.playing_level = ?)');
    params.push(level);
  }
  if (team) {
    where.push('EXISTS (SELECT 1 FROM team_memberships tm WHERE tm.player_id = p.id AND tm.team_id = ? AND tm.end_date IS NULL)');
    params.push(Number(team));
  }
  if (ageGroup) {
    where.push('EXISTS (SELECT 1 FROM team_memberships tm JOIN teams t ON t.id = tm.team_id WHERE tm.player_id = p.id AND t.age_group = ?)');
    params.push(ageGroup);
  }
  if (season) {
    where.push('EXISTS (SELECT 1 FROM team_memberships tm JOIN teams t ON t.id = tm.team_id WHERE tm.player_id = p.id AND t.season_id = ?)');
    params.push(Number(season));
  }
  if (coach) {
    where.push(`EXISTS (SELECT 1 FROM team_memberships tm JOIN teams t ON t.id = tm.team_id
                        WHERE tm.player_id = p.id AND tm.end_date IS NULL AND t.head_coach_id = ?)`);
    params.push(Number(coach));
  }

  const scope = scopeClause('p.id', allowedPlayerIds(req.user));
  const sortMap = {
    name: 'p.last_name, p.first_name',
    athlete_id: 'p.athlete_id',
    registered: 'p.registration_date',
    status: 'p.status',
    dob: 'p.dob',
  };
  const orderBy = sortMap[sort] || sortMap.name;
  const direction = String(dir).toLowerCase() === 'desc' ? 'DESC' : 'ASC';
  const limit = Math.min(Number(pageSize) || 25, 200);
  const offset = (Math.max(Number(page) || 1, 1) - 1) * limit;

  const baseSql = `FROM players p WHERE ${where.join(' AND ')}${scope.sql}`;
  const allParams = [...params, ...scope.params];
  const total = db.prepare(`SELECT COUNT(*) AS c ${baseSql}`).get(...allParams).c;
  const rows = db
    .prepare(`SELECT p.* ${baseSql} ORDER BY ${orderBy} ${direction} LIMIT ? OFFSET ?`)
    .all(...allParams, limit, offset);

  const players = rows.map((row) => {
    const sports = db
      .prepare(`SELECT ps.*, s.name AS sport_name, s.code AS sport_code, s.color
                FROM player_sports ps JOIN sports s ON s.id = ps.sport_id
                WHERE ps.player_id = ? ORDER BY ps.is_primary DESC`)
      .all(row.id);
    const teams = db
      .prepare(`SELECT t.id, t.name, t.age_group FROM team_memberships tm JOIN teams t ON t.id = tm.team_id
                WHERE tm.player_id = ? AND tm.end_date IS NULL`)
      .all(row.id);
    return { ...redactPlayer(row, req.user), sports, teams };
  });

  res.json({ players, total, page: Number(page) || 1, pageSize: limit, pages: Math.ceil(total / limit) });
});

/** Filter values for the search panel, computed from live data. */
router.get('/filters/options', requireAuth, (req, res) => {
  res.json({
    statuses: db.prepare('SELECT DISTINCT status FROM players ORDER BY status').all().map((r) => r.status),
    nationalities: db.prepare('SELECT DISTINCT nationality FROM players WHERE nationality IS NOT NULL ORDER BY nationality').all().map((r) => r.nationality),
    ageGroups: db.prepare('SELECT DISTINCT age_group FROM teams WHERE age_group IS NOT NULL ORDER BY age_group').all().map((r) => r.age_group),
    positions: db.prepare('SELECT DISTINCT position FROM player_sports WHERE position IS NOT NULL ORDER BY position').all().map((r) => r.position),
    levels: ['academy', 'development', 'senior', 'representative', 'recreational'],
  });
});

/* ------------------------------------------------------------------ */
/* Single player                                                        */
/* ------------------------------------------------------------------ */
function loadPlayer(id) {
  const player = db.prepare('SELECT * FROM players WHERE id = ?').get(id);
  if (!player) throw new ApiError(404, 'That athlete record does not exist.');
  return player;
}

function guard(req, playerId) {
  if (!canAccessPlayer(req.user, playerId)) {
    throw new ApiError(403, 'That athlete is outside the teams and sports assigned to you.');
  }
}

router.get('/:id', requireAuth, (req, res) => {
  const player = loadPlayer(req.params.id);
  guard(req, player.id);

  const sports = db
    .prepare(`SELECT ps.*, s.name AS sport_name, s.code AS sport_code, s.color, s.category
              FROM player_sports ps JOIN sports s ON s.id = ps.sport_id
              WHERE ps.player_id = ? ORDER BY ps.is_primary DESC, s.sort_order`)
    .all(player.id);

  const teamHistory = db
    .prepare(`SELECT tm.*, t.name AS team_name, t.age_group, t.level, t.sport_id,
                     s.name AS sport_name, s.color, se.name AS season_name, c.full_name AS coach_name
              FROM team_memberships tm
              JOIN teams t ON t.id = tm.team_id
              JOIN sports s ON s.id = t.sport_id
              LEFT JOIN seasons se ON se.id = t.season_id
              LEFT JOIN coaches c ON c.id = t.head_coach_id
              WHERE tm.player_id = ? ORDER BY tm.start_date DESC`)
    .all(player.id);

  const achievements = db
    .prepare(`SELECT a.*, s.name AS sport_name, t.name AS tournament_name
              FROM achievements a
              LEFT JOIN sports s ON s.id = a.sport_id
              LEFT JOIN tournaments t ON t.id = a.tournament_id
              WHERE a.player_id = ? ORDER BY a.awarded_date DESC`)
    .all(player.id);

  const statusHistory = db.prepare('SELECT * FROM player_status_history WHERE player_id = ? ORDER BY effective_from DESC').all(player.id);
  const attributeHistory = db
    .prepare(`SELECT h.*, s.name AS sport_name FROM player_attribute_history h
              LEFT JOIN sports s ON s.id = h.sport_id WHERE h.player_id = ? ORDER BY h.effective_date DESC LIMIT 50`)
    .all(player.id);

  const staff = db
    .prepare(`SELECT ps.*, c.full_name AS coach_name, c.role AS coach_role, c.qualification, c.photo_url,
                     s.name AS sport_name, s.color
              FROM player_staff ps
              JOIN coaches c ON c.id = ps.coach_id
              LEFT JOIN sports s ON s.id = ps.sport_id
              WHERE ps.player_id = ? ORDER BY ps.end_date IS NOT NULL, ps.start_date DESC`)
    .all(player.id);

  const media = db
    .prepare(`SELECT * FROM media WHERE (player_id = ? OR (owner_type = 'player' AND owner_id = ?)) ORDER BY created_at DESC`)
    .all(player.id, player.id)
    .filter((m) => can(req.user, 'media.approve') || m.is_approved || m.visibility !== 'private');

  const documents = can(req.user, 'documents.read')
    ? db.prepare('SELECT * FROM documents WHERE player_id = ? ORDER BY created_at DESC').all(player.id)
    : [];

  res.json({
    player: redactPlayer(player, req.user),
    sports,
    teamHistory,
    achievements,
    statusHistory,
    attributeHistory,
    staff,
    media,
    documents,
    summary: playerSummary(player.id),
  });
});

/** Career statistics — all sports, or one sport with optional filters. */
router.get('/:id/stats', requireAuth, (req, res) => {
  const player = loadPlayer(req.params.id);
  guard(req, player.id);
  const filters = { seasonId: req.query.season, tournamentId: req.query.tournament, teamId: req.query.team };

  if (req.query.sport) {
    const sport = getSport(String(req.query.sport));
    if (!sport) throw new ApiError(404, 'That sport does not exist.');
    return res.json({ careers: [playerCareer(player.id, sport, { filters })] });
  }
  return res.json({ careers: playerCareerAllSports(player.id, filters) });
});

/** Career timeline, newest first. */
router.get('/:id/timeline', requireAuth, (req, res) => {
  const player = loadPlayer(req.params.id);
  guard(req, player.id);
  const events = db
    .prepare(`SELECT t.*, s.name AS sport_name, s.color FROM player_timeline t
              LEFT JOIN sports s ON s.id = t.sport_id
              WHERE t.player_id = ? ORDER BY t.event_date DESC, t.id DESC`)
    .all(player.id);
  res.json({ events });
});

router.post('/:id/timeline', requirePermission('players.write'), asyncHandler(async (req, res) => {
  const player = loadPlayer(req.params.id);
  guard(req, player.id);
  const schema = z.object({
    event_date: z.string().min(4),
    event_type: z.string().default('note'),
    title: z.string().min(2),
    description: z.string().optional().nullable(),
    sport_id: z.coerce.number().int().optional().nullable(),
    importance: z.coerce.number().int().min(1).max(3).default(2),
  });
  const body = schema.parse(req.body);
  const info = db
    .prepare(`INSERT INTO player_timeline (player_id, event_date, event_type, title, description, sport_id, importance, is_system, created_by)
              VALUES (?,?,?,?,?,?,?,0,?)`)
    .run(player.id, body.event_date, body.event_type, body.title, body.description ?? null, body.sport_id ?? null, body.importance, req.user.id);
  audit(req, { action: 'create', entity: 'player_timeline', entityId: info.lastInsertRowid, summary: `Timeline note for ${player.athlete_id}` });
  res.status(201).json({ ok: true });
}));

/** Recent activity across matches, training, assessments and awards. */
router.get('/:id/activity', requireAuth, (req, res) => {
  const player = loadPlayer(req.params.id);
  guard(req, player.id);
  const limit = Math.min(Number(req.query.limit) || 5, 25);

  const matches = db
    .prepare(`SELECT m.id, m.scheduled_at, m.venue, m.result, m.result_summary, s.name AS sport_name, s.color,
                     t.name AS tournament_name, p.stats_json, p.rating, p.is_motm,
                     ht.name AS home_team_name, at.name AS away_team_name, m.opponent_name
              FROM match_performances p
              JOIN matches m ON m.id = p.match_id
              JOIN sports s ON s.id = m.sport_id
              LEFT JOIN tournaments t ON t.id = m.tournament_id
              LEFT JOIN teams ht ON ht.id = m.home_team_id
              LEFT JOIN teams at ON at.id = m.away_team_id
              WHERE p.player_id = ? ORDER BY m.scheduled_at DESC LIMIT ?`)
    .all(player.id, limit)
    .map((r) => ({ ...r, stats: parseJson(r.stats_json, {}), stats_json: undefined }));

  const training = db
    .prepare(`SELECT ts.id, ts.session_date, ts.training_type, ts.location, ts.duration_minutes,
                     ta.status, ta.performance_score, ta.coach_notes, s.name AS sport_name, tm.name AS team_name
              FROM training_attendance ta
              JOIN training_sessions ts ON ts.id = ta.session_id
              JOIN sports s ON s.id = ts.sport_id
              LEFT JOIN teams tm ON tm.id = ts.team_id
              WHERE ta.player_id = ? ORDER BY ts.session_date DESC LIMIT ?`)
    .all(player.id, limit);

  const assessments = db
    .prepare(`SELECT a.id, a.assessment_date, a.cycle, a.overall_score, a.summary, s.name AS sport_name, c.full_name AS coach_name
              FROM assessments a JOIN sports s ON s.id = a.sport_id
              LEFT JOIN coaches c ON c.id = a.assessed_by
              WHERE a.player_id = ? ORDER BY a.assessment_date DESC LIMIT ?`)
    .all(player.id, limit);

  const achievements = db
    .prepare(`SELECT a.*, s.name AS sport_name FROM achievements a LEFT JOIN sports s ON s.id = a.sport_id
              WHERE a.player_id = ? ORDER BY a.awarded_date DESC LIMIT ?`)
    .all(player.id, limit);

  res.json({ matches, training, assessments, achievements });
});

/* ------------------------------------------------------------------ */
/* Create / update                                                      */
/* ------------------------------------------------------------------ */
const playerSchema = z.object({
  first_name: z.string().min(1, 'First name is required'),
  last_name: z.string().min(1, 'Last name is required'),
  display_name: z.string().optional().nullable(),
  dob: z.string().optional().nullable(),
  gender: z.enum(['male', 'female', 'other']).optional().nullable(),
  nationality: z.string().optional().nullable(),
  photo_url: z.string().optional().nullable(),
  registration_date: z.string().optional(),
  status: z.enum(['active', 'inactive', 'injured', 'on_loan', 'suspended', 'retired', 'alumni', 'trial']).default('active'),
  phone: z.string().optional().nullable(),
  email: z.string().email('Enter a valid email address').optional().nullable().or(z.literal('')),
  address: z.string().optional().nullable(),
  city: z.string().optional().nullable(),
  country: z.string().optional().nullable(),
  emergency_name: z.string().optional().nullable(),
  emergency_phone: z.string().optional().nullable(),
  emergency_relation: z.string().optional().nullable(),
  guardian_name: z.string().optional().nullable(),
  guardian_phone: z.string().optional().nullable(),
  guardian_email: z.string().optional().nullable(),
  height_cm: z.coerce.number().min(50).max(260).optional().nullable(),
  weight_kg: z.coerce.number().min(20).max(250).optional().nullable(),
  preferred_hand: z.enum(['right', 'left', 'both']).optional().nullable(),
  preferred_foot: z.enum(['right', 'left', 'both']).optional().nullable(),
  blood_group: z.string().optional().nullable(),
  bio: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  visibility: z.enum(['public', 'club', 'staff', 'private']).default('club'),
});

const COLUMNS = Object.keys(playerSchema.shape);

router.post('/', requirePermission('players.write'), asyncHandler(async (req, res) => {
  const body = playerSchema.parse(req.body);
  if (body.dob && new Date(body.dob) > new Date()) throw new ApiError(422, 'Date of birth cannot be in the future.');

  const duplicate = db
    .prepare(`SELECT athlete_id FROM players WHERE lower(first_name) = lower(?) AND lower(last_name) = lower(?) AND ifnull(dob,'') = ?`)
    .get(body.first_name, body.last_name, body.dob || '');
  if (duplicate) {
    throw new ApiError(409, `${body.first_name} ${body.last_name} is already registered as ${duplicate.athlete_id}. Add the new sport to that record instead of creating a second one.`);
  }

  const athleteId = nextAthleteId();
  const values = COLUMNS.map((c) => (body[c] === '' ? null : body[c] ?? null));
  const info = db
    .prepare(`INSERT INTO players (athlete_id, ${COLUMNS.join(', ')}, created_by) VALUES (?, ${COLUMNS.map(() => '?').join(', ')}, ?)`)
    .run(athleteId, ...values, req.user.id);

  const id = info.lastInsertRowid;
  const registrationDate = body.registration_date || new Date().toISOString().slice(0, 10);
  db.prepare('INSERT INTO player_status_history (player_id, status, effective_from, reason, changed_by) VALUES (?,?,?,?,?)')
    .run(id, body.status, registrationDate, 'Initial registration', req.user.id);
  timeline.addEvent({
    playerId: id, date: registrationDate, type: 'registration',
    title: 'Registered with Karwan Sports Club',
    description: `Athlete ID ${athleteId} issued.`, importance: 3,
    refTable: 'players', refId: id, userId: req.user.id,
  });

  audit(req, { action: 'create', entity: 'players', entityId: id, summary: `Athlete registered: ${athleteId} ${body.first_name} ${body.last_name}`, after: body });
  res.status(201).json({ player: db.prepare('SELECT * FROM players WHERE id = ?').get(id) });
}));

router.put('/:id', requirePermission('players.write'), asyncHandler(async (req, res) => {
  const before = loadPlayer(req.params.id);
  guard(req, before.id);
  const body = playerSchema.partial().parse(req.body);

  const sets = [];
  const params = [];
  for (const key of COLUMNS) {
    if (key in body) {
      sets.push(`${key} = ?`);
      params.push(body[key] === '' ? null : body[key]);
    }
  }
  if (!sets.length) return res.json({ player: before });

  db.prepare(`UPDATE players SET ${sets.join(', ')}, updated_at = datetime('now') WHERE id = ?`).run(...params, before.id);

  // Status changes are recorded, never silently replaced.
  if (body.status && body.status !== before.status) {
    const today = new Date().toISOString().slice(0, 10);
    db.prepare(`UPDATE player_status_history SET effective_to = ? WHERE player_id = ? AND effective_to IS NULL`).run(today, before.id);
    db.prepare('INSERT INTO player_status_history (player_id, status, effective_from, reason, changed_by) VALUES (?,?,?,?,?)')
      .run(before.id, body.status, today, req.body.status_reason || null, req.user.id);
    timeline.addEvent({
      playerId: before.id, date: today, type: 'status_change',
      title: `Status changed to ${body.status.replace('_', ' ')}`,
      description: req.body.status_reason || null, importance: 2,
      refTable: 'player_status_history', refId: Date.now() % 100000, userId: req.user.id,
    });
  }

  audit(req, { action: 'update', entity: 'players', entityId: before.id, summary: `Athlete updated: ${before.athlete_id}`, before, after: body });
  res.json({ player: db.prepare('SELECT * FROM players WHERE id = ?').get(before.id) });
}));

router.delete('/:id', requirePermission('players.delete'), asyncHandler(async (req, res) => {
  const player = loadPlayer(req.params.id);
  const performances = db.prepare('SELECT COUNT(*) AS c FROM match_performances WHERE player_id = ?').get(player.id).c;
  if (performances > 0 && req.query.force !== 'true') {
    throw new ApiError(409, `${player.athlete_id} has ${performances} performance records. Set the status to retired or alumni instead of deleting the record, or pass force=true to remove it and its history permanently.`);
  }
  db.prepare('DELETE FROM players WHERE id = ?').run(player.id);
  audit(req, { action: 'delete', entity: 'players', entityId: player.id, summary: `Athlete deleted: ${player.athlete_id}`, before: player });
  res.json({ ok: true });
}));

/* ------------------------------------------------------------------ */
/* Player ↔ sport registration                                          */
/* ------------------------------------------------------------------ */
router.post('/:id/sports', requirePermission('players.write'), asyncHandler(async (req, res) => {
  const player = loadPlayer(req.params.id);
  guard(req, player.id);
  const schema = z.object({
    sport_id: z.coerce.number().int(),
    is_primary: z.coerce.number().int().min(0).max(1).default(0),
    position: z.string().optional().nullable(),
    playing_role: z.string().optional().nullable(),
    playing_level: z.enum(['academy', 'development', 'senior', 'representative', 'recreational']).optional().nullable(),
    jersey_number: z.coerce.number().int().min(0).max(999).optional().nullable(),
    joined_date: z.string().optional().nullable(),
    notes: z.string().optional().nullable(),
  });
  const body = schema.parse(req.body);
  const sport = getSport(String(body.sport_id));
  if (!sport) throw new ApiError(404, 'That sport does not exist.');

  const existing = db.prepare('SELECT id FROM player_sports WHERE player_id = ? AND sport_id = ?').get(player.id, sport.id);
  if (existing) throw new ApiError(409, `${player.display_name || player.first_name} is already registered for ${sport.name}.`);

  tx(() => {
    if (body.is_primary) db.prepare('UPDATE player_sports SET is_primary = 0 WHERE player_id = ?').run(player.id);
    db.prepare(`INSERT INTO player_sports (player_id, sport_id, is_primary, position, playing_role, playing_level, jersey_number, joined_date, notes)
                VALUES (?,?,?,?,?,?,?,?,?)`)
      .run(player.id, sport.id, body.is_primary, body.position ?? null, body.playing_role ?? null,
           body.playing_level ?? null, body.jersey_number ?? null, body.joined_date ?? new Date().toISOString().slice(0, 10), body.notes ?? null);
  });

  timeline.addEvent({
    playerId: player.id, date: body.joined_date || new Date().toISOString().slice(0, 10),
    type: 'sport_added', title: `Registered for ${sport.name}`,
    description: body.position ? `Position: ${body.position}` : null,
    sportId: sport.id, refTable: 'player_sports', refId: sport.id, importance: 3, userId: req.user.id,
  });
  audit(req, { action: 'create', entity: 'player_sports', entityId: player.id, summary: `${player.athlete_id} registered for ${sport.name}` });
  res.status(201).json({ ok: true });
}));

router.put('/:id/sports/:sportId', requirePermission('players.write'), asyncHandler(async (req, res) => {
  const player = loadPlayer(req.params.id);
  guard(req, player.id);
  const before = db.prepare('SELECT * FROM player_sports WHERE player_id = ? AND sport_id = ?').get(player.id, req.params.sportId);
  if (!before) throw new ApiError(404, 'That athlete is not registered for this sport.');

  const schema = z.object({
    is_primary: z.coerce.number().int().min(0).max(1).optional(),
    position: z.string().optional().nullable(),
    playing_role: z.string().optional().nullable(),
    playing_level: z.enum(['academy', 'development', 'senior', 'representative', 'recreational']).optional().nullable(),
    jersey_number: z.coerce.number().int().min(0).max(999).optional().nullable(),
    status: z.enum(['active', 'inactive', 'retired']).optional(),
    notes: z.string().optional().nullable(),
  });
  const body = schema.parse(req.body);

  // Position, jersey and level changes are appended to the history log.
  const tracked = ['position', 'playing_level', 'jersey_number'];
  const today = new Date().toISOString().slice(0, 10);
  for (const field of tracked) {
    if (field in body && String(body[field] ?? '') !== String(before[field] ?? '')) {
      db.prepare(`INSERT INTO player_attribute_history (player_id, sport_id, attribute, old_value, new_value, effective_date, changed_by, note)
                  VALUES (?,?,?,?,?,?,?,?)`)
        .run(player.id, before.sport_id, field, before[field] ?? null, body[field] ?? null, today, req.user.id, req.body.change_note || null);
    }
  }

  tx(() => {
    if (body.is_primary) db.prepare('UPDATE player_sports SET is_primary = 0 WHERE player_id = ?').run(player.id);
    const sets = [];
    const params = [];
    for (const [k, v] of Object.entries(body)) {
      sets.push(`${k} = ?`);
      params.push(v === '' ? null : v);
    }
    if (sets.length) {
      db.prepare(`UPDATE player_sports SET ${sets.join(', ')}, updated_at = datetime('now') WHERE id = ?`).run(...params, before.id);
    }
  });

  audit(req, { action: 'update', entity: 'player_sports', entityId: before.id, summary: `Sport profile updated for ${player.athlete_id}`, before, after: body });
  res.json({ ok: true });
}));


/* ------------------------------------------------------------------ */
/* Staff assigned to this athlete                                       */
/* ------------------------------------------------------------------ */
router.post('/:id/staff', requirePermission('players.write'), asyncHandler(async (req, res) => {
  const player = loadPlayer(req.params.id);
  guard(req, player.id);
  const schema = z.object({
    coach_id: z.coerce.number().int(),
    sport_id: z.coerce.number().int().optional().nullable(),
    role: z.enum(['coach', 'assistant_coach', 'personal_trainer', 'fitness_trainer', 'physio', 'mentor', 'specialist']).default('coach'),
    start_date: z.string().optional(),
    notes: z.string().optional().nullable(),
  });
  const body = schema.parse(req.body);

  const coach = db.prepare('SELECT * FROM coaches WHERE id = ?').get(body.coach_id);
  if (!coach) throw new ApiError(404, 'That staff member does not exist.');
  const open = db
    .prepare('SELECT id FROM player_staff WHERE player_id = ? AND coach_id = ? AND role = ? AND end_date IS NULL')
    .get(player.id, coach.id, body.role);
  if (open) throw new ApiError(409, `${coach.full_name} is already assigned to this athlete as ${body.role.replace('_', ' ')}.`);

  const start = body.start_date || new Date().toISOString().slice(0, 10);
  const info = db
    .prepare('INSERT INTO player_staff (player_id, coach_id, sport_id, role, start_date, notes, created_by) VALUES (?,?,?,?,?,?,?)')
    .run(player.id, coach.id, body.sport_id ?? coach.sport_id ?? null, body.role, start, body.notes ?? null, req.user.id);

  timeline.addEvent({
    playerId: player.id, date: start, type: 'note',
    title: `${coach.full_name} assigned as ${body.role.replace('_', ' ')}`,
    sportId: body.sport_id ?? coach.sport_id ?? null,
    refTable: 'player_staff', refId: info.lastInsertRowid, importance: 2, userId: req.user.id,
  });
  audit(req, { action: 'create', entity: 'player_staff', entityId: info.lastInsertRowid, summary: `${coach.full_name} assigned to ${player.athlete_id}` });
  res.status(201).json({ ok: true });
}));

/** Close a staff assignment. The row is kept so the history reads correctly. */
router.put('/:id/staff/:assignmentId', requirePermission('players.write'), asyncHandler(async (req, res) => {
  const player = loadPlayer(req.params.id);
  guard(req, player.id);
  const row = db.prepare('SELECT * FROM player_staff WHERE id = ? AND player_id = ?').get(req.params.assignmentId, player.id);
  if (!row) throw new ApiError(404, 'That assignment does not exist.');

  const schema = z.object({
    end_date: z.string().optional().nullable(),
    role: z.enum(['coach', 'assistant_coach', 'personal_trainer', 'fitness_trainer', 'physio', 'mentor', 'specialist']).optional(),
    notes: z.string().optional().nullable(),
  });
  const body = schema.parse(req.body);
  if (body.end_date && body.end_date < row.start_date) throw new ApiError(422, 'An assignment cannot end before it started.');

  const sets = Object.keys(body).map((k) => `${k} = ?`);
  if (sets.length) {
    db.prepare(`UPDATE player_staff SET ${sets.join(', ')} WHERE id = ?`)
      .run(...Object.values(body).map((v) => (v === '' ? null : v)), row.id);
  }
  audit(req, { action: 'update', entity: 'player_staff', entityId: row.id, summary: `Staff assignment updated for ${player.athlete_id}` });
  res.json({ ok: true });
}));


/* ------------------------------------------------------------------ */
/* Showcase profile — a shareable record for selectors                  */
/* ------------------------------------------------------------------ */

/**
 * Turn the showcase on, off, or reissue its link.
 *
 * The link is what makes the profile reachable, so revoking access means
 * clearing the token rather than hoping nobody kept the URL. Turning the
 * showcase off does exactly that.
 */
router.put('/:id/showcase', requirePermission('players.write'), asyncHandler(async (req, res) => {
  const player = loadPlayer(req.params.id);
  guard(req, player.id);
  const schema = z.object({
    enabled: z.coerce.boolean(),
    headline: z.string().max(280).optional().nullable(),
    regenerate: z.coerce.boolean().default(false),
  });
  const body = schema.parse(req.body);

  let token = player.showcase_token;
  if (!body.enabled) {
    token = null;                                    // the old link stops working
  } else if (!token || body.regenerate) {
    token = crypto.randomBytes(12).toString('base64url');
  }

  db.prepare(`UPDATE players SET showcase_enabled = ?, showcase_token = ?, showcase_headline = ?,
              showcase_updated_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`)
    .run(body.enabled ? 1 : 0, token, body.headline ?? player.showcase_headline ?? null, player.id);

  audit(req, {
    action: 'update', entity: 'players', entityId: player.id,
    summary: `Showcase ${body.enabled ? (body.regenerate ? 'link reissued' : 'enabled') : 'disabled'} for ${player.athlete_id}`,
  });

  res.json({
    enabled: body.enabled,
    token,
    path: token ? `/showcase/${token}` : null,
  });
}));

/**
 * The public showcase. No authentication: the token is the credential.
 *
 * It carries what a selector would want — the career record, honours, current
 * squads and any clips marked as highlights — and nothing that is nobody
 * else's business. Contact details, guardians, documents, assessments and
 * coach notes are all left out by construction rather than by filtering, so a
 * change elsewhere cannot accidentally expose them.
 */
router.get('/showcase/:token', asyncHandler(async (req, res) => {
  const player = db
    .prepare('SELECT * FROM players WHERE showcase_token = ? AND showcase_enabled = 1')
    .get(req.params.token);
  if (!player) throw new ApiError(404, 'That showcase profile is not available. The link may have been withdrawn.');

  const careers = playerCareerAllSports(player.id).map((c) => ({
    sport: c.sport,
    matchesPlayed: c.matchesPlayed,
    headline: c.headline,
    rating: c.rating ? { overall: c.rating.overall, components: c.rating.components } : null,
    career: { groups: c.career.groups },
  }));

  const teams = db
    .prepare(`SELECT t.name, t.age_group, t.level, s.name AS sport_name, tm.start_date, tm.end_date, tm.role
              FROM team_memberships tm JOIN teams t ON t.id = tm.team_id JOIN sports s ON s.id = t.sport_id
              WHERE tm.player_id = ? ORDER BY tm.end_date IS NOT NULL, tm.start_date DESC`)
    .all(player.id);

  const achievements = db
    .prepare(`SELECT a.title, a.category, a.level, a.awarded_date, a.description, s.name AS sport_name, t.name AS tournament_name
              FROM achievements a LEFT JOIN sports s ON s.id = a.sport_id LEFT JOIN tournaments t ON t.id = a.tournament_id
              WHERE a.player_id = ? ORDER BY a.awarded_date DESC`)
    .all(player.id);

  const milestones = db
    .prepare(`SELECT event_date, event_type, title, description FROM player_timeline
              WHERE player_id = ? AND importance = 3 ORDER BY event_date DESC LIMIT 30`)
    .all(player.id);

  audit(req, { action: 'download', entity: 'players', entityId: player.id, summary: `Showcase profile viewed for ${player.athlete_id}` });

  res.json({
    athlete: {
      athleteId: player.athlete_id,
      name: player.display_name || `${player.first_name} ${player.last_name}`,
      headline: player.showcase_headline,
      photoUrl: player.photo_url,
      nationality: player.nationality,
      dob: player.dob,
      preferredHand: player.preferred_hand,
      preferredFoot: player.preferred_foot,
      heightCm: player.height_cm,
      registeredSince: player.registration_date,
      club: config.club.name,
      updatedAt: player.showcase_updated_at,
    },
    summary: playerSummary(player.id),
    careers,
    teams,
    achievements,
    milestones,
  });
}));

module.exports = router;
