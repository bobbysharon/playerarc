'use strict';
const express = require('express');
const bcrypt = require('bcryptjs');
const { z } = require('zod');
const { db, parseJson, tx } = require('../db');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { audit } = require('../middleware/audit');
const { asyncHandler, ApiError } = require('../middleware/error');
const { ROLES, permissionsFor } = require('../lib/permissions');

const router = express.Router();
const adminOnly = requirePermission('*');

/* ---- Users ---------------------------------------------------------- */
router.get('/users', adminOnly, (req, res) => {
  const users = db
    .prepare(`SELECT u.id, u.email, u.full_name, u.status, u.phone, u.last_login_at, u.is_demo, u.created_at,
                     r.key AS role, r.name AS role_name
              FROM users u JOIN roles r ON r.id = u.role_id ORDER BY r.rank, u.full_name`)
    .all()
    .map((u) => ({
      ...u,
      sportIds: db.prepare('SELECT sport_id FROM user_sport_scopes WHERE user_id = ?').all(u.id).map((r) => r.sport_id),
      teamIds: db.prepare('SELECT team_id FROM user_team_scopes WHERE user_id = ?').all(u.id).map((r) => r.team_id),
      playerIds: db.prepare('SELECT player_id FROM user_player_links WHERE user_id = ?').all(u.id).map((r) => r.player_id),
    }));
  res.json({ users, roles: ROLES.map((r) => ({ ...r, permissions: permissionsFor(r.key) })) });
});

const userSchema = z.object({
  email: z.string().email(),
  full_name: z.string().min(2),
  password: z.string().min(8, 'Use at least 8 characters'),
  role: z.string(),
  phone: z.string().optional().nullable(),
  status: z.enum(['active', 'suspended', 'invited']).default('active'),
  sportIds: z.array(z.coerce.number().int()).optional(),
  teamIds: z.array(z.coerce.number().int()).optional(),
  playerIds: z.array(z.coerce.number().int()).optional(),
  coachId: z.coerce.number().int().optional().nullable(),
});

router.post('/users', adminOnly, asyncHandler(async (req, res) => {
  const body = userSchema.parse(req.body);
  const role = db.prepare('SELECT * FROM roles WHERE key = ?').get(body.role);
  if (!role) throw new ApiError(422, 'That role does not exist.');
  const hash = await bcrypt.hash(body.password, 10);

  let userId;
  tx(() => {
    const info = db
      .prepare('INSERT INTO users (email, password_hash, full_name, role_id, phone, status) VALUES (?,?,?,?,?,?)')
      .run(body.email, hash, body.full_name, role.id, body.phone ?? null, body.status);
    userId = info.lastInsertRowid;
    (body.sportIds || []).forEach((id) => db.prepare('INSERT OR IGNORE INTO user_sport_scopes (user_id, sport_id) VALUES (?,?)').run(userId, id));
    (body.teamIds || []).forEach((id) => db.prepare('INSERT OR IGNORE INTO user_team_scopes (user_id, team_id) VALUES (?,?)').run(userId, id));
    (body.playerIds || []).forEach((id) => db.prepare('INSERT OR IGNORE INTO user_player_links (user_id, player_id, relationship) VALUES (?,?,?)')
      .run(userId, id, body.role === 'guardian' ? 'guardian' : 'self'));
    if (body.coachId) db.prepare('UPDATE coaches SET user_id = ? WHERE id = ?').run(userId, body.coachId);
  });

  audit(req, { action: 'create', entity: 'users', entityId: userId, summary: `User created: ${body.email} (${body.role})` });
  res.status(201).json({ ok: true, id: userId });
}));

router.put('/users/:id', adminOnly, asyncHandler(async (req, res) => {
  const before = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!before) throw new ApiError(404, 'That user does not exist.');
  const body = userSchema.partial().parse(req.body);

  const sets = [];
  const params = [];
  if (body.email) { sets.push('email = ?'); params.push(body.email); }
  if (body.full_name) { sets.push('full_name = ?'); params.push(body.full_name); }
  if (body.phone !== undefined) { sets.push('phone = ?'); params.push(body.phone); }
  if (body.status) { sets.push('status = ?'); params.push(body.status); }
  if (body.password) { sets.push('password_hash = ?'); params.push(await bcrypt.hash(body.password, 10)); }
  if (body.role) {
    const role = db.prepare('SELECT * FROM roles WHERE key = ?').get(body.role);
    if (!role) throw new ApiError(422, 'That role does not exist.');
    sets.push('role_id = ?');
    params.push(role.id);
  }
  if (sets.length) db.prepare(`UPDATE users SET ${sets.join(', ')}, updated_at = datetime('now') WHERE id = ?`).run(...params, before.id);

  tx(() => {
    if (body.sportIds) {
      db.prepare('DELETE FROM user_sport_scopes WHERE user_id = ?').run(before.id);
      body.sportIds.forEach((id) => db.prepare('INSERT OR IGNORE INTO user_sport_scopes (user_id, sport_id) VALUES (?,?)').run(before.id, id));
    }
    if (body.teamIds) {
      db.prepare('DELETE FROM user_team_scopes WHERE user_id = ?').run(before.id);
      body.teamIds.forEach((id) => db.prepare('INSERT OR IGNORE INTO user_team_scopes (user_id, team_id) VALUES (?,?)').run(before.id, id));
    }
    if (body.playerIds) {
      db.prepare('DELETE FROM user_player_links WHERE user_id = ?').run(before.id);
      body.playerIds.forEach((id) => db.prepare('INSERT OR IGNORE INTO user_player_links (user_id, player_id, relationship) VALUES (?,?,?)')
        .run(before.id, id, body.role === 'guardian' ? 'guardian' : 'self'));
    }
  });

  audit(req, { action: 'update', entity: 'users', entityId: before.id, summary: `User updated: ${before.email}` });
  res.json({ ok: true });
}));

/* ---- Audit log ------------------------------------------------------ */
router.get('/audit', requirePermission('audit.read'), (req, res) => {
  const where = ['1 = 1'];
  const params = [];
  if (req.query.entity) { where.push('entity = ?'); params.push(req.query.entity); }
  if (req.query.action) { where.push('action = ?'); params.push(req.query.action); }
  if (req.query.user) { where.push('user_id = ?'); params.push(Number(req.query.user)); }
  if (req.query.from) { where.push('created_at >= ?'); params.push(req.query.from); }
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  const logs = db.prepare(`SELECT * FROM audit_logs WHERE ${where.join(' AND ')} ORDER BY created_at DESC, id DESC LIMIT ?`).all(...params, limit);
  const total = db.prepare(`SELECT COUNT(*) AS c FROM audit_logs WHERE ${where.join(' AND ')}`).get(...params).c;
  res.json({ logs, total });
});

/* ---- Settings ------------------------------------------------------- */
router.get('/settings', requireAuth, (req, res) => {
  const rows = db.prepare('SELECT * FROM settings').all();
  const settings = {};
  rows.forEach((r) => { settings[r.key] = parseJson(r.value_json, null); });
  res.json({ settings });
});

router.put('/settings/:key', requirePermission('*'), asyncHandler(async (req, res) => {
  const value = req.body.value;
  db.prepare(`INSERT INTO settings (key, value_json, updated_by, updated_at) VALUES (?,?,?,datetime('now'))
              ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_by = excluded.updated_by, updated_at = datetime('now')`)
    .run(req.params.key, JSON.stringify(value ?? null), req.user.id);
  audit(req, { action: 'update', entity: 'settings', summary: `Setting changed: ${req.params.key}` });
  res.json({ ok: true });
}));

/** Remove every record flagged as demo data, leaving real records untouched. */
router.post('/demo-data/clear', adminOnly, asyncHandler(async (req, res) => {
  const counts = {};
  tx(() => {
    for (const table of ['achievements', 'assessments', 'training_sessions', 'matches', 'tournaments', 'teams', 'coaches', 'players', 'users']) {
      const c = db.prepare(`SELECT COUNT(*) AS c FROM ${table} WHERE is_demo = 1`).get().c;
      if (table === 'users') {
        db.prepare('DELETE FROM users WHERE is_demo = 1 AND id != ?').run(req.user.id);
      } else {
        db.prepare(`DELETE FROM ${table} WHERE is_demo = 1`).run();
      }
      counts[table] = c;
    }
  });
  audit(req, { action: 'delete', entity: 'settings', summary: 'Demo data cleared' });
  res.json({ ok: true, removed: counts });
}));

module.exports = router;
