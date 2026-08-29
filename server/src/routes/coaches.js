'use strict';
const express = require('express');
const { z } = require('zod');
const { db } = require('../db');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { audit } = require('../middleware/audit');
const { asyncHandler, ApiError } = require('../middleware/error');

const router = express.Router();

router.get('/', requireAuth, (req, res) => {
  const where = ['1 = 1'];
  const params = [];
  if (req.query.sport) { where.push('c.sport_id = ?'); params.push(Number(req.query.sport)); }
  if (req.query.active === 'true') where.push('c.is_active = 1');
  if (req.query.q) { where.push('c.full_name LIKE ?'); params.push(`%${req.query.q}%`); }
  const coaches = db
    .prepare(`SELECT c.*, s.name AS sport_name, s.color,
                     (SELECT COUNT(*) FROM teams t WHERE t.head_coach_id = c.id) AS team_count,
                     (SELECT COUNT(*) FROM training_sessions ts WHERE ts.coach_id = c.id) AS session_count
              FROM coaches c LEFT JOIN sports s ON s.id = c.sport_id
              WHERE ${where.join(' AND ')} ORDER BY c.full_name`)
    .all(...params);
  res.json({ coaches });
});

router.get('/:id', requireAuth, (req, res) => {
  const coach = db
    .prepare('SELECT c.*, s.name AS sport_name FROM coaches c LEFT JOIN sports s ON s.id = c.sport_id WHERE c.id = ?')
    .get(req.params.id);
  if (!coach) throw new ApiError(404, 'That coach does not exist.');
  const teams = db.prepare('SELECT t.*, s.name AS sport_name FROM teams t JOIN sports s ON s.id = t.sport_id WHERE t.head_coach_id = ?').all(coach.id);
  const sessions = db
    .prepare(`SELECT ts.*, t.name AS team_name FROM training_sessions ts LEFT JOIN teams t ON t.id = ts.team_id
              WHERE ts.coach_id = ? ORDER BY ts.session_date DESC LIMIT 20`)
    .all(coach.id);
  const assessments = db
    .prepare(`SELECT a.*, p.athlete_id, p.first_name, p.last_name FROM assessments a JOIN players p ON p.id = a.player_id
              WHERE a.assessed_by = ? ORDER BY a.assessment_date DESC LIMIT 20`)
    .all(coach.id);
  const playerIds = db
    .prepare(`SELECT DISTINCT tm.player_id FROM team_memberships tm JOIN teams t ON t.id = tm.team_id
              WHERE t.head_coach_id = ? AND tm.end_date IS NULL`)
    .all(coach.id).map((r) => r.player_id);
  res.json({ coach, teams, sessions, assessments, playerCount: playerIds.length });
});

const coachSchema = z.object({
  full_name: z.string().min(2),
  user_id: z.coerce.number().int().optional().nullable(),
  sport_id: z.coerce.number().int().optional().nullable(),
  role: z.enum(['head_coach', 'assistant_coach', 'specialist', 'fitness_trainer', 'physio', 'academy_coach']).default('head_coach'),
  qualification: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
  email: z.string().optional().nullable(),
  photo_url: z.string().optional().nullable(),
  bio: z.string().optional().nullable(),
  joined_date: z.string().optional().nullable(),
  is_active: z.coerce.number().int().min(0).max(1).default(1),
});

router.post('/', requirePermission('coaches.write'), asyncHandler(async (req, res) => {
  const body = coachSchema.parse(req.body);
  const cols = Object.keys(body);
  const info = db.prepare(`INSERT INTO coaches (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`)
    .run(...cols.map((c) => body[c] ?? null));
  audit(req, { action: 'create', entity: 'coaches', entityId: info.lastInsertRowid, summary: `Coach added: ${body.full_name}` });
  res.status(201).json({ coach: db.prepare('SELECT * FROM coaches WHERE id = ?').get(info.lastInsertRowid) });
}));

router.put('/:id', requirePermission('coaches.write'), asyncHandler(async (req, res) => {
  const before = db.prepare('SELECT * FROM coaches WHERE id = ?').get(req.params.id);
  if (!before) throw new ApiError(404, 'That coach does not exist.');
  const body = coachSchema.partial().parse(req.body);
  const sets = Object.keys(body).map((k) => `${k} = ?`);
  if (sets.length) {
    db.prepare(`UPDATE coaches SET ${sets.join(', ')}, updated_at = datetime('now') WHERE id = ?`)
      .run(...Object.values(body).map((v) => (v === '' ? null : v)), before.id);
  }
  audit(req, { action: 'update', entity: 'coaches', entityId: before.id, summary: `Coach updated: ${before.full_name}`, before, after: body });
  res.json({ coach: db.prepare('SELECT * FROM coaches WHERE id = ?').get(before.id) });
}));

module.exports = router;
