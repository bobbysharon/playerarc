'use strict';
const { db } = require('../db');

/**
 * The career timeline is written as a side effect of real events — a player
 * joining a team, playing a match, passing an assessment — so the story of an
 * athlete's journey assembles itself rather than needing to be curated.
 *
 * System entries are de-duplicated on (player, type, ref) by a unique index,
 * which makes this function safe to call again when a record is edited.
 */
function addEvent({ playerId, date, type, title, description = null, sportId = null, refTable = null, refId = null, importance = 2, isSystem = 1, userId = null }) {
  if (!playerId || !date || !title) return null;
  const stmt = db.prepare(`
    INSERT INTO player_timeline (player_id, event_date, event_type, title, description, sport_id, ref_table, ref_id, importance, is_system, created_by)
    VALUES (@playerId, @date, @type, @title, @description, @sportId, @refTable, @refId, @importance, @isSystem, @userId)
    ON CONFLICT DO NOTHING
  `);
  const info = stmt.run({ playerId, date, type, title, description, sportId, refTable, refId, importance, isSystem, userId });
  return info.lastInsertRowid || null;
}

function removeEvent(refTable, refId) {
  db.prepare('DELETE FROM player_timeline WHERE ref_table = ? AND ref_id = ? AND is_system = 1').run(refTable, refId);
}

/** Milestone detection after a performance is saved (first match, 50s, 100s...). */
function checkMilestones({ playerId, sportId, sportCode, sportName, stats, matchId, date }) {
  const created = [];
  const push = (type, title, description, importance = 3) => {
    const id = addEvent({ playerId, date, type, title, description, sportId, refTable: `milestone:${matchId}:${title}`, refId: matchId, importance });
    if (id) created.push(title);
  };

  const priorMatches = db
    .prepare('SELECT COUNT(*) AS c FROM match_performances p JOIN matches m ON m.id = p.match_id WHERE p.player_id = ? AND p.sport_id = ? AND m.scheduled_at < ?')
    .get(playerId, sportId, date).c;
  if (priorMatches === 0) {
    push('debut', `${sportName} debut`, `First recorded ${sportName.toLowerCase()} appearance for Karwan Sports Club.`);
  }

  if (sportCode === 'cricket') {
    const runs = Number(stats.runs || 0);
    const wickets = Number(stats.wickets || 0);
    if (runs >= 100) push('milestone', `Century — ${runs} runs`, 'Scored a hundred in a single innings.');
    else if (runs >= 50) push('milestone', `Half-century — ${runs} runs`, 'Passed fifty in a single innings.');
    if (wickets >= 5) push('milestone', `Five-wicket haul — ${wickets} wickets`, 'Took five or more wickets in an innings.');
    else if (wickets >= 3) push('milestone', `${wickets}-wicket haul`, 'Took three or more wickets in an innings.');
  }
  if (sportCode === 'football' || sportCode === 'futsal') {
    const goals = Number(stats.goals || 0);
    if (goals >= 3) push('milestone', `Hat-trick — ${goals} goals`, 'Scored three or more goals in a single match.');
  }
  if (sportCode === 'basketball') {
    const pts = (Number(stats.fgm || 0) - Number(stats.tpm || 0)) * 2 + Number(stats.tpm || 0) * 3 + Number(stats.ftm || 0);
    if (pts >= 30) push('milestone', `${pts}-point game`, 'Scored thirty or more points in a single game.');
  }
  return created;
}

module.exports = { addEvent, removeEvent, checkMilestones };
