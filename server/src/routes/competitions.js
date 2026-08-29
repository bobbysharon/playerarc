'use strict';
const express = require('express');
const { z } = require('zod');
const { db, parseJson, tx } = require('../db');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { audit } = require('../middleware/audit');
const { asyncHandler, ApiError } = require('../middleware/error');
const { canAccessSport } = require('../middleware/scope');
const { getSport } = require('../lib/repo');
const { validateStats, computeMatchRating, performanceScope } = require('../lib/stats-engine');
const timeline = require('../lib/timeline');

const router = express.Router();

/* ==================================================================== */
/* Tournaments                                                          */
/* ==================================================================== */
router.get('/tournaments', requireAuth, (req, res) => {
  const where = ['1 = 1'];
  const params = [];
  if (req.query.sport) { where.push('t.sport_id = ?'); params.push(Number(req.query.sport)); }
  if (req.query.season) { where.push('t.season_id = ?'); params.push(Number(req.query.season)); }
  if (req.query.status) { where.push('t.status = ?'); params.push(req.query.status); }
  if (req.query.q) { where.push('t.name LIKE ?'); params.push(`%${req.query.q}%`); }

  const tournaments = db
    .prepare(`SELECT t.*, s.name AS sport_name, s.color, se.name AS season_name,
                     (SELECT COUNT(*) FROM matches m WHERE m.tournament_id = t.id) AS match_count,
                     (SELECT COUNT(*) FROM tournament_teams tt WHERE tt.tournament_id = t.id) AS team_count
              FROM tournaments t JOIN sports s ON s.id = t.sport_id
              LEFT JOIN seasons se ON se.id = t.season_id
              WHERE ${where.join(' AND ')} ORDER BY t.start_date DESC`)
    .all(...params);
  res.json({ tournaments });
});

router.get('/tournaments/:id', requireAuth, (req, res) => {
  const tournament = db
    .prepare(`SELECT t.*, s.name AS sport_name, s.code AS sport_code, s.color, se.name AS season_name
              FROM tournaments t JOIN sports s ON s.id = t.sport_id
              LEFT JOIN seasons se ON se.id = t.season_id WHERE t.id = ?`)
    .get(req.params.id);
  if (!tournament) throw new ApiError(404, 'That tournament does not exist.');

  const teams = db
    .prepare(`SELECT tt.*, t.name AS team_name, t.age_group FROM tournament_teams tt
              LEFT JOIN teams t ON t.id = tt.team_id WHERE tt.tournament_id = ?`)
    .all(tournament.id);

  const matches = db
    .prepare(`SELECT m.*, ht.name AS home_team_name, at.name AS away_team_name,
                     p.first_name || ' ' || p.last_name AS motm_name, p.athlete_id AS motm_athlete_id
              FROM matches m
              LEFT JOIN teams ht ON ht.id = m.home_team_id
              LEFT JOIN teams at ON at.id = m.away_team_id
              LEFT JOIN players p ON p.id = m.player_of_match_id
              WHERE m.tournament_id = ? ORDER BY m.scheduled_at`)
    .all(tournament.id);

  const awards = db
    .prepare(`SELECT a.*, p.athlete_id, p.first_name, p.last_name FROM achievements a
              JOIN players p ON p.id = a.player_id WHERE a.tournament_id = ? ORDER BY a.awarded_date`)
    .all(tournament.id);

  // Tournament leaderboard built from the sport's own leaderboard definitions.
  const sport = getSport(String(tournament.sport_id));
  const leaders = buildTournamentLeaders(sport, tournament.id);

  res.json({ tournament, teams, matches, awards, leaders });
});

function buildTournamentLeaders(sport, tournamentId) {
  const rows = db
    .prepare(`SELECT p.player_id, p.stats_json, pl.athlete_id, pl.first_name, pl.last_name, pl.display_name, pl.photo_url
              FROM match_performances p
              JOIN matches m ON m.id = p.match_id
              JOIN players pl ON pl.id = p.player_id
              WHERE m.tournament_id = ?`)
    .all(tournamentId);
  if (!rows.length) return [];
  const byPlayer = new Map();
  for (const r of rows) {
    if (!byPlayer.has(r.player_id)) byPlayer.set(r.player_id, { player: r, stats: [] });
    byPlayer.get(r.player_id).stats.push(parseJson(r.stats_json, {}));
  }
  const { aggregateCareer } = require('../lib/stats-engine');
  const boards = (sport.config.leaderboards || []).slice(0, 4);
  return boards.map((board) => {
    const entries = [...byPlayer.values()].map(({ player, stats }) => {
      const career = aggregateCareer(sport.config, stats);
      const qualified = !board.qualifier || (career.values[board.qualifier.metric] || 0) >= board.qualifier.min;
      return {
        playerId: player.player_id,
        athleteId: player.athlete_id,
        name: player.display_name || `${player.first_name} ${player.last_name}`,
        photoUrl: player.photo_url,
        value: career.values[board.metric] || 0,
        qualified,
      };
    }).filter((e) => e.qualified && e.value > 0);
    entries.sort((a, b) => (board.order === 'asc' ? a.value - b.value : b.value - a.value));
    return { ...board, entries: entries.slice(0, 5) };
  }).filter((b) => b.entries.length);
}

const tournamentSchema = z.object({
  name: z.string().min(2),
  sport_id: z.coerce.number().int(),
  season_id: z.coerce.number().int().optional().nullable(),
  format: z.string().optional().nullable(),
  level: z.string().optional().nullable(),
  age_group: z.string().optional().nullable(),
  start_date: z.string().optional().nullable(),
  end_date: z.string().optional().nullable(),
  venue: z.string().optional().nullable(),
  host: z.string().optional().nullable(),
  description: z.string().optional().nullable(),
  status: z.enum(['upcoming', 'ongoing', 'completed', 'cancelled']).default('upcoming'),
});

router.post('/tournaments', requirePermission('tournaments.write'), asyncHandler(async (req, res) => {
  const body = tournamentSchema.parse(req.body);
  if (body.start_date && body.end_date && body.end_date < body.start_date) {
    throw new ApiError(422, 'The tournament cannot end before it starts.');
  }
  const cols = Object.keys(body);
  const info = db.prepare(`INSERT INTO tournaments (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`)
    .run(...cols.map((c) => body[c] ?? null));
  audit(req, { action: 'create', entity: 'tournaments', entityId: info.lastInsertRowid, summary: `Tournament created: ${body.name}` });
  res.status(201).json({ tournament: db.prepare('SELECT * FROM tournaments WHERE id = ?').get(info.lastInsertRowid) });
}));

router.put('/tournaments/:id', requirePermission('tournaments.write'), asyncHandler(async (req, res) => {
  const before = db.prepare('SELECT * FROM tournaments WHERE id = ?').get(req.params.id);
  if (!before) throw new ApiError(404, 'That tournament does not exist.');
  const body = tournamentSchema.partial().parse(req.body);
  const sets = Object.keys(body).map((k) => `${k} = ?`);
  if (sets.length) {
    db.prepare(`UPDATE tournaments SET ${sets.join(', ')}, updated_at = datetime('now') WHERE id = ?`)
      .run(...Object.values(body).map((v) => (v === '' ? null : v)), before.id);
  }
  audit(req, { action: 'update', entity: 'tournaments', entityId: before.id, summary: `Tournament updated: ${before.name}`, before, after: body });
  res.json({ tournament: db.prepare('SELECT * FROM tournaments WHERE id = ?').get(before.id) });
}));

router.post('/tournaments/:id/teams', requirePermission('tournaments.write'), asyncHandler(async (req, res) => {
  const schema = z.object({
    team_id: z.coerce.number().int().optional().nullable(),
    external_name: z.string().optional().nullable(),
    group_name: z.string().optional().nullable(),
    seed: z.coerce.number().int().optional().nullable(),
  });
  const body = schema.parse(req.body);
  if (!body.team_id && !body.external_name) throw new ApiError(422, 'Choose a club team or name the visiting side.');
  db.prepare('INSERT INTO tournament_teams (tournament_id, team_id, external_name, group_name, seed) VALUES (?,?,?,?,?)')
    .run(req.params.id, body.team_id ?? null, body.external_name ?? null, body.group_name ?? null, body.seed ?? null);
  audit(req, { action: 'create', entity: 'tournament_teams', entityId: Number(req.params.id), summary: 'Team entered into tournament' });
  res.status(201).json({ ok: true });
}));

/* ==================================================================== */
/* Matches                                                              */
/* ==================================================================== */
router.get('/matches', requireAuth, (req, res) => {
  const where = ['1 = 1'];
  const params = [];
  if (req.query.sport) { where.push('m.sport_id = ?'); params.push(Number(req.query.sport)); }
  if (req.query.tournament) { where.push('m.tournament_id = ?'); params.push(Number(req.query.tournament)); }
  if (req.query.season) { where.push('m.season_id = ?'); params.push(Number(req.query.season)); }
  if (req.query.team) { where.push('(m.home_team_id = ? OR m.away_team_id = ?)'); params.push(Number(req.query.team), Number(req.query.team)); }
  if (req.query.status) { where.push('m.status = ?'); params.push(req.query.status); }
  if (req.query.from) { where.push('m.scheduled_at >= ?'); params.push(req.query.from); }
  if (req.query.to) { where.push('m.scheduled_at <= ?'); params.push(req.query.to); }

  const limit = Math.min(Number(req.query.limit) || 100, 500);
  const matches = db
    .prepare(`SELECT m.*, s.name AS sport_name, s.code AS sport_code, s.color,
                     t.name AS tournament_name, ht.name AS home_team_name, at.name AS away_team_name,
                     (SELECT COUNT(*) FROM match_performances mp WHERE mp.match_id = m.id) AS performance_count
              FROM matches m JOIN sports s ON s.id = m.sport_id
              LEFT JOIN tournaments t ON t.id = m.tournament_id
              LEFT JOIN teams ht ON ht.id = m.home_team_id
              LEFT JOIN teams at ON at.id = m.away_team_id
              WHERE ${where.join(' AND ')} ORDER BY m.scheduled_at DESC LIMIT ?`)
    .all(...params, limit);
  res.json({ matches });
});

router.get('/matches/:id', requireAuth, (req, res) => {
  const match = db
    .prepare(`SELECT m.*, s.name AS sport_name, s.code AS sport_code, s.color,
                     t.name AS tournament_name, ht.name AS home_team_name, at.name AS away_team_name,
                     se.name AS season_name
              FROM matches m JOIN sports s ON s.id = m.sport_id
              LEFT JOIN tournaments t ON t.id = m.tournament_id
              LEFT JOIN teams ht ON ht.id = m.home_team_id
              LEFT JOIN teams at ON at.id = m.away_team_id
              LEFT JOIN seasons se ON se.id = m.season_id
              WHERE m.id = ?`)
    .get(req.params.id);
  if (!match) throw new ApiError(404, 'That match does not exist.');

  const sport = getSport(String(match.sport_id));
  const lineup = db
    .prepare(`SELECT mp.*, p.athlete_id, p.first_name, p.last_name, p.display_name, p.photo_url,
                     t.name AS team_name, ps.position AS default_position
              FROM match_players mp
              JOIN players p ON p.id = mp.player_id
              LEFT JOIN teams t ON t.id = mp.team_id
              LEFT JOIN player_sports ps ON ps.player_id = p.id AND ps.sport_id = ?
              WHERE mp.match_id = ? ORDER BY mp.is_substitute, mp.batting_order, p.last_name`)
    .all(match.sport_id, match.id);

  const performances = db
    .prepare(`SELECT mp.*, p.athlete_id, p.first_name, p.last_name, p.display_name, p.photo_url
              FROM match_performances mp JOIN players p ON p.id = mp.player_id WHERE mp.match_id = ?`)
    .all(match.id)
    .map((r) => {
      const stats = parseJson(r.stats_json, {});
      return { ...r, stats, computed: performanceScope(stats, sport.config), stats_json: undefined };
    });

  res.json({ match, sport: { ...sport, config_json: undefined }, lineup, performances });
});

const matchSchema = z.object({
  sport_id: z.coerce.number().int(),
  tournament_id: z.coerce.number().int().optional().nullable(),
  season_id: z.coerce.number().int().optional().nullable(),
  match_no: z.string().optional().nullable(),
  stage: z.string().optional().nullable(),
  match_type: z.enum(['team', 'singles', 'doubles']).default('team'),
  format: z.string().optional().nullable(),
  scheduled_at: z.string().min(8),
  duration_minutes: z.coerce.number().int().optional().nullable(),
  venue: z.string().optional().nullable(),
  home_team_id: z.coerce.number().int().optional().nullable(),
  away_team_id: z.coerce.number().int().optional().nullable(),
  opponent_name: z.string().optional().nullable(),
  is_home: z.coerce.number().int().min(0).max(1).default(1),
  status: z.enum(['scheduled', 'live', 'completed', 'abandoned', 'cancelled']).default('scheduled'),
  result: z.enum(['win', 'loss', 'draw', 'tie', 'no_result']).optional().nullable(),
  home_score: z.string().optional().nullable(),
  away_score: z.string().optional().nullable(),
  winner_team_id: z.coerce.number().int().optional().nullable(),
  result_summary: z.string().optional().nullable(),
  toss_winner: z.string().optional().nullable(),
  toss_decision: z.string().optional().nullable(),
  officials: z.string().optional().nullable(),
  player_of_match_id: z.coerce.number().int().optional().nullable(),
  notes: z.string().optional().nullable(),
});

router.post('/matches', requirePermission('matches.write'), asyncHandler(async (req, res) => {
  const body = matchSchema.parse(req.body);
  if (!canAccessSport(req.user, body.sport_id)) throw new ApiError(403, 'That sport is not assigned to you.');
  if (body.home_team_id && body.home_team_id === body.away_team_id) {
    throw new ApiError(422, 'A team cannot play itself.');
  }
  if (!body.away_team_id && !body.opponent_name) {
    throw new ApiError(422, 'Choose an opposing club team or type the name of the visiting side.');
  }
  const cols = Object.keys(body);
  const info = db
    .prepare(`INSERT INTO matches (${cols.join(',')}, created_by) VALUES (${cols.map(() => '?').join(',')}, ?)`)
    .run(...cols.map((c) => body[c] ?? null), req.user.id);
  audit(req, { action: 'create', entity: 'matches', entityId: info.lastInsertRowid, summary: `Match created for ${body.scheduled_at}` });
  res.status(201).json({ match: db.prepare('SELECT * FROM matches WHERE id = ?').get(info.lastInsertRowid) });
}));

router.put('/matches/:id', requirePermission('matches.write'), asyncHandler(async (req, res) => {
  const before = db.prepare('SELECT * FROM matches WHERE id = ?').get(req.params.id);
  if (!before) throw new ApiError(404, 'That match does not exist.');
  if (!canAccessSport(req.user, before.sport_id)) throw new ApiError(403, 'That sport is not assigned to you.');
  const body = matchSchema.partial().parse(req.body);
  const sets = Object.keys(body).map((k) => `${k} = ?`);
  if (sets.length) {
    db.prepare(`UPDATE matches SET ${sets.join(', ')}, updated_at = datetime('now') WHERE id = ?`)
      .run(...Object.values(body).map((v) => (v === '' ? null : v)), before.id);
  }

  // Player of the match becomes an achievement and a timeline entry.
  if (body.player_of_match_id && body.player_of_match_id !== before.player_of_match_id) {
    const match = db.prepare('SELECT * FROM matches WHERE id = ?').get(before.id);
    const date = String(match.scheduled_at).slice(0, 10);
    const exists = db.prepare(`SELECT id FROM achievements WHERE player_id = ? AND match_id = ? AND category = 'match'`).get(body.player_of_match_id, match.id);
    if (!exists) {
      db.prepare(`INSERT INTO achievements (player_id, title, category, level, sport_id, tournament_id, match_id, team_id, awarded_date, description, created_by)
                  VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
        .run(body.player_of_match_id, 'Player of the Match', 'match', 'club', match.sport_id, match.tournament_id, match.id,
             match.home_team_id, date, match.result_summary || null, req.user.id);
    }
    db.prepare('UPDATE match_performances SET is_motm = 1 WHERE match_id = ? AND player_id = ?').run(match.id, body.player_of_match_id);
    timeline.addEvent({
      playerId: body.player_of_match_id, date, type: 'achievement', title: 'Player of the Match',
      description: match.result_summary || null, sportId: match.sport_id,
      refTable: 'matches_motm', refId: match.id, importance: 3, userId: req.user.id,
    });
  }

  audit(req, { action: 'update', entity: 'matches', entityId: before.id, summary: `Match updated (#${before.id})`, before, after: body });
  res.json({ match: db.prepare('SELECT * FROM matches WHERE id = ?').get(before.id) });
}));

router.delete('/matches/:id', requirePermission('matches.write'), asyncHandler(async (req, res) => {
  const match = db.prepare('SELECT * FROM matches WHERE id = ?').get(req.params.id);
  if (!match) throw new ApiError(404, 'That match does not exist.');
  db.prepare('DELETE FROM matches WHERE id = ?').run(match.id);
  audit(req, { action: 'delete', entity: 'matches', entityId: match.id, summary: `Match deleted (#${match.id})`, before: match });
  res.json({ ok: true });
}));

/* ---- Lineup / playing XI ------------------------------------------- */
router.put('/matches/:id/lineup', requirePermission('matches.write'), asyncHandler(async (req, res) => {
  const match = db.prepare('SELECT * FROM matches WHERE id = ?').get(req.params.id);
  if (!match) throw new ApiError(404, 'That match does not exist.');
  const sport = getSport(String(match.sport_id));

  const schema = z.object({
    players: z.array(z.object({
      player_id: z.coerce.number().int(),
      team_id: z.coerce.number().int().optional().nullable(),
      partner_id: z.coerce.number().int().optional().nullable(),
      is_starting: z.coerce.number().int().min(0).max(1).default(1),
      is_substitute: z.coerce.number().int().min(0).max(1).default(0),
      is_captain: z.coerce.number().int().min(0).max(1).default(0),
      is_keeper: z.coerce.number().int().min(0).max(1).default(0),
      position: z.string().optional().nullable(),
      jersey_number: z.coerce.number().int().optional().nullable(),
      batting_order: z.coerce.number().int().optional().nullable(),
      minutes_played: z.coerce.number().int().optional().nullable(),
    })),
  });
  const { players } = schema.parse(req.body);

  const ids = players.map((p) => p.player_id);
  if (new Set(ids).size !== ids.length) throw new ApiError(422, 'The same athlete appears twice in this lineup.');
  const starters = players.filter((p) => p.is_starting && !p.is_substitute).length;
  const squadSize = sport.config.squadSize;
  if (squadSize && starters > squadSize) {
    throw new ApiError(422, `${sport.name} allows ${squadSize} in the starting lineup — you have selected ${starters}.`);
  }
  if (players.filter((p) => p.is_captain).length > 1) throw new ApiError(422, 'Only one captain can be named.');

  tx(() => {
    const keep = new Set(ids);
    const existing = db.prepare('SELECT player_id FROM match_players WHERE match_id = ?').all(match.id).map((r) => r.player_id);
    for (const playerId of existing) {
      if (!keep.has(playerId)) {
        const hasPerf = db.prepare('SELECT id FROM match_performances WHERE match_id = ? AND player_id = ?').get(match.id, playerId);
        if (hasPerf) throw new ApiError(409, 'Remove the recorded performance before dropping that athlete from the lineup.');
        db.prepare('DELETE FROM match_players WHERE match_id = ? AND player_id = ?').run(match.id, playerId);
      }
    }
    const stmt = db.prepare(`
      INSERT INTO match_players (match_id, player_id, team_id, partner_id, is_starting, is_substitute, is_captain, is_keeper, position, jersey_number, batting_order, minutes_played)
      VALUES (@match_id, @player_id, @team_id, @partner_id, @is_starting, @is_substitute, @is_captain, @is_keeper, @position, @jersey_number, @batting_order, @minutes_played)
      ON CONFLICT(match_id, player_id) DO UPDATE SET
        team_id = excluded.team_id, partner_id = excluded.partner_id, is_starting = excluded.is_starting,
        is_substitute = excluded.is_substitute, is_captain = excluded.is_captain, is_keeper = excluded.is_keeper,
        position = excluded.position, jersey_number = excluded.jersey_number,
        batting_order = excluded.batting_order, minutes_played = excluded.minutes_played
    `);
    for (const p of players) {
      stmt.run({
        match_id: match.id,
        player_id: p.player_id,
        team_id: p.team_id ?? match.home_team_id ?? null,
        partner_id: p.partner_id ?? null,
        is_starting: p.is_starting,
        is_substitute: p.is_substitute,
        is_captain: p.is_captain,
        is_keeper: p.is_keeper,
        position: p.position ?? null,
        jersey_number: p.jersey_number ?? null,
        batting_order: p.batting_order ?? null,
        minutes_played: p.minutes_played ?? null,
      });
    }
  });

  audit(req, { action: 'update', entity: 'match_players', entityId: match.id, summary: `Lineup set for match #${match.id} (${players.length} selected)` });
  res.json({ ok: true });
}));

/* ---- Performances --------------------------------------------------- */
router.put('/matches/:id/performances', requirePermission('performances.write'), asyncHandler(async (req, res) => {
  const match = db.prepare('SELECT * FROM matches WHERE id = ?').get(req.params.id);
  if (!match) throw new ApiError(404, 'That match does not exist.');
  if (!canAccessSport(req.user, match.sport_id)) throw new ApiError(403, 'That sport is not assigned to you.');
  const sport = getSport(String(match.sport_id));

  const schema = z.object({
    performances: z.array(z.object({
      player_id: z.coerce.number().int(),
      team_id: z.coerce.number().int().optional().nullable(),
      stats: z.record(z.string(), z.any()).default({}),
      notes: z.string().optional().nullable(),
    })),
  });
  const { performances } = schema.parse(req.body);

  const problems = [];
  const cleaned = [];
  for (const entry of performances) {
    const player = db.prepare('SELECT * FROM players WHERE id = ?').get(entry.player_id);
    if (!player) {
      problems.push(`Athlete #${entry.player_id} does not exist`);
      continue;
    }
    const inSquad = db.prepare('SELECT id FROM match_players WHERE match_id = ? AND player_id = ?').get(match.id, player.id);
    if (!inSquad) {
      problems.push(`${player.first_name} ${player.last_name} is not in this match's squad`);
      continue;
    }
    const { ok, errors, clean } = validateStats(sport.config, entry.stats);
    if (!ok) {
      problems.push(...errors.map((e) => `${player.first_name} ${player.last_name}: ${e}`));
      continue;
    }
    cleaned.push({ player, teamId: entry.team_id ?? inSquad.team_id ?? match.home_team_id, stats: clean, notes: entry.notes ?? null });
  }
  if (problems.length) throw new ApiError(422, 'Some statistics could not be saved.', problems);

  const date = String(match.scheduled_at).slice(0, 10);
  const milestones = [];

  tx(() => {
    const stmt = db.prepare(`
      INSERT INTO match_performances (match_id, player_id, sport_id, team_id, stats_json, rating, notes, created_by)
      VALUES (@match_id, @player_id, @sport_id, @team_id, @stats_json, @rating, @notes, @created_by)
      ON CONFLICT(match_id, player_id) DO UPDATE SET
        team_id = excluded.team_id, stats_json = excluded.stats_json, rating = excluded.rating,
        notes = excluded.notes, updated_at = datetime('now')
    `);
    for (const c of cleaned) {
      stmt.run({
        match_id: match.id,
        player_id: c.player.id,
        sport_id: match.sport_id,
        team_id: c.teamId ?? null,
        stats_json: JSON.stringify(c.stats),
        rating: computeMatchRating(sport.config, c.stats),
        notes: c.notes,
        created_by: req.user.id,
      });

      // The match appears in the athlete's history, and notable feats become
      // milestones — this is what keeps the career timeline self-assembling.
      timeline.addEvent({
        playerId: c.player.id, date, type: 'match',
        title: `Played ${sport.name}${match.opponent_name ? ` vs ${match.opponent_name}` : ''}`,
        description: match.result_summary || match.venue || null,
        sportId: match.sport_id, refTable: 'matches', refId: match.id, importance: 1, userId: req.user.id,
      });
      const found = timeline.checkMilestones({
        playerId: c.player.id, sportId: match.sport_id, sportCode: sport.code, sportName: sport.name,
        stats: c.stats, matchId: match.id, date,
      });
      milestones.push(...found.map((m) => `${c.player.first_name} ${c.player.last_name}: ${m}`));
    }
  });

  audit(req, { action: 'update', entity: 'match_performances', entityId: match.id, summary: `Performances saved for match #${match.id} (${cleaned.length} athletes)` });
  res.json({ ok: true, saved: cleaned.length, milestones });
}));

router.delete('/matches/:id/performances/:playerId', requirePermission('performances.write'), asyncHandler(async (req, res) => {
  const row = db.prepare('SELECT * FROM match_performances WHERE match_id = ? AND player_id = ?').get(req.params.id, req.params.playerId);
  if (!row) throw new ApiError(404, 'No performance recorded for that athlete in this match.');
  db.prepare('DELETE FROM match_performances WHERE id = ?').run(row.id);
  timeline.removeEvent('matches', Number(req.params.id));
  audit(req, { action: 'delete', entity: 'match_performances', entityId: row.id, summary: 'Performance removed', before: row });
  res.json({ ok: true });
}));

module.exports = router;
