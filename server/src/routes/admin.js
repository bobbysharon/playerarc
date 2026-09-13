'use strict';
const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
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
      players: db
        .prepare(`SELECT p.id, p.athlete_id, p.first_name, p.last_name, l.relationship
                  FROM user_player_links l JOIN players p ON p.id = l.player_id WHERE l.user_id = ?`)
        .all(u.id),
      coach: db.prepare('SELECT id, full_name, role FROM coaches WHERE user_id = ?').get(u.id) || null,
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
  const before = db
    .prepare('SELECT u.*, r.key AS role FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = ?')
    .get(req.params.id);
  if (!before) throw new ApiError(404, 'That user does not exist.');
  const body = userSchema.partial().parse(req.body);

  // The administrator account is what guarantees someone can always get back
  // into the platform, so its role is fixed. Everything else about it — name,
  // contact details, password — is editable as normal.
  if (before.role === 'super_admin' && body.role && body.role !== 'super_admin') {
    throw new ApiError(
      409,
      'The administrator role cannot be changed. Promote another account to administrator first, then change this one.',
    );
  }
  if (before.role === 'super_admin' && body.status && body.status !== 'active') {
    const others = db
      .prepare(`SELECT COUNT(*) AS c FROM users u JOIN roles r ON r.id = u.role_id
                WHERE r.key = 'super_admin' AND u.status = 'active' AND u.id != ?`)
      .get(before.id).c;
    if (others === 0) throw new ApiError(409, 'This is the last active administrator, so it cannot be suspended.');
  }

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

  if ('coachId' in body) {
    db.prepare('UPDATE coaches SET user_id = NULL WHERE user_id = ?').run(before.id);
    if (body.coachId) db.prepare('UPDATE coaches SET user_id = ? WHERE id = ?').run(before.id, body.coachId);
  }

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


/**
 * Remove a user. Two things are refused outright: deleting yourself, and
 * removing the last super admin — either would lock the club out of its own
 * platform. Suspending is offered instead of deleting where history matters.
 */
router.delete('/users/:id', adminOnly, asyncHandler(async (req, res) => {
  const user = db
    .prepare('SELECT u.*, r.key AS role FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = ?')
    .get(req.params.id);
  if (!user) throw new ApiError(404, 'That user does not exist.');
  if (user.id === req.user.id) throw new ApiError(409, 'You cannot delete the account you are signed in with.');
  if (user.role === 'super_admin') {
    const remaining = db
      .prepare(`SELECT COUNT(*) AS c FROM users u JOIN roles r ON r.id = u.role_id
                WHERE r.key = 'super_admin' AND u.status = 'active' AND u.id != ?`)
      .get(user.id).c;
    if (remaining === 0) throw new ApiError(409, 'This is the last active super admin. Promote another account first.');
  }
  db.prepare('DELETE FROM users WHERE id = ?').run(user.id);
  audit(req, { action: 'delete', entity: 'users', entityId: user.id, summary: `User deleted: ${user.email}`, before: { email: user.email, role: user.role } });
  res.json({ ok: true });
}));

/**
 * Set or generate a password.
 *
 * Stored passwords are bcrypt hashes and cannot be read back — not by an
 * administrator, not by anyone. What an administrator can do is issue a new
 * one. Pass a password to set it, or omit it to have a strong one generated
 * and returned once in this response so it can be handed over.
 */
router.post('/users/:id/password', adminOnly, asyncHandler(async (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!user) throw new ApiError(404, 'That user does not exist.');

  const schema = z.object({
    password: z.string().min(8, 'Use at least 8 characters').optional(),
    mustChange: z.coerce.boolean().default(true),
  });
  const body = schema.parse(req.body);

  const password = body.password || generatePassword();
  const hash = await bcrypt.hash(password, 10);
  db.prepare(`UPDATE users SET password_hash = ?, must_change_password = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(hash, body.mustChange ? 1 : 0, user.id);

  audit(req, {
    action: 'update',
    entity: 'users',
    entityId: user.id,
    summary: `Password ${body.password ? 'set' : 'generated'} for ${user.email}${body.mustChange ? ' (must change at next sign-in)' : ''}`,
  });

  // Returned once, never stored in readable form.
  res.json({ ok: true, password, mustChange: !!body.mustChange, generated: !body.password });
}));

/** A readable but strong password an administrator can pass on verbally. */
function generatePassword() {
  const words = ['Falcon', 'Summit', 'Harbour', 'Cypress', 'Kestrel', 'Lantern', 'Meridian', 'Quarry', 'Thistle', 'Vantage'];
  const pick = () => words[crypto.randomInt(words.length)];
  return `${pick()}-${pick()}-${String(crypto.randomInt(1000, 9999))}`;
}


/* ================================================================== */
/* Athlete portal logins                                              */
/*                                                                    */
/* Managed here because only an administrator issues them, but stored */
/* apart from staff accounts: an athlete login has no role to change, */
/* and exactly one can exist per athlete.                             */
/* ================================================================== */

router.get('/athlete-logins', adminOnly, (req, res) => {
  const logins = db
    .prepare(`SELECT a.id, a.player_id, a.email, a.status, a.must_change_password, a.last_login_at, a.created_at,
                     p.athlete_id, p.first_name, p.last_name, p.display_name, p.photo_url, p.status AS player_status
              FROM athlete_logins a JOIN players p ON p.id = a.player_id
              ORDER BY p.first_name, p.last_name`)
    .all();

  // Athletes who could be given one, so the form need not search twice.
  const without = db
    .prepare(`SELECT p.id, p.athlete_id, p.first_name, p.last_name, p.display_name, p.email
              FROM players p WHERE p.id NOT IN (SELECT player_id FROM athlete_logins)
              ORDER BY p.first_name, p.last_name`)
    .all();

  res.json({ logins, athletesWithoutLogin: without, total: logins.length });
});

const athleteLoginSchema = z.object({
  player_id: z.coerce.number().int(),
  email: z.string().email('Enter a valid email address'),
  password: z.string().min(8, 'Use at least 8 characters').optional(),
  status: z.enum(['active', 'suspended', 'invited']).default('active'),
  mustChange: z.coerce.boolean().default(true),
});

router.post('/athlete-logins', adminOnly, asyncHandler(async (req, res) => {
  const body = athleteLoginSchema.parse(req.body);

  const player = db.prepare('SELECT * FROM players WHERE id = ?').get(body.player_id);
  if (!player) throw new ApiError(404, 'That athlete record does not exist.');

  // One login per athlete, and never a second athlete record.
  const existing = db.prepare('SELECT id FROM athlete_logins WHERE player_id = ?').get(body.player_id);
  if (existing) {
    throw new ApiError(409, `${player.first_name} ${player.last_name} already has a portal login. Reset its password instead of creating a second one.`);
  }
  const taken = db.prepare('SELECT id FROM athlete_logins WHERE lower(email) = lower(?)').get(body.email);
  if (taken) throw new ApiError(409, 'Another athlete already uses that email address.');
  const staff = db.prepare('SELECT id FROM users WHERE lower(email) = lower(?)').get(body.email);
  if (staff) throw new ApiError(409, 'That address belongs to a staff account. Athlete logins are kept separate.');

  const password = body.password || generatePassword();
  const info = db
    .prepare(`INSERT INTO athlete_logins (player_id, email, password_hash, status, must_change_password, created_by)
              VALUES (?,?,?,?,?,?)`)
    .run(body.player_id, body.email, await bcrypt.hash(password, 10), body.status, body.mustChange ? 1 : 0, req.user.id);

  audit(req, {
    action: 'create', entity: 'athlete_logins', entityId: info.lastInsertRowid,
    summary: `Athlete portal login created for ${player.athlete_id}`,
  });

  // Returned once so it can be handed over; only the hash is kept.
  res.status(201).json({
    id: info.lastInsertRowid,
    password,
    generated: !body.password,
    mustChange: !!body.mustChange,
  });
}));

router.put('/athlete-logins/:id', adminOnly, asyncHandler(async (req, res) => {
  const login = db.prepare('SELECT * FROM athlete_logins WHERE id = ?').get(req.params.id);
  if (!login) throw new ApiError(404, 'That athlete login does not exist.');

  const body = z.object({
    email: z.string().email('Enter a valid email address').optional(),
    status: z.enum(['active', 'suspended', 'invited']).optional(),
  }).parse(req.body);

  if (body.email) {
    const taken = db.prepare('SELECT id FROM athlete_logins WHERE lower(email) = lower(?) AND id != ?').get(body.email, login.id);
    if (taken) throw new ApiError(409, 'Another athlete already uses that email address.');
    const staff = db.prepare('SELECT id FROM users WHERE lower(email) = lower(?)').get(body.email);
    if (staff) throw new ApiError(409, 'That address belongs to a staff account. Athlete logins are kept separate.');
  }

  const sets = Object.keys(body).map((k) => `${k} = ?`);
  if (sets.length) {
    db.prepare(`UPDATE athlete_logins SET ${sets.join(', ')}, updated_at = datetime('now') WHERE id = ?`)
      .run(...Object.values(body), login.id);
  }
  audit(req, { action: 'update', entity: 'athlete_logins', entityId: login.id, summary: `Athlete login updated: ${login.email}` });
  res.json({ ok: true });
}));

/**
 * Issue a password. As with staff accounts the stored value is a hash, so an
 * existing password cannot be shown — only replaced.
 */
router.post('/athlete-logins/:id/password', adminOnly, asyncHandler(async (req, res) => {
  const login = db.prepare('SELECT * FROM athlete_logins WHERE id = ?').get(req.params.id);
  if (!login) throw new ApiError(404, 'That athlete login does not exist.');

  const body = z.object({
    password: z.string().min(8, 'Use at least 8 characters').optional(),
    mustChange: z.coerce.boolean().default(true),
  }).parse(req.body);

  const password = body.password || generatePassword();
  db.prepare(`UPDATE athlete_logins SET password_hash = ?, must_change_password = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(await bcrypt.hash(password, 10), body.mustChange ? 1 : 0, login.id);

  audit(req, {
    action: 'update', entity: 'athlete_logins', entityId: login.id,
    summary: `Athlete password ${body.password ? 'set' : 'generated'} for ${login.email}`,
  });
  res.json({ ok: true, password, generated: !body.password, mustChange: !!body.mustChange });
}));

router.delete('/athlete-logins/:id', adminOnly, asyncHandler(async (req, res) => {
  const login = db.prepare('SELECT * FROM athlete_logins WHERE id = ?').get(req.params.id);
  if (!login) throw new ApiError(404, 'That athlete login does not exist.');
  db.prepare('DELETE FROM athlete_logins WHERE id = ?').run(login.id);
  audit(req, {
    action: 'delete', entity: 'athlete_logins', entityId: login.id,
    summary: `Athlete portal login removed: ${login.email}`,
  });
  // The athlete record itself is untouched — only their way of signing in.
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
