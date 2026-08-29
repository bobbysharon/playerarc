'use strict';
const express = require('express');
const { z } = require('zod');
const { db } = require('../db');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { audit } = require('../middleware/audit');
const { asyncHandler, ApiError } = require('../middleware/error');
const { canAccessPlayer } = require('../middleware/scope');
const timeline = require('../lib/timeline');

const router = express.Router();

router.get('/', requireAuth, (req, res) => {
  const where = ['1 = 1'];
  const params = [];
  if (req.query.player) { where.push('a.player_id = ?'); params.push(Number(req.query.player)); }
  if (req.query.sport) { where.push('a.sport_id = ?'); params.push(Number(req.query.sport)); }
  if (req.query.category) { where.push('a.category = ?'); params.push(req.query.category); }
  if (req.query.tournament) { where.push('a.tournament_id = ?'); params.push(Number(req.query.tournament)); }
  if (req.query.from) { where.push('a.awarded_date >= ?'); params.push(req.query.from); }

  const achievements = db
    .prepare(`SELECT a.*, p.athlete_id, p.first_name, p.last_name, p.display_name, p.photo_url,
                     s.name AS sport_name, s.color, t.name AS tournament_name, tm.name AS team_name
              FROM achievements a
              JOIN players p ON p.id = a.player_id
              LEFT JOIN sports s ON s.id = a.sport_id
              LEFT JOIN tournaments t ON t.id = a.tournament_id
              LEFT JOIN teams tm ON tm.id = a.team_id
              WHERE ${where.join(' AND ')} ORDER BY a.awarded_date DESC LIMIT ?`)
    .all(...params, Math.min(Number(req.query.limit) || 100, 500));
  res.json({ achievements });
});

const schema = z.object({
  player_id: z.coerce.number().int(),
  title: z.string().min(2),
  category: z.enum(['match', 'tournament', 'season', 'academy', 'selection', 'representative', 'milestone', 'coach_award']).default('match'),
  level: z.enum(['club', 'district', 'state', 'national', 'international']).default('club'),
  sport_id: z.coerce.number().int().optional().nullable(),
  tournament_id: z.coerce.number().int().optional().nullable(),
  match_id: z.coerce.number().int().optional().nullable(),
  team_id: z.coerce.number().int().optional().nullable(),
  awarded_date: z.string().min(8),
  description: z.string().optional().nullable(),
});

router.post('/', requirePermission('achievements.write'), asyncHandler(async (req, res) => {
  const body = schema.parse(req.body);
  const player = db.prepare('SELECT * FROM players WHERE id = ?').get(body.player_id);
  if (!player) throw new ApiError(404, 'That athlete does not exist.');
  if (!canAccessPlayer(req.user, player.id)) throw new ApiError(403, 'That athlete is outside your assigned teams.');
  if (new Date(body.awarded_date) > new Date()) throw new ApiError(422, 'An award cannot be dated in the future.');

  const cols = Object.keys(body);
  const info = db.prepare(`INSERT INTO achievements (${cols.join(',')}, created_by) VALUES (${cols.map(() => '?').join(',')}, ?)`)
    .run(...cols.map((c) => body[c] ?? null), req.user.id);

  timeline.addEvent({
    playerId: player.id, date: body.awarded_date, type: 'achievement', title: body.title,
    description: body.description || null, sportId: body.sport_id ?? null,
    refTable: 'achievements', refId: info.lastInsertRowid, importance: 3, userId: req.user.id,
  });
  audit(req, { action: 'create', entity: 'achievements', entityId: info.lastInsertRowid, summary: `Award recorded for ${player.athlete_id}: ${body.title}` });
  res.status(201).json({ achievement: db.prepare('SELECT * FROM achievements WHERE id = ?').get(info.lastInsertRowid) });
}));

router.delete('/:id', requirePermission('achievements.write'), asyncHandler(async (req, res) => {
  const row = db.prepare('SELECT * FROM achievements WHERE id = ?').get(req.params.id);
  if (!row) throw new ApiError(404, 'That award does not exist.');
  db.prepare('DELETE FROM achievements WHERE id = ?').run(row.id);
  timeline.removeEvent('achievements', row.id);
  audit(req, { action: 'delete', entity: 'achievements', entityId: row.id, summary: `Award removed: ${row.title}`, before: row });
  res.json({ ok: true });
}));

module.exports = router;
