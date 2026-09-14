'use strict';
/**
 * A sport's own workspace.
 *
 * Each sport gets its own module rather than sharing one crowded screen, but
 * the panels are assembled from the sport's configuration rather than written
 * per sport. That keeps the founding rule intact: adding handball means adding
 * a block of configuration, not another page and another endpoint.
 *
 * What differs between sports is which figures matter and which visual reads
 * them — a cricket workspace wants run rate and a wagon wheel, a racket sport
 * wants rally length and momentum. Those choices already live in the sport's
 * config (`headline`, `events.charts`, `events.periodLabel`), so this endpoint
 * reads them rather than branching on the sport's name.
 */
const express = require('express');
const { db, parseJson } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { ApiError } = require('../middleware/error');
const { allowedTeamIds, allowedPlayerIds } = require('../middleware/scope');
const { getSport, playerCareer } = require('../lib/repo');
const { analyseMatch } = require('../lib/match-analysis');
const tracking = require('../lib/tracking-analysis');

const router = express.Router();

const round = (n, dp = 1) => (Number.isFinite(n) ? Math.round(n * 10 ** dp) / 10 ** dp : null);

/**
 * Everything one sport's screen needs, in a single request.
 * A workspace that fires eight requests feels slower than it is.
 */
router.get('/sports/:idOrCode/workspace', requireAuth, (req, res) => {
  const sport = getSport(req.params.idOrCode);
  if (!sport) throw new ApiError(404, 'That sport does not exist.');

  const teamScope = allowedTeamIds(req.user);
  const playerScope = allowedPlayerIds(req.user);
  const teamFilter = teamScope === null ? '' : `AND t.id IN (${teamScope.length ? teamScope.join(',') : '0'})`;

  /* ---- Squads ---- */
  const teams = db
    .prepare(`SELECT t.id, t.name, t.age_group, t.level, t.is_active,
                     (SELECT COUNT(*) FROM team_memberships tm WHERE tm.team_id = t.id AND tm.end_date IS NULL) AS squad_size,
                     (SELECT COUNT(*) FROM matches m WHERE m.home_team_id = t.id AND m.status = 'completed') AS played,
                     (SELECT COUNT(*) FROM matches m WHERE m.home_team_id = t.id AND m.result = 'win') AS won
              FROM teams t WHERE t.sport_id = ? AND t.is_active = 1 ${teamFilter}
              ORDER BY t.name`)
    .all(sport.id);

  /* ---- Athletes registered for this sport ---- */
  const athleteRows = db
    .prepare(`SELECT p.id, p.athlete_id, p.first_name, p.last_name, p.display_name, p.photo_url, p.status,
                     ps.position, ps.is_primary
              FROM player_sports ps JOIN players p ON p.id = ps.player_id
              WHERE ps.sport_id = ?`)
    .all(sport.id)
    .filter((p) => playerScope === null || playerScope.includes(p.id));

  /* ---- Recent and upcoming fixtures ---- */
  const recent = db
    .prepare(`SELECT m.id, m.scheduled_at, m.venue, m.opponent_name, m.result, m.home_score, m.away_score,
                     m.result_summary, t.name AS team_name,
                     (SELECT COUNT(*) FROM match_events e WHERE e.match_id = m.id) AS event_count
              FROM matches m LEFT JOIN teams t ON t.id = m.home_team_id
              WHERE m.sport_id = ? AND m.status = 'completed'
              ORDER BY m.scheduled_at DESC LIMIT 8`)
    .all(sport.id);

  const upcoming = db
    .prepare(`SELECT m.id, m.scheduled_at, m.venue, m.opponent_name, t.name AS team_name
              FROM matches m LEFT JOIN teams t ON t.id = m.home_team_id
              WHERE m.sport_id = ? AND m.scheduled_at >= datetime('now') AND m.status != 'cancelled'
              ORDER BY m.scheduled_at LIMIT 6`)
    .all(sport.id);

  /* ---- Leaders, on whatever this sport counts as headline figures ---- */
  const headlineKeys = (sport.config.headline || []).slice(0, 4);
  const careers = athleteRows
    .map((p) => {
      const career = playerCareer(p.id, sport, {});
      return {
        player: {
          id: p.id, athleteId: p.athlete_id, name: p.display_name || `${p.first_name} ${p.last_name}`,
          photoUrl: p.photo_url, position: p.position, status: p.status,
        },
        matches: career.matchesPlayed,
        rating: career.rating?.overall ?? null,
        values: career.career.values,
        headline: career.headline,
      };
    })
    .filter((c) => c.matches > 0);

  const leaders = headlineKeys.map((h) => {
    const key = typeof h === 'string' ? h : h.key;
    const label = typeof h === 'string' ? key : (h.label || key);
    const lowerIsBetter = /average|economy|conceded|error/i.test(key) && /economy|conceded|error/i.test(key);
    const ranked = careers
      .filter((c) => Number.isFinite(Number(c.values[key])))
      .sort((a, b) => (lowerIsBetter ? Number(a.values[key]) - Number(b.values[key]) : Number(b.values[key]) - Number(a.values[key])))
      .slice(0, 5)
      .map((c) => ({ player: c.player, value: round(Number(c.values[key]), 2), matches: c.matches }));
    return { key, label, lowerIsBetter, leaders: ranked };
  }).filter((l) => l.leaders.length);

  /* ---- The event layer, aggregated across this sport's scored matches ---- */
  const scoredIds = db
    .prepare(`SELECT DISTINCT e.match_id FROM match_events e JOIN matches m ON m.id = e.match_id
              WHERE m.sport_id = ? ORDER BY e.match_id DESC LIMIT 6`)
    .all(sport.id)
    .map((r) => r.match_id);

  const players = new Map(athleteRows.map((p) => [p.id, p]));
  const analyses = scoredIds.map((id) => {
    const events = db
      .prepare('SELECT * FROM match_events WHERE match_id = ? ORDER BY sequence')
      .all(id)
      .map((e) => ({ ...e, payload: parseJson(e.payload_json, {}) }));
    const periods = db.prepare('SELECT * FROM match_periods WHERE match_id = ? ORDER BY sequence').all(id);
    const match = db.prepare('SELECT scheduled_at, opponent_name FROM matches WHERE id = ?').get(id);
    return { matchId: id, match, analysis: analyseMatch(sport, events, players, periods) };
  });

  // What the sport's own configuration says is worth drawing.
  const charts = sport.config.events?.charts || [];
  const eventsConfig = sport.config.events || {};

  /* ---- Ball tracking, where the sport has it ---- */
  const trackedDeliveries = db
    .prepare(`SELECT d.* FROM deliveries d JOIN tracking_sessions s ON s.id = d.session_id
              WHERE s.sport_id = ? ORDER BY d.id DESC LIMIT 900`)
    .all(sport.id);

  const trackingSummary = trackedDeliveries.length
    ? {
      deliveries: trackedDeliveries.length,
      speed: tracking.speedSummary(trackedDeliveries),
      pitchMap: tracking.pitchMap(trackedDeliveries),
      stumpLine: tracking.stumpLine(trackedDeliveries),
      consistency: tracking.consistency(trackedDeliveries),
      sessions: db.prepare('SELECT COUNT(*) AS c FROM tracking_sessions WHERE sport_id = ?').get(sport.id).c,
    }
    : null;

  /* ---- Training and development for this sport ---- */
  const training = db
    .prepare(`SELECT COUNT(*) AS sessions,
                     COALESCE(AVG(duration_minutes), 0) AS avg_minutes,
                     COALESCE(AVG(intensity), 0) AS avg_intensity
              FROM training_sessions WHERE sport_id = ?`)
    .get(sport.id);

  const attendance = db
    .prepare(`SELECT COUNT(*) AS total,
                     SUM(CASE WHEN ta.status IN ('present','late') THEN 1 ELSE 0 END) AS attended
              FROM training_attendance ta JOIN training_sessions ts ON ts.id = ta.session_id
              WHERE ts.sport_id = ?`)
    .get(sport.id);

  /* ---- Form, as a run of recent results ---- */
  const form = recent.slice(0, 6).map((m) => m.result).filter(Boolean);

  res.json({
    sport: {
      id: sport.id, code: sport.code, name: sport.name, color: sport.color,
      category: sport.category, description: sport.description,
    },
    // Everything the screen needs to decide what to draw, taken from the
    // sport's configuration rather than hard-coded per sport.
    presentation: {
      charts,
      periodLabel: eventsConfig.periodLabel || 'Period',
      periodNoun: eventsConfig.periodNoun || 'period',
      progressUnit: eventsConfig.progressUnit || null,
      surface: eventsConfig.surface || null,
      ballBased: !!eventsConfig.ballBased,
      pointBased: !!eventsConfig.pointBased,
      clockBased: !!eventsConfig.clockBased,
      eventTypes: (eventsConfig.types || []).map((t) => ({ key: t.key, label: t.label })),
      headline: headlineKeys.map((h) => (typeof h === 'string' ? { key: h, label: h } : { key: h.key, label: h.label || h.key })),
    },
    summary: {
      athletes: athleteRows.length,
      activeAthletes: athleteRows.filter((p) => p.status === 'active').length,
      squads: teams.length,
      matchesPlayed: recent.length ? db.prepare(`SELECT COUNT(*) AS c FROM matches WHERE sport_id = ? AND status = 'completed'`).get(sport.id).c : 0,
      wins: db.prepare(`SELECT COUNT(*) AS c FROM matches WHERE sport_id = ? AND result = 'win'`).get(sport.id).c,
      scoredBallByBall: db.prepare(`SELECT COUNT(DISTINCT e.match_id) AS c FROM match_events e JOIN matches m ON m.id = e.match_id WHERE m.sport_id = ?`).get(sport.id).c,
      trackedDeliveries: trackedDeliveries.length,
      trainingSessions: training.sessions,
      attendanceRate: attendance.total ? round((attendance.attended / attendance.total) * 100) : null,
      averageIntensity: round(training.avg_intensity),
    },
    form,
    teams,
    leaders,
    recent,
    upcoming,
    analyses: analyses.map((a) => ({
      matchId: a.matchId,
      scheduledAt: a.match?.scheduled_at,
      opponent: a.match?.opponent_name,
      periods: a.analysis.periods.map((p) => ({
        label: p.period.label,
        kind: p.kind,
        summary: p.summary,
        overByOver: p.overByOver || null,
        worm: p.worm || null,
        phases: p.phases || null,
        shotMap: p.shotMap || null,
        momentum: p.momentum || null,
        progression: p.progression || null,
        reasons: p.reasons || null,
        rallyBuckets: p.rallyBuckets || null,
        wagonWheel: p.wagonWheel || null,
      })),
      overall: a.analysis.overall.summary,
    })),
    tracking: trackingSummary,
  });
});

module.exports = router;
