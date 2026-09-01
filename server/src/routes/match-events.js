'use strict';
/**
 * Ball-by-ball capture and match analysis.
 *
 * Recording an event is the only write here. Everything read back — the
 * scorecard, the run rate, the shot map, the momentum chart — is derived from
 * those events on request, so a correction to one delivery propagates
 * everywhere without a rebuild step.
 *
 * Saving events also refreshes match_performances for the players involved,
 * which is what connects this layer to the career records: score a match ball
 * by ball and nobody has to type a scorecard afterwards.
 */
const express = require('express');
const { z } = require('zod');
const { db, parseJson, tx } = require('../db');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { audit } = require('../middleware/audit');
const { asyncHandler, ApiError } = require('../middleware/error');
const { canAccessSport } = require('../middleware/scope');
const { getSport } = require('../lib/repo');
const { computeMatchRating } = require('../lib/stats-engine');
const { analyseMatch, derivePerformances, describeEvent } = require('../lib/match-analysis');
const timeline = require('../lib/timeline');

const router = express.Router();

/* ------------------------------------------------------------------ */
/* Loading                                                             */
/* ------------------------------------------------------------------ */

function loadMatch(id) {
  const match = db.prepare('SELECT * FROM matches WHERE id = ?').get(id);
  if (!match) throw new ApiError(404, 'That match does not exist.');
  return match;
}

function loadEvents(matchId) {
  return db
    .prepare('SELECT * FROM match_events WHERE match_id = ? ORDER BY sequence, id')
    .all(matchId)
    .map((e) => ({ ...e, payload: parseJson(e.payload_json, {}) }));
}

function loadPeriods(matchId) {
  return db.prepare('SELECT * FROM match_periods WHERE match_id = ? ORDER BY sequence').all(matchId);
}

/** Every player who could appear in this match, for name resolution. */
function loadPlayers(matchId) {
  const rows = db
    .prepare(`SELECT DISTINCT p.id, p.first_name, p.last_name, p.display_name, p.photo_url, p.athlete_id
              FROM players p
              WHERE p.id IN (SELECT player_id FROM match_players WHERE match_id = ?)
                 OR p.id IN (SELECT primary_player_id FROM match_events WHERE match_id = ?)
                 OR p.id IN (SELECT secondary_player_id FROM match_events WHERE match_id = ?)
                 OR p.id IN (SELECT tertiary_player_id FROM match_events WHERE match_id = ?)`)
    .all(matchId, matchId, matchId, matchId);
  return new Map(rows.map((r) => [r.id, r]));
}

/* ------------------------------------------------------------------ */
/* Keeping the scorecard in step with the events                        */
/* ------------------------------------------------------------------ */

/**
 * Recompute match_performances for this match from its events.
 *
 * Only statistics the sport declares as derivable are touched; anything a
 * scorer typed by hand that events cannot produce (minutes played, a coach
 * rating) is preserved.
 */
function refreshPerformances(match, sport, userId) {
  const events = loadEvents(match.id);
  if (!events.length) return { updated: 0 };

  const derived = derivePerformances(sport.config, events);
  const derivableStats = new Set((sport.config.events?.derive || []).map((r) => r.stat));
  const squad = db.prepare('SELECT player_id, team_id FROM match_players WHERE match_id = ?').all(match.id);
  const squadTeam = new Map(squad.map((s) => [s.player_id, s.team_id]));

  const upsert = db.prepare(`
    INSERT INTO match_performances (match_id, player_id, sport_id, team_id, stats_json, rating, notes, created_by)
    VALUES (@match_id, @player_id, @sport_id, @team_id, @stats_json, @rating, NULL, @created_by)
    ON CONFLICT(match_id, player_id) DO UPDATE SET
      stats_json = excluded.stats_json, rating = excluded.rating, updated_at = datetime('now')
  `);

  let updated = 0;
  tx(() => {
    for (const [playerId, stats] of derived) {
      const existing = db
        .prepare('SELECT stats_json FROM match_performances WHERE match_id = ? AND player_id = ?')
        .get(match.id, playerId);

      // Start from what is already there, drop the derivable keys, then layer
      // the freshly derived values on top.
      const merged = { ...parseJson(existing?.stats_json, {}) };
      for (const key of derivableStats) delete merged[key];
      Object.assign(merged, stats);

      upsert.run({
        match_id: match.id,
        player_id: playerId,
        sport_id: match.sport_id,
        team_id: squadTeam.get(playerId) ?? match.home_team_id ?? null,
        stats_json: JSON.stringify(merged),
        rating: computeMatchRating(sport.config, merged),
        created_by: userId,
      });

      // An athlete who appears in the events but was never named in the squad
      // is added to it, so the scorecard and the lineup cannot disagree.
      if (!squadTeam.has(playerId)) {
        db.prepare(`INSERT OR IGNORE INTO match_players (match_id, player_id, team_id, is_starting)
                    VALUES (?,?,?,1)`)
          .run(match.id, playerId, match.home_team_id ?? null);
      }
      updated += 1;
    }
  });

  return { updated };
}

/* ------------------------------------------------------------------ */
/* Periods                                                             */
/* ------------------------------------------------------------------ */

router.get('/matches/:id/periods', requireAuth, (req, res) => {
  const match = loadMatch(req.params.id);
  res.json({ periods: loadPeriods(match.id) });
});

const periodSchema = z.object({
  sequence: z.coerce.number().int().min(1).max(20),
  label: z.string().min(1),
  team_id: z.coerce.number().int().optional().nullable(),
  team_label: z.string().optional().nullable(),
  opponent_label: z.string().optional().nullable(),
  planned_length: z.coerce.number().optional().nullable(),
  target: z.coerce.number().int().optional().nullable(),
  status: z.enum(['pending', 'in_progress', 'complete', 'abandoned']).default('in_progress'),
  notes: z.string().optional().nullable(),
});

router.post('/matches/:id/periods', requirePermission('performances.write'), asyncHandler(async (req, res) => {
  const match = loadMatch(req.params.id);
  if (!canAccessSport(req.user, match.sport_id)) throw new ApiError(403, 'That sport is not assigned to you.');
  const body = periodSchema.parse(req.body);

  const existing = db.prepare('SELECT id FROM match_periods WHERE match_id = ? AND sequence = ?').get(match.id, body.sequence);
  if (existing) throw new ApiError(409, `${body.label} already exists for this match.`);

  const cols = Object.keys(body);
  const info = db
    .prepare(`INSERT INTO match_periods (match_id, ${cols.join(',')}) VALUES (?, ${cols.map(() => '?').join(',')})`)
    .run(match.id, ...cols.map((c) => body[c] ?? null));

  audit(req, { action: 'create', entity: 'match_periods', entityId: info.lastInsertRowid, summary: `${body.label} opened for match #${match.id}` });
  res.status(201).json({ period: db.prepare('SELECT * FROM match_periods WHERE id = ?').get(info.lastInsertRowid) });
}));

router.put('/matches/:id/periods/:periodId', requirePermission('performances.write'), asyncHandler(async (req, res) => {
  const match = loadMatch(req.params.id);
  const period = db.prepare('SELECT * FROM match_periods WHERE id = ? AND match_id = ?').get(req.params.periodId, match.id);
  if (!period) throw new ApiError(404, 'That period does not exist.');
  const body = periodSchema.partial().parse(req.body);
  const sets = Object.keys(body).map((k) => `${k} = ?`);
  if (sets.length) {
    db.prepare(`UPDATE match_periods SET ${sets.join(', ')}, updated_at = datetime('now') WHERE id = ?`)
      .run(...Object.values(body).map((v) => (v === '' ? null : v)), period.id);
  }
  audit(req, { action: 'update', entity: 'match_periods', entityId: period.id, summary: `${period.label} updated` });
  res.json({ period: db.prepare('SELECT * FROM match_periods WHERE id = ?').get(period.id) });
}));

/* ------------------------------------------------------------------ */
/* Events                                                              */
/* ------------------------------------------------------------------ */

router.get('/matches/:id/events', requireAuth, (req, res) => {
  const match = loadMatch(req.params.id);
  const sport = getSport(String(match.sport_id));
  const players = loadPlayers(match.id);
  let events = loadEvents(match.id);
  if (req.query.period) events = events.filter((e) => e.period_id === Number(req.query.period));
  if (req.query.type) events = events.filter((e) => e.event_type === req.query.type);
  if (req.query.player) {
    const id = Number(req.query.player);
    events = events.filter((e) => [e.primary_player_id, e.secondary_player_id, e.tertiary_player_id].includes(id));
  }

  res.json({
    events: events.map((e) => ({
      ...e,
      payload_json: undefined,
      commentary: e.commentary || describeEvent(e, players, sport.code),
      primary_name: players.get(e.primary_player_id)?.display_name
        || (players.get(e.primary_player_id) ? `${players.get(e.primary_player_id).first_name} ${players.get(e.primary_player_id).last_name}` : null),
      secondary_name: players.get(e.secondary_player_id)?.display_name
        || (players.get(e.secondary_player_id) ? `${players.get(e.secondary_player_id).first_name} ${players.get(e.secondary_player_id).last_name}` : null),
      tertiary_name: players.get(e.tertiary_player_id)?.display_name
        || (players.get(e.tertiary_player_id) ? `${players.get(e.tertiary_player_id).first_name} ${players.get(e.tertiary_player_id).last_name}` : null),
    })),
    total: events.length,
  });
});

const eventSchema = z.object({
  period_id: z.coerce.number().int().optional().nullable(),
  event_type: z.string().min(1),
  over_number: z.coerce.number().optional().nullable(),
  ball_in_over: z.coerce.number().int().min(0).max(12).optional().nullable(),
  minute: z.coerce.number().min(0).max(200).optional().nullable(),
  clock: z.string().optional().nullable(),
  team_id: z.coerce.number().int().optional().nullable(),
  primary_player_id: z.coerce.number().int().optional().nullable(),
  secondary_player_id: z.coerce.number().int().optional().nullable(),
  tertiary_player_id: z.coerce.number().int().optional().nullable(),
  opponent_name: z.string().optional().nullable(),
  x: z.coerce.number().min(0).max(100).optional().nullable(),
  y: z.coerce.number().min(0).max(100).optional().nullable(),
  end_x: z.coerce.number().min(0).max(100).optional().nullable(),
  end_y: z.coerce.number().min(0).max(100).optional().nullable(),
  outcome: z.string().optional().nullable(),
  payload: z.record(z.string(), z.any()).default({}),
  commentary: z.string().optional().nullable(),
});

/** Validate a payload against the event type the sport declares. */
function validatePayload(sport, eventType, payload) {
  const definition = (sport.config.events?.types || []).find((t) => t.key === eventType);
  if (!definition) {
    const known = (sport.config.events?.types || []).map((t) => t.key).join(', ');
    throw new ApiError(422, `"${eventType}" is not an event type for ${sport.name}. Accepted: ${known || 'none configured'}.`);
  }
  const errors = [];
  const clean = {};
  for (const field of definition.fields || []) {
    if (!(field.key in payload)) continue;
    const raw = payload[field.key];
    if (raw === null || raw === '' || raw === undefined) continue;
    if (field.type === 'bool') { clean[field.key] = raw === true || raw === 1 || raw === '1' || raw === 'true' ? 1 : 0; continue; }
    if (field.type === 'select') {
      if (field.options && !field.options.includes(String(raw))) {
        errors.push(`${field.label}: "${raw}" is not an accepted value`);
        continue;
      }
      clean[field.key] = String(raw);
      continue;
    }
    if (field.type === 'text') { clean[field.key] = String(raw); continue; }
    const n = Number(raw);
    if (!Number.isFinite(n)) { errors.push(`${field.label} must be a number`); continue; }
    if (field.min !== undefined && n < field.min) errors.push(`${field.label} cannot be below ${field.min}`);
    if (field.max !== undefined && n > field.max) errors.push(`${field.label} cannot be above ${field.max}`);
    clean[field.key] = n;
  }
  // Fields the capture console sets that are not in the declared list but are
  // meaningful to the analysis (which batter was dismissed, for instance).
  for (const passthrough of ['dismissed_player_id', 'text']) {
    if (payload[passthrough] !== undefined && payload[passthrough] !== '') clean[passthrough] = payload[passthrough];
  }
  if (errors.length) throw new ApiError(422, 'That event could not be recorded.', errors);
  return clean;
}

/** Cricket bookkeeping: work out which over and ball this delivery is. */
function nextBallPosition(matchId, periodId) {
  const balls = db
    .prepare(`SELECT over_number, ball_in_over, payload_json FROM match_events
              WHERE match_id = ? AND period_id IS ? AND event_type = 'ball' AND is_void = 0
              ORDER BY sequence DESC, id DESC LIMIT 1`)
    .get(matchId, periodId ?? null);
  if (!balls) return { over_number: 0, ball_in_over: 1 };

  const payload = parseJson(balls.payload_json, {});
  const extra = String(payload.extra_type || '').toLowerCase();
  const counted = !['wide', 'no ball'].includes(extra);
  const over = Math.floor(Number(balls.over_number) || 0);
  const ball = Number(balls.ball_in_over) || 0;

  if (!counted) return { over_number: over, ball_in_over: ball };   // re-bowl the same ball
  if (ball >= 6) return { over_number: over + 1, ball_in_over: 1 };
  return { over_number: over, ball_in_over: ball + 1 };
}

router.post('/matches/:id/events', requirePermission('performances.write'), asyncHandler(async (req, res) => {
  const match = loadMatch(req.params.id);
  if (!canAccessSport(req.user, match.sport_id)) throw new ApiError(403, 'That sport is not assigned to you.');
  const sport = getSport(String(match.sport_id));
  const body = eventSchema.parse(req.body);
  const payload = validatePayload(sport, body.event_type, body.payload);

  if (body.period_id) {
    const period = db.prepare('SELECT id FROM match_periods WHERE id = ? AND match_id = ?').get(body.period_id, match.id);
    if (!period) throw new ApiError(404, 'That period does not belong to this match.');
  }

  // Cricket positions itself; other sports use whatever the scorer gives.
  let position = { over_number: body.over_number, ball_in_over: body.ball_in_over };
  if (sport.config.events?.ballBased && body.event_type === 'ball'
      && (body.over_number === null || body.over_number === undefined)) {
    position = nextBallPosition(match.id, body.period_id);
  }

  const sequence = (db.prepare('SELECT MAX(sequence) AS m FROM match_events WHERE match_id = ?').get(match.id).m || 0) + 1;

  const info = db.prepare(`
    INSERT INTO match_events (match_id, period_id, sequence, event_type, over_number, ball_in_over,
      minute, clock, team_id, primary_player_id, secondary_player_id, tertiary_player_id,
      opponent_name, x, y, end_x, end_y, outcome, payload_json, commentary, created_by)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    match.id, body.period_id ?? null, sequence, body.event_type,
    position.over_number ?? null, position.ball_in_over ?? null,
    body.minute ?? null, body.clock ?? null, body.team_id ?? match.home_team_id ?? null,
    body.primary_player_id ?? null, body.secondary_player_id ?? null, body.tertiary_player_id ?? null,
    body.opponent_name ?? null, body.x ?? null, body.y ?? null, body.end_x ?? null, body.end_y ?? null,
    body.outcome ?? null, JSON.stringify(payload), body.commentary ?? null, req.user.id,
  );

  const { updated } = refreshPerformances(match, sport, req.user.id);

  // A century, a five-for or a hat-trick recorded ball by ball reaches the
  // athlete's timeline the same way a typed scorecard would.
  const milestones = [];
  const derived = derivePerformances(sport.config, loadEvents(match.id));
  const date = String(match.scheduled_at).slice(0, 10);
  for (const [playerId, stats] of derived) {
    const found = timeline.checkMilestones({
      playerId, sportId: match.sport_id, sportCode: sport.code, sportName: sport.name,
      stats, matchId: match.id, date,
    });
    milestones.push(...found);
  }

  const saved = db.prepare('SELECT * FROM match_events WHERE id = ?').get(info.lastInsertRowid);
  const players = loadPlayers(match.id);
  res.status(201).json({
    event: {
      ...saved,
      payload: parseJson(saved.payload_json, {}),
      payload_json: undefined,
      commentary: saved.commentary || describeEvent({ ...saved, payload }, players, sport.code),
    },
    performancesUpdated: updated,
    milestones,
  });
}));

router.put('/matches/:id/events/:eventId', requirePermission('performances.write'), asyncHandler(async (req, res) => {
  const match = loadMatch(req.params.id);
  const sport = getSport(String(match.sport_id));
  const existing = db.prepare('SELECT * FROM match_events WHERE id = ? AND match_id = ?').get(req.params.eventId, match.id);
  if (!existing) throw new ApiError(404, 'That event does not exist.');

  const body = eventSchema.partial().extend({ is_void: z.coerce.number().int().min(0).max(1).optional() }).parse(req.body);
  const payload = body.payload
    ? validatePayload(sport, body.event_type || existing.event_type, body.payload)
    : null;

  const sets = [];
  const params = [];
  for (const key of ['period_id', 'event_type', 'over_number', 'ball_in_over', 'minute', 'clock', 'team_id',
    'primary_player_id', 'secondary_player_id', 'tertiary_player_id', 'opponent_name',
    'x', 'y', 'end_x', 'end_y', 'outcome', 'commentary', 'is_void']) {
    if (key in body) { sets.push(`${key} = ?`); params.push(body[key] === '' ? null : body[key]); }
  }
  if (payload) { sets.push('payload_json = ?'); params.push(JSON.stringify(payload)); }
  if (sets.length) {
    db.prepare(`UPDATE match_events SET ${sets.join(', ')}, updated_at = datetime('now') WHERE id = ?`)
      .run(...params, existing.id);
  }

  const { updated } = refreshPerformances(match, sport, req.user.id);
  audit(req, { action: 'update', entity: 'match_events', entityId: existing.id, summary: `Event corrected in match #${match.id}` });
  res.json({ ok: true, performancesUpdated: updated });
}));

/**
 * Remove the last event — the undo a scorer reaches for mid-over.
 * Earlier events are voided rather than deleted, so the record of the
 * correction survives.
 */
router.delete('/matches/:id/events/:eventId', requirePermission('performances.write'), asyncHandler(async (req, res) => {
  const match = loadMatch(req.params.id);
  const sport = getSport(String(match.sport_id));
  const event = db.prepare('SELECT * FROM match_events WHERE id = ? AND match_id = ?').get(req.params.eventId, match.id);
  if (!event) throw new ApiError(404, 'That event does not exist.');

  const last = db.prepare('SELECT id FROM match_events WHERE match_id = ? ORDER BY sequence DESC, id DESC LIMIT 1').get(match.id);
  if (last && last.id === event.id) {
    db.prepare('DELETE FROM match_events WHERE id = ?').run(event.id);
    audit(req, { action: 'delete', entity: 'match_events', entityId: event.id, summary: `Last event undone in match #${match.id}` });
  } else {
    db.prepare(`UPDATE match_events SET is_void = 1, updated_at = datetime('now') WHERE id = ?`).run(event.id);
    audit(req, { action: 'update', entity: 'match_events', entityId: event.id, summary: `Event voided in match #${match.id}` });
  }

  const { updated } = refreshPerformances(match, sport, req.user.id);
  res.json({ ok: true, performancesUpdated: updated });
}));

/* ------------------------------------------------------------------ */
/* Analysis                                                            */
/* ------------------------------------------------------------------ */

router.get('/matches/:id/analysis', requireAuth, (req, res) => {
  const match = loadMatch(req.params.id);
  const sport = getSport(String(match.sport_id));
  const events = loadEvents(match.id);
  const players = loadPlayers(match.id);
  const periods = loadPeriods(match.id);

  const analysis = analyseMatch(sport, events, players, periods);

  res.json({
    match: {
      id: match.id,
      sport: sport.name,
      sportCode: sport.code,
      scheduledAt: match.scheduled_at,
      venue: match.venue,
      status: match.status,
      result: match.result,
      resultSummary: match.result_summary,
      homeTeam: match.home_team_id ? db.prepare('SELECT name FROM teams WHERE id = ?').get(match.home_team_id)?.name : null,
      opponent: match.opponent_name,
    },
    ...analysis,
  });
});

/**
 * One athlete's involvement in one match, delivery by delivery.
 * This is the view a coach opens when reviewing a single player's game.
 */
router.get('/matches/:id/analysis/player/:playerId', requireAuth, (req, res) => {
  const match = loadMatch(req.params.id);
  const sport = getSport(String(match.sport_id));
  const playerId = Number(req.params.playerId);
  const players = loadPlayers(match.id);
  const all = loadEvents(match.id);

  const involved = all.filter((e) => [e.primary_player_id, e.secondary_player_id, e.tertiary_player_id].includes(playerId));
  const analysis = analyseMatch(sport, involved, players, loadPeriods(match.id));

  const performance = db.prepare('SELECT * FROM match_performances WHERE match_id = ? AND player_id = ?').get(match.id, playerId);
  const player = players.get(playerId);

  res.json({
    player: player || null,
    performance: performance ? { ...performance, stats: parseJson(performance.stats_json, {}), stats_json: undefined } : null,
    events: involved.length,
    asPrimary: involved.filter((e) => e.primary_player_id === playerId).length,
    asSecondary: involved.filter((e) => e.secondary_player_id === playerId).length,
    asTertiary: involved.filter((e) => e.tertiary_player_id === playerId).length,
    overall: analysis.overall,
    commentary: analysis.commentary,
  });
});

/** Rebuild the scorecard from events on demand. */
router.post('/matches/:id/analysis/rebuild', requirePermission('performances.write'), asyncHandler(async (req, res) => {
  const match = loadMatch(req.params.id);
  const sport = getSport(String(match.sport_id));
  const { updated } = refreshPerformances(match, sport, req.user.id);
  audit(req, { action: 'update', entity: 'match_performances', entityId: match.id, summary: `Scorecard rebuilt from events (${updated} athletes)` });
  res.json({ ok: true, performancesUpdated: updated });
}));

module.exports = router;
module.exports.refreshPerformances = refreshPerformances;
