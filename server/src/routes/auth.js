'use strict';
const express = require('express');
const bcrypt = require('bcryptjs');
const { z } = require('zod');
const { db } = require('../db');
const { signToken, requireAuth } = require('../middleware/auth');
const { audit } = require('../middleware/audit');
const { asyncHandler } = require('../middleware/error');
const { permissionsFor, ROLES } = require('../lib/permissions');

const router = express.Router();

const credentials = z.object({
  email: z.string().email('Enter a valid email address'),
  password: z.string().min(1, 'Enter your password'),
});

function profileFor(user) {
  return {
    id: user.id,
    email: user.email,
    fullName: user.full_name,
    role: user.role,
    roleName: user.role_name,
    avatarUrl: user.avatar_url,
    permissions: permissionsFor(user.role),
    sportIds: user.sportIds || [],
    teamIds: user.teamIds || [],
    linkedPlayerIds: user.linkedPlayerIds || [],
    coachId: user.coachId || null,
  };
}

router.post('/login', asyncHandler(async (req, res) => {
  const { email, password } = credentials.parse(req.body);
  const row = db
    .prepare(`SELECT u.*, r.key AS role, r.name AS role_name FROM users u JOIN roles r ON r.id = u.role_id WHERE lower(u.email) = lower(?)`)
    .get(email);

  if (!row || !(await bcrypt.compare(password, row.password_hash))) {
    audit(req, { action: 'login_failed', entity: 'users', summary: `Failed sign-in for ${email}` });
    return res.status(401).json({ error: 'Email or password is incorrect.' });
  }
  if (row.status !== 'active') {
    return res.status(403).json({ error: 'This account is not active. Contact an administrator.' });
  }

  db.prepare(`UPDATE users SET last_login_at = datetime('now') WHERE id = ?`).run(row.id);
  row.sportIds = db.prepare('SELECT sport_id FROM user_sport_scopes WHERE user_id = ?').all(row.id).map((r) => r.sport_id);
  row.teamIds = db.prepare('SELECT team_id FROM user_team_scopes WHERE user_id = ?').all(row.id).map((r) => r.team_id);
  row.linkedPlayerIds = db.prepare('SELECT player_id FROM user_player_links WHERE user_id = ?').all(row.id).map((r) => r.player_id);
  const coach = db.prepare('SELECT id FROM coaches WHERE user_id = ?').get(row.id);
  row.coachId = coach ? coach.id : null;

  req.user = row;
  audit(req, { action: 'login', entity: 'users', entityId: row.id, summary: `${row.email} signed in` });
  return res.json({ token: signToken({ id: row.id, role: row.role }), user: profileFor(row) });
}));

router.get('/me', requireAuth, (req, res) => res.json({ user: profileFor(req.user) }));

router.get('/roles', (req, res) => res.json({ roles: ROLES.map((r) => ({ ...r, permissions: permissionsFor(r.key) })) }));

router.post('/change-password', requireAuth, asyncHandler(async (req, res) => {
  const schema = z.object({
    currentPassword: z.string().min(1, 'Enter your current password'),
    newPassword: z.string().min(8, 'Use at least 8 characters'),
  });
  const { currentPassword, newPassword } = schema.parse(req.body);
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!(await bcrypt.compare(currentPassword, row.password_hash))) {
    return res.status(400).json({ error: 'Current password is incorrect.' });
  }
  const hash = await bcrypt.hash(newPassword, 10);
  db.prepare(`UPDATE users SET password_hash = ?, must_change_password = 0, updated_at = datetime('now') WHERE id = ?`).run(hash, req.user.id);
  audit(req, { action: 'update', entity: 'users', entityId: req.user.id, summary: 'Password changed' });
  return res.json({ ok: true });
}));

router.post('/logout', requireAuth, (req, res) => {
  audit(req, { action: 'logout', entity: 'users', entityId: req.user.id, summary: `${req.user.email} signed out` });
  res.json({ ok: true });
});

module.exports = router;
