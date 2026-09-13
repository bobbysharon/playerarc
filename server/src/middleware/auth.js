'use strict';
const jwt = require('jsonwebtoken');
const config = require('../config');
const { db } = require('../db');
const { can } = require('../lib/permissions');

/** Load the caller from the bearer token and attach scope information. */
function authenticate(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return next();
  try {
    const payload = jwt.verify(token, config.jwtSecret);
    // Athlete portal tokens carry a different audience and are never valid
    // here. Without this check an athlete credential would be accepted by
    // every staff route whose id happened to match a user.
    if (payload.aud === 'athlete') return next();
    const row = db
      .prepare(`SELECT u.id, u.email, u.full_name, u.status, u.avatar_url, r.key AS role, r.name AS role_name
                FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = ?`)
      .get(payload.sub);
    if (!row || row.status !== 'active') return next();
    row.sportIds = db.prepare('SELECT sport_id FROM user_sport_scopes WHERE user_id = ?').all(row.id).map((r) => r.sport_id);
    row.teamIds = db.prepare('SELECT team_id FROM user_team_scopes WHERE user_id = ?').all(row.id).map((r) => r.team_id);
    row.linkedPlayerIds = db.prepare('SELECT player_id FROM user_player_links WHERE user_id = ?').all(row.id).map((r) => r.player_id);
    const coach = db.prepare('SELECT id FROM coaches WHERE user_id = ?').get(row.id);
    row.coachId = coach ? coach.id : null;
    req.user = row;
  } catch {
    /* invalid or expired token — request continues unauthenticated */
  }
  return next();
}

function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Sign in to continue.' });
  return next();
}

/** Require one permission key. Use on every mutating route. */
function requirePermission(permission) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Sign in to continue.' });
    if (!can(req.user, permission)) {
      return res.status(403).json({ error: `Your role does not allow this action (${permission}).` });
    }
    return next();
  };
}

function signToken(user) {
  return jwt.sign({ sub: user.id, role: user.role }, config.jwtSecret, { expiresIn: config.jwtExpiresIn });
}

module.exports = { authenticate, requireAuth, requirePermission, signToken };
