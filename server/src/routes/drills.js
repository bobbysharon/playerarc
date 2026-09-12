'use strict';
const express = require('express');
const { z } = require('zod');
const { db } = require('../db');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { audit } = require('../middleware/audit');
const { asyncHandler, ApiError } = require('../middleware/error');
const { requireCricketSport } = require('../lib/cricket-scope');

const router = express.Router();

router.get('/', requireAuth, (req, res) => {
  const sport = requireCricketSport(req.query.sport || 'cricket');
  const where = ['sport_id = ?'];
  const params = [sport.id];
  if (req.query.skill_group) { where.push('skill_group = ?'); params.push(req.query.skill_group); }
  if (req.query.active !== 'false') where.push('is_active = 1');
  const drills = db.prepare(`SELECT * FROM drills WHERE ${where.join(' AND ')} ORDER BY skill_group, name`).all(...params);
  res.json({ drills });
});

router.get('/:id', requireAuth, (req, res) => {
  const drill = db.prepare('SELECT * FROM drills WHERE id = ?').get(req.params.id);
  if (!drill) throw new ApiError(404, 'That drill does not exist.');
  res.json({ drill });
});

const drillSchema = z.object({
  sport_id: z.coerce.number().int().optional(),
  name: z.string().min(2),
  skill_group: z.enum(['batting', 'bowling', 'fielding', 'fitness', 'wicket_keeping']),
  age_groups: z.string().optional().nullable(),
  equipment: z.string().optional().nullable(),
  duration_minutes: z.coerce.number().int().min(1).max(240).optional().nullable(),
  description: z.string().optional().nullable(),
  coaching_points: z.string().optional().nullable(),
  is_active: z.coerce.number().int().min(0).max(1).default(1),
});

router.post('/', requirePermission('drills.write'), asyncHandler(async (req, res) => {
  const body = drillSchema.parse(req.body);
  const sport = requireCricketSport(body.sport_id || 'cricket');
  const info = db
    .prepare(`INSERT INTO drills (sport_id, name, skill_group, age_groups, equipment, duration_minutes, description, coaching_points, is_active, created_by)
              VALUES (?,?,?,?,?,?,?,?,?,?)`)
    .run(sport.id, body.name, body.skill_group, body.age_groups ?? null, body.equipment ?? null,
         body.duration_minutes ?? null, body.description ?? null, body.coaching_points ?? null, body.is_active, req.user.id);
  audit(req, { action: 'create', entity: 'drills', entityId: info.lastInsertRowid, summary: `Drill added: ${body.name}` });
  res.status(201).json({ drill: db.prepare('SELECT * FROM drills WHERE id = ?').get(info.lastInsertRowid) });
}));

router.put('/:id', requirePermission('drills.write'), asyncHandler(async (req, res) => {
  const before = db.prepare('SELECT * FROM drills WHERE id = ?').get(req.params.id);
  if (!before) throw new ApiError(404, 'That drill does not exist.');
  requireCricketSport(before.sport_id);
  const body = drillSchema.partial().parse(req.body);
  db.prepare(`UPDATE drills SET name = ?, skill_group = ?, age_groups = ?, equipment = ?, duration_minutes = ?,
              description = ?, coaching_points = ?, is_active = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(body.name ?? before.name, body.skill_group ?? before.skill_group, body.age_groups ?? before.age_groups,
         body.equipment ?? before.equipment, body.duration_minutes ?? before.duration_minutes,
         body.description ?? before.description, body.coaching_points ?? before.coaching_points,
         body.is_active ?? before.is_active, before.id);
  audit(req, { action: 'update', entity: 'drills', entityId: before.id, summary: `Drill updated: ${before.name}` });
  res.json({ drill: db.prepare('SELECT * FROM drills WHERE id = ?').get(before.id) });
}));

router.delete('/:id', requirePermission('drills.write'), asyncHandler(async (req, res) => {
  const before = db.prepare('SELECT * FROM drills WHERE id = ?').get(req.params.id);
  if (!before) throw new ApiError(404, 'That drill does not exist.');
  requireCricketSport(before.sport_id);
  db.prepare('DELETE FROM drills WHERE id = ?').run(before.id);
  audit(req, { action: 'delete', entity: 'drills', entityId: before.id, summary: `Drill removed: ${before.name}` });
  res.json({ ok: true });
}));

module.exports = router;
