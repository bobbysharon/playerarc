'use strict';
const { db, parseJson } = require('../db');
const { aggregateCareer, computeRating, performanceScope } = require('./stats-engine');

/** Load a sport row with its parsed configuration. */
function getSport(idOrCode) {
  const row = Number.isInteger(Number(idOrCode)) && String(Number(idOrCode)) === String(idOrCode)
    ? db.prepare('SELECT * FROM sports WHERE id = ?').get(Number(idOrCode))
    : db.prepare('SELECT * FROM sports WHERE code = ?').get(String(idOrCode));
  if (!row) return null;
  return { ...row, config: parseJson(row.config_json, {}) };
}

function listSports({ activeOnly = false } = {}) {
  const rows = db
    .prepare(`SELECT * FROM sports ${activeOnly ? 'WHERE is_active = 1' : ''} ORDER BY sort_order, name`)
    .all();
  return rows.map((r) => ({ ...r, config: parseJson(r.config_json, {}) }));
}

/** Every performance a player has recorded in one sport, oldest first. */
function playerPerformances(playerId, sportId) {
  return db
    .prepare(`
      SELECT p.*, m.scheduled_at, m.venue, m.status AS match_status, m.result, m.stage,
             m.opponent_name, m.home_team_id, m.away_team_id,
             t.name AS tournament_name, tm.name AS team_name,
             ht.name AS home_team_name, at.name AS away_team_name
      FROM match_performances p
      JOIN matches m ON m.id = p.match_id
      LEFT JOIN tournaments t ON t.id = m.tournament_id
      LEFT JOIN teams tm ON tm.id = p.team_id
      LEFT JOIN teams ht ON ht.id = m.home_team_id
      LEFT JOIN teams at ON at.id = m.away_team_id
      WHERE p.player_id = ? AND p.sport_id = ?
      ORDER BY m.scheduled_at ASC
    `)
    .all(playerId, sportId)
    .map((r) => ({ ...r, stats: parseJson(r.stats_json, {}) }));
}

/**
 * The complete career record for one player in one sport: aggregated
 * statistics, the configurable rating, and the match log behind them.
 */
function playerCareer(playerId, sport, { filters = {} } = {}) {
  let performances = playerPerformances(playerId, sport.id);
  if (filters.seasonId) {
    const ids = db.prepare('SELECT id FROM matches WHERE season_id = ?').all(filters.seasonId).map((r) => r.id);
    performances = performances.filter((p) => ids.includes(p.match_id));
  }
  if (filters.tournamentId) performances = performances.filter((p) => p.tournament_id === Number(filters.tournamentId));
  if (filters.teamId) performances = performances.filter((p) => p.team_id === Number(filters.teamId));

  const career = aggregateCareer(sport.config, performances.map((p) => p.stats));
  const rating = computeRating(sport.config, career.values);
  const headline = (sport.config.headline || []).map((key) => {
    const entry = career.entries.find((e) => e.key === key);
    return entry || null;
  }).filter(Boolean);

  return {
    sport: { id: sport.id, code: sport.code, name: sport.name, color: sport.color, category: sport.category },
    matchesPlayed: performances.length,
    career,
    headline,
    rating,
    performances: performances.map((p) => ({
      id: p.id,
      matchId: p.match_id,
      date: p.scheduled_at,
      venue: p.venue,
      stage: p.stage,
      tournament: p.tournament_name,
      team: p.team_name,
      opponent: p.opponent_name || (p.team_name === p.home_team_name ? p.away_team_name : p.home_team_name),
      result: p.result,
      isMotm: !!p.is_motm,
      rating: p.rating,
      stats: p.stats,
      computed: performanceScope(p.stats, sport.config),
      notes: p.notes,
    })),
  };
}

/** Career records across every sport the player is registered for. */
function playerCareerAllSports(playerId, filters = {}) {
  const sportRows = db
    .prepare(`SELECT s.* FROM player_sports ps JOIN sports s ON s.id = ps.sport_id WHERE ps.player_id = ? ORDER BY ps.is_primary DESC, s.sort_order`)
    .all(playerId);
  return sportRows.map((row) => playerCareer(playerId, { ...row, config: parseJson(row.config_json, {}) }, { filters }));
}

/** Cross-sport career summary shown at the top of the player dashboard. */
function playerSummary(playerId) {
  const matches = db.prepare('SELECT COUNT(*) AS c FROM match_performances WHERE player_id = ?').get(playerId).c;
  const wins = db
    .prepare(`SELECT COUNT(*) AS c FROM match_performances p JOIN matches m ON m.id = p.match_id WHERE p.player_id = ? AND m.result = 'win'`)
    .get(playerId).c;
  const awards = db.prepare('SELECT COUNT(*) AS c FROM achievements WHERE player_id = ?').get(playerId).c;
  const tournaments = db
    .prepare(`SELECT COUNT(DISTINCT m.tournament_id) AS c FROM match_performances p JOIN matches m ON m.id = p.match_id WHERE p.player_id = ? AND m.tournament_id IS NOT NULL`)
    .get(playerId).c;
  const sports = db.prepare('SELECT COUNT(*) AS c FROM player_sports WHERE player_id = ?').get(playerId).c;
  const trainings = db.prepare(`SELECT COUNT(*) AS c FROM training_attendance WHERE player_id = ? AND status IN ('present','late')`).get(playerId).c;
  const trainingTotal = db.prepare('SELECT COUNT(*) AS c FROM training_attendance WHERE player_id = ?').get(playerId).c;
  const motm = db.prepare('SELECT COUNT(*) AS c FROM matches WHERE player_of_match_id = ?').get(playerId).c;

  const careers = playerCareerAllSports(playerId);
  const rated = careers.filter((c) => c.rating && c.matchesPlayed > 0);
  const overallRating = rated.length
    ? Math.round((rated.reduce((a, c) => a + c.rating.overall, 0) / rated.length) * 10) / 10
    : null;

  return {
    matches,
    wins,
    winRate: matches ? Math.round((wins / matches) * 1000) / 10 : 0,
    awards,
    tournaments,
    sports,
    motm,
    trainingAttended: trainings,
    trainingSessions: trainingTotal,
    attendanceRate: trainingTotal ? Math.round((trainings / trainingTotal) * 1000) / 10 : 0,
    rating: overallRating,
  };
}

module.exports = { getSport, listSports, playerPerformances, playerCareer, playerCareerAllSports, playerSummary };
