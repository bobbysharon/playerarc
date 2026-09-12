'use strict';
const express = require('express');
const { z } = require('zod');
const { db, tx } = require('../db');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { audit } = require('../middleware/audit');
const { asyncHandler, ApiError } = require('../middleware/error');
const { requireCricketSport } = require('../lib/cricket-scope');
const { canAccessPlayer } = require('../middleware/scope');

const router = express.Router();

function withMembers(group) {
  const members = db
    .prepare(`SELECT p.id, p.athlete_id, p.first_name, p.last_name, p.display_name, p.photo_url
              FROM player_group_members m JOIN players p ON p.id = m.player_id
              WHERE m.group_id = ? ORDER BY p.last_name`)
    .all(group.id);
  return { ...group, members, memberCount: members.length };
}

router.get('/', requireAuth, (req, res) => {
  const sport = requireCricketSport(req.query.sport || 'cricket');
  const where = ['sport_id = ?'];
  const params = [sport.id];
  if (req.query.active !== 'false') where.push('is_active = 1');
  const groups = db.prepare(`SELECT * FROM player_groups WHERE ${where.join(' AND ')} ORDER BY name`).all(...params);
  res.json({ groups: groups.map(withMembers) });
});

router.get('/:id', requireAuth, (req, res) => {
  const group = db.prepare('SELECT * FROM player_groups WHERE id = ?').get(req.params.id);
  if (!group) throw new ApiError(404, 'That group does not exist.');
  res.json({ group: withMembers(group) });
});

const groupSchema = z.object({
  sport_id: z.coerce.number().int().optional(),
  name: z.string().min(2),
  description: z.string().optional().nullable(),
  color: z.string().optional().nullable(),
  is_active: z.coerce.number().int().min(0).max(1).default(1),
  player_ids: z.array(z.coerce.number().int()).optional(),
});

router.post('/', requirePermission('groups.write'), asyncHandler(async (req, res) => {
  const body = groupSchema.parse(req.body);
  const sport = requireCricketSport(body.sport_id || 'cricket');
  const groupId = tx(() => {
    const info = db
      .prepare('INSERT INTO player_groups (sport_id, name, description, color, is_active, created_by) VALUES (?,?,?,?,?,?)')
      .run(sport.id, body.name, body.description ?? null, body.color ?? null, body.is_active, req.user.id);
    const insertMember = db.prepare('INSERT OR IGNORE INTO player_group_members (group_id, player_id) VALUES (?,?)');
    for (const playerId of body.player_ids || []) insertMember.run(info.lastInsertRowid, playerId);
    return info.lastInsertRowid;
  });
  audit(req, { action: 'create', entity: 'player_groups', entityId: groupId, summary: `Group created: ${body.name}` });
  res.status(201).json({ group: withMembers(db.prepare('SELECT * FROM player_groups WHERE id = ?').get(groupId)) });
}));

router.put('/:id', requirePermission('groups.write'), asyncHandler(async (req, res) => {
  const before = db.prepare('SELECT * FROM player_groups WHERE id = ?').get(req.params.id);
  if (!before) throw new ApiError(404, 'That group does not exist.');
  requireCricketSport(before.sport_id);
  const body = groupSchema.partial().parse(req.body);
  db.prepare(`UPDATE player_groups SET name = ?, description = ?, color = ?, is_active = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(body.name ?? before.name, body.description ?? before.description, body.color ?? before.color,
         body.is_active ?? before.is_active, before.id);
  audit(req, { action: 'update', entity: 'player_groups', entityId: before.id, summary: `Group updated: ${before.name}` });
  res.json({ group: withMembers(db.prepare('SELECT * FROM player_groups WHERE id = ?').get(before.id)) });
}));

router.delete('/:id', requirePermission('groups.write'), asyncHandler(async (req, res) => {
  const before = db.prepare('SELECT * FROM player_groups WHERE id = ?').get(req.params.id);
  if (!before) throw new ApiError(404, 'That group does not exist.');
  requireCricketSport(before.sport_id);
  db.prepare('DELETE FROM player_groups WHERE id = ?').run(before.id);
  audit(req, { action: 'delete', entity: 'player_groups', entityId: before.id, summary: `Group removed: ${before.name}` });
  res.json({ ok: true });
}));

router.post('/:id/members', requirePermission('groups.write'), asyncHandler(async (req, res) => {
  const group = db.prepare('SELECT * FROM player_groups WHERE id = ?').get(req.params.id);
  if (!group) throw new ApiError(404, 'That group does not exist.');
  requireCricketSport(group.sport_id);
  const schema = z.object({ player_id: z.coerce.number().int() });
  const { player_id } = schema.parse(req.body);
  if (!canAccessPlayer(req.user, player_id)) throw new ApiError(403, 'That player is not assigned to you.');
  db.prepare('INSERT OR IGNORE INTO player_group_members (group_id, player_id) VALUES (?,?)').run(group.id, player_id);
  res.status(201).json({ group: withMembers(group) });
}));

router.delete('/:id/members/:playerId', requirePermission('groups.write'), asyncHandler(async (req, res) => {
  const group = db.prepare('SELECT * FROM player_groups WHERE id = ?').get(req.params.id);
  if (!group) throw new ApiError(404, 'That group does not exist.');
  requireCricketSport(group.sport_id);
  db.prepare('DELETE FROM player_group_members WHERE group_id = ? AND player_id = ?').run(group.id, req.params.playerId);
  res.json({ group: withMembers(group) });
}));

module.exports = router;
