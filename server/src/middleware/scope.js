'use strict';
const { db } = require('../db');
const { GLOBAL_ROLES, SELF_ROLES } = require('../lib/permissions');

/** Sports this user may act on. null means "all sports". */
function allowedSportIds(user) {
  if (!user) return [];
  if (GLOBAL_ROLES.has(user.role)) return null;
  if (user.role === 'sport_admin') return user.sportIds || [];
  if (user.role === 'coach') {
    const ids = new Set();
    for (const teamId of user.teamIds || []) {
      const t = db.prepare('SELECT sport_id FROM teams WHERE id = ?').get(teamId);
      if (t) ids.add(t.sport_id);
    }
    return [...ids];
  }
  return [];
}

/** Teams this user may act on. null means "all teams". */
function allowedTeamIds(user) {
  if (!user) return [];
  if (GLOBAL_ROLES.has(user.role)) return null;
  if (user.role === 'sport_admin') {
    const ids = (user.sportIds || []).length
      ? db.prepare(`SELECT id FROM teams WHERE sport_id IN (${(user.sportIds || []).map(() => '?').join(',')})`).all(...user.sportIds)
      : [];
    return ids.map((r) => r.id);
  }
  if (user.role === 'coach') return user.teamIds || [];
  return [];
}

/**
 * Players this user may read. null means "all players".
 * A coach sees everyone who currently holds a membership in one of their teams.
 */
function allowedPlayerIds(user) {
  if (!user) return [];
  if (GLOBAL_ROLES.has(user.role)) return null;
  if (SELF_ROLES.has(user.role)) return user.linkedPlayerIds || [];
  const sportIds = allowedSportIds(user);
  const teamIds = allowedTeamIds(user);
  const ids = new Set();
  if (teamIds && teamIds.length) {
    const rows = db
      .prepare(`SELECT DISTINCT player_id FROM team_memberships WHERE team_id IN (${teamIds.map(() => '?').join(',')})`)
      .all(...teamIds);
    rows.forEach((r) => ids.add(r.player_id));
  }
  if (user.role === 'sport_admin' && sportIds && sportIds.length) {
    const rows = db
      .prepare(`SELECT DISTINCT player_id FROM player_sports WHERE sport_id IN (${sportIds.map(() => '?').join(',')})`)
      .all(...sportIds);
    rows.forEach((r) => ids.add(r.player_id));
  }
  return [...ids];
}

function canAccessPlayer(user, playerId) {
  const allowed = allowedPlayerIds(user);
  return allowed === null || allowed.includes(Number(playerId));
}

function canAccessTeam(user, teamId) {
  const allowed = allowedTeamIds(user);
  return allowed === null || allowed.includes(Number(teamId));
}

function canAccessSport(user, sportId) {
  const allowed = allowedSportIds(user);
  return allowed === null || allowed.includes(Number(sportId));
}

/** Build a SQL fragment restricting a column to the caller's scope. */
function scopeClause(column, ids) {
  if (ids === null) return { sql: '', params: [] };
  if (!ids.length) return { sql: ` AND 1 = 0`, params: [] };
  return { sql: ` AND ${column} IN (${ids.map(() => '?').join(',')})`, params: ids };
}

module.exports = {
  allowedSportIds,
  allowedTeamIds,
  allowedPlayerIds,
  canAccessPlayer,
  canAccessTeam,
  canAccessSport,
  scopeClause,
};
