'use strict';
const express = require('express');
const { z } = require('zod');
const { db, parseJson, tx } = require('../db');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { audit } = require('../middleware/audit');
const { asyncHandler, ApiError } = require('../middleware/error');
const { canAccessTeam, allowedTeamIds, scopeClause } = require('../middleware/scope');

const router = express.Router();

router.get('/', requireAuth, (req, res) => {
  const where = ['1 = 1'];
  const params = [];
  if (req.query.sport) { where.push('ts.sport_id = ?'); params.push(Number(req.query.sport)); }
  if (req.query.team) { where.push('ts.team_id = ?'); params.push(Number(req.query.team)); }
  if (req.query.coach) { where.push('ts.coach_id = ?'); params.push(Number(req.query.coach)); }
  if (req.query.type) { where.push('ts.training_type = ?'); params.push(req.query.type); }
  if (req.query.from) { where.push('ts.session_date >= ?'); params.push(req.query.from); }
  if (req.query.to) { where.push('ts.session_date <= ?'); params.push(req.query.to); }

  const scope = scopeClause('ts.team_id', allowedTeamIds(req.user));
  const sessions = db
    .prepare(`SELECT ts.*, s.name AS sport_name, s.color, t.name AS team_name, c.full_name AS coach_name,
                     (SELECT COUNT(*) FROM training_attendance ta WHERE ta.session_id = ts.id) AS invited,
                     (SELECT COUNT(*) FROM training_attendance ta WHERE ta.session_id = ts.id AND ta.status IN ('present','late')) AS attended
              FROM training_sessions ts
              JOIN sports s ON s.id = ts.sport_id
              LEFT JOIN teams t ON t.id = ts.team_id
              LEFT JOIN coaches c ON c.id = ts.coach_id
              WHERE ${where.join(' AND ')}${scope.sql}
              ORDER BY ts.session_date DESC, ts.start_time DESC LIMIT ?`)
    .all(...params, ...scope.params, Math.min(Number(req.query.limit) || 100, 500));
  res.json({ sessions: sessions.map((s) => ({ ...s, exercises: parseJson(s.exercises_json, []), skills: parseJson(s.skills_json, []) })) });
});

router.get('/:id', requireAuth, (req, res) => {
  const row = db
    .prepare(`SELECT ts.*, s.name AS sport_name, s.code AS sport_code, t.name AS team_name, c.full_name AS coach_name
              FROM training_sessions ts JOIN sports s ON s.id = ts.sport_id
              LEFT JOIN teams t ON t.id = ts.team_id LEFT JOIN coaches c ON c.id = ts.coach_id WHERE ts.id = ?`)
    .get(req.params.id);
  if (!row) throw new ApiError(404, 'That training session does not exist.');
  const attendance = db
    .prepare(`SELECT ta.*, p.athlete_id, p.first_name, p.last_name, p.display_name, p.photo_url
              FROM training_attendance ta JOIN players p ON p.id = ta.player_id
              WHERE ta.session_id = ? ORDER BY p.last_name`)
    .all(row.id);
  res.json({
    session: { ...row, exercises: parseJson(row.exercises_json, []), skills: parseJson(row.skills_json, []) },
    attendance,
  });
});

const sessionSchema = z.object({
  sport_id: z.coerce.number().int(),
  team_id: z.coerce.number().int().optional().nullable(),
  coach_id: z.coerce.number().int().optional().nullable(),
  title: z.string().optional().nullable(),
  session_date: z.string().min(8),
  start_time: z.string().optional().nullable(),
  duration_minutes: z.coerce.number().int().min(5).max(600).default(90),
  training_type: z.enum(['technical', 'tactical', 'fitness', 'strength', 'skills', 'match_practice', 'recovery', 'video_analysis']).default('technical'),
  location: z.string().optional().nullable(),
  objectives: z.string().optional().nullable(),
  exercises: z.array(z.any()).optional(),
  skills: z.array(z.any()).optional(),
  coach_notes: z.string().optional().nullable(),
  areas_for_improvement: z.string().optional().nullable(),
  intensity: z.coerce.number().int().min(1).max(10).optional().nullable(),
});

router.post('/', requirePermission('training.write'), asyncHandler(async (req, res) => {
  const body = sessionSchema.parse(req.body);
  if (body.team_id && !canAccessTeam(req.user, body.team_id)) throw new ApiError(403, 'That team is not assigned to you.');
  if (new Date(body.session_date) > new Date(Date.now() + 365 * 864e5)) throw new ApiError(422, 'That date is too far in the future.');

  const info = db
    .prepare(`INSERT INTO training_sessions (sport_id, team_id, coach_id, title, session_date, start_time, duration_minutes,
              training_type, location, objectives, exercises_json, skills_json, coach_notes, areas_for_improvement, intensity, created_by)
              VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(body.sport_id, body.team_id ?? null, body.coach_id ?? req.user.coachId ?? null, body.title ?? null,
         body.session_date, body.start_time ?? null, body.duration_minutes, body.training_type, body.location ?? null,
         body.objectives ?? null, JSON.stringify(body.exercises || []), JSON.stringify(body.skills || []),
         body.coach_notes ?? null, body.areas_for_improvement ?? null, body.intensity ?? null, req.user.id);

  const sessionId = info.lastInsertRowid;

  // Pre-fill the attendance sheet from the current roster so a coach only has
  // to mark the exceptions.
  if (body.team_id) {
    const roster = db.prepare('SELECT player_id FROM team_memberships WHERE team_id = ? AND end_date IS NULL').all(body.team_id);
    const stmt = db.prepare('INSERT OR IGNORE INTO training_attendance (session_id, player_id, status) VALUES (?,?,?)');
    tx(() => roster.forEach((r) => stmt.run(sessionId, r.player_id, 'present')));
  }

  audit(req, { action: 'create', entity: 'training_sessions', entityId: sessionId, summary: `Training session on ${body.session_date}` });
  res.status(201).json({ session: db.prepare('SELECT * FROM training_sessions WHERE id = ?').get(sessionId) });
}));

router.put('/:id', requirePermission('training.write'), asyncHandler(async (req, res) => {
  const before = db.prepare('SELECT * FROM training_sessions WHERE id = ?').get(req.params.id);
  if (!before) throw new ApiError(404, 'That training session does not exist.');
  if (before.team_id && !canAccessTeam(req.user, before.team_id)) throw new ApiError(403, 'That team is not assigned to you.');
  const body = sessionSchema.partial().parse(req.body);

  const map = { ...body };
  if ('exercises' in map) { map.exercises_json = JSON.stringify(map.exercises); delete map.exercises; }
  if ('skills' in map) { map.skills_json = JSON.stringify(map.skills); delete map.skills; }
  const sets = Object.keys(map).map((k) => `${k} = ?`);
  if (sets.length) {
    db.prepare(`UPDATE training_sessions SET ${sets.join(', ')}, updated_at = datetime('now') WHERE id = ?`)
      .run(...Object.values(map).map((v) => (v === '' ? null : v)), before.id);
  }
  audit(req, { action: 'update', entity: 'training_sessions', entityId: before.id, summary: `Training session updated (#${before.id})`, before, after: body });
  res.json({ ok: true });
}));

router.put('/:id/attendance', requirePermission('training.write'), asyncHandler(async (req, res) => {
  const session = db.prepare('SELECT * FROM training_sessions WHERE id = ?').get(req.params.id);
  if (!session) throw new ApiError(404, 'That training session does not exist.');
  if (session.team_id && !canAccessTeam(req.user, session.team_id)) throw new ApiError(403, 'That team is not assigned to you.');

  const schema = z.object({
    attendance: z.array(z.object({
      player_id: z.coerce.number().int(),
      status: z.enum(['present', 'absent', 'late', 'excused', 'injured']).default('present'),
      arrival_time: z.string().optional().nullable(),
      performance_score: z.coerce.number().min(0).max(10).optional().nullable(),
      effort_score: z.coerce.number().min(0).max(10).optional().nullable(),
      coach_notes: z.string().optional().nullable(),
      areas_for_improvement: z.string().optional().nullable(),
    })),
  });
  const { attendance } = schema.parse(req.body);

  const stmt = db.prepare(`
    INSERT INTO training_attendance (session_id, player_id, status, arrival_time, performance_score, effort_score, coach_notes, areas_for_improvement)
    VALUES (@session_id, @player_id, @status, @arrival_time, @performance_score, @effort_score, @coach_notes, @areas_for_improvement)
    ON CONFLICT(session_id, player_id) DO UPDATE SET
      status = excluded.status, arrival_time = excluded.arrival_time, performance_score = excluded.performance_score,
      effort_score = excluded.effort_score, coach_notes = excluded.coach_notes, areas_for_improvement = excluded.areas_for_improvement
  `);
  tx(() => attendance.forEach((a) => stmt.run({
    session_id: session.id,
    player_id: a.player_id,
    status: a.status,
    arrival_time: a.arrival_time ?? null,
    performance_score: a.performance_score ?? null,
    effort_score: a.effort_score ?? null,
    coach_notes: a.coach_notes ?? null,
    areas_for_improvement: a.areas_for_improvement ?? null,
  })));

  audit(req, { action: 'update', entity: 'training_attendance', entityId: session.id, summary: `Attendance recorded for session #${session.id} (${attendance.length} athletes)` });
  res.json({ ok: true, saved: attendance.length });
}));

/** Attendance and training-load trend for one athlete. */
router.get('/player/:playerId/summary', requireAuth, (req, res) => {
  const rows = db
    .prepare(`SELECT ts.session_date, ts.training_type, ts.duration_minutes, ta.status, ta.performance_score, ta.effort_score,
                     s.name AS sport_name
              FROM training_attendance ta JOIN training_sessions ts ON ts.id = ta.session_id
              JOIN sports s ON s.id = ts.sport_id
              WHERE ta.player_id = ? ORDER BY ts.session_date`)
    .all(req.params.playerId);
  const attended = rows.filter((r) => r.status === 'present' || r.status === 'late').length;
  const byType = {};
  for (const r of rows) byType[r.training_type] = (byType[r.training_type] || 0) + 1;
  res.json({
    sessions: rows.length,
    attended,
    attendanceRate: rows.length ? Math.round((attended / rows.length) * 1000) / 10 : 0,
    minutes: rows.filter((r) => r.status !== 'absent').reduce((a, r) => a + (r.duration_minutes || 0), 0),
    byType,
    trend: rows.filter((r) => r.performance_score != null).map((r) => ({ date: r.session_date, value: r.performance_score })),
  });
});

module.exports = router;
