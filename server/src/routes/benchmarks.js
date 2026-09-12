'use strict';
const express = require('express');
const { z } = require('zod');
const { db } = require('../db');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { audit } = require('../middleware/audit');
const { asyncHandler, ApiError } = require('../middleware/error');
const { requireCricketSport } = require('../lib/cricket-scope');
const { getSport, playerCareer } = require('../lib/repo');

const router = express.Router();

/** List benchmarks for a sport (cricket only), optionally filtered by age group. */
router.get('/', requireAuth, (req, res) => {
  const sport = requireCricketSport(req.query.sport || 'cricket');
  const where = ['sport_id = ?'];
  const params = [sport.id];
  if (req.query.age_group) { where.push('age_group = ?'); params.push(req.query.age_group); }
  const rows = db
    .prepare(`SELECT * FROM sport_benchmarks WHERE ${where.join(' AND ')} ORDER BY age_group, metric_key, level`)
    .all(...params);
  res.json({ benchmarks: rows });
});

const benchmarkSchema = z.object({
  sport_id: z.coerce.number().int().optional(),
  age_group: z.string().min(1),
  metric_key: z.string().min(1),
  benchmark_value: z.coerce.number(),
  level: z.enum(['emerging', 'developing', 'target', 'elite']).default('target'),
  notes: z.string().optional().nullable(),
});

router.post('/', requirePermission('benchmarks.write'), asyncHandler(async (req, res) => {
  const body = benchmarkSchema.parse(req.body);
  const sport = requireCricketSport(body.sport_id || 'cricket');
  const validKeys = new Set((sport.config.career || []).map((c) => c.key));
  if (!validKeys.has(body.metric_key)) {
    throw new ApiError(422, `"${body.metric_key}" is not a career statistic for ${sport.name}.`);
  }
  const info = db
    .prepare(`INSERT INTO sport_benchmarks (sport_id, age_group, metric_key, benchmark_value, level, notes, created_by)
              VALUES (?,?,?,?,?,?,?)
              ON CONFLICT (sport_id, age_group, metric_key, level)
              DO UPDATE SET benchmark_value = excluded.benchmark_value, notes = excluded.notes, updated_at = datetime('now')`)
    .run(sport.id, body.age_group, body.metric_key, body.benchmark_value, body.level, body.notes ?? null, req.user.id);
  audit(req, { action: 'upsert', entity: 'sport_benchmarks', entityId: info.lastInsertRowid, summary: `Benchmark set: ${body.age_group} ${body.metric_key} (${body.level})` });
  res.status(201).json({ ok: true });
}));

router.delete('/:id', requirePermission('benchmarks.write'), asyncHandler(async (req, res) => {
  const row = db.prepare('SELECT * FROM sport_benchmarks WHERE id = ?').get(req.params.id);
  if (!row) throw new ApiError(404, 'That benchmark does not exist.');
  requireCricketSport(row.sport_id);
  db.prepare('DELETE FROM sport_benchmarks WHERE id = ?').run(row.id);
  audit(req, { action: 'delete', entity: 'sport_benchmarks', entityId: row.id, summary: `Benchmark removed: ${row.age_group} ${row.metric_key}` });
  res.json({ ok: true });
}));

/** Compare a player's cricket career figures against their age group's benchmarks. */
router.get('/players/:playerId', requireAuth, asyncHandler(async (req, res) => {
  const sport = requireCricketSport('cricket');
  const player = db.prepare('SELECT * FROM players WHERE id = ?').get(req.params.playerId);
  if (!player) throw new ApiError(404, 'That player does not exist.');

  const ageGroup = req.query.age_group
    || db.prepare(`SELECT age_group FROM team_memberships tm JOIN teams t ON t.id = tm.team_id
                   WHERE tm.player_id = ? AND t.sport_id = ? AND tm.end_date IS NULL
                   ORDER BY tm.start_date DESC LIMIT 1`).get(player.id, sport.id)?.age_group;

  if (!ageGroup) return res.json({ ageGroup: null, career: null, benchmarks: [] });

  const career = playerCareer(player.id, sport, {});
  const benchmarkRows = db
    .prepare('SELECT * FROM sport_benchmarks WHERE sport_id = ? AND age_group = ? ORDER BY metric_key, level')
    .all(sport.id, ageGroup);

  const byMetric = new Map();
  for (const row of benchmarkRows) {
    if (!byMetric.has(row.metric_key)) byMetric.set(row.metric_key, { metric_key: row.metric_key, levels: {} });
    byMetric.get(row.metric_key).levels[row.level] = { value: row.benchmark_value, notes: row.notes };
  }

  const statDef = (key) => (sport.config.career || []).find((c) => c.key === key);
  const comparisons = [...byMetric.values()].map((entry) => {
    const def = statDef(entry.metric_key);
    const actual = career?.career?.values?.[entry.metric_key] ?? null;
    return {
      metric_key: entry.metric_key,
      label: def?.label || entry.metric_key,
      higherIsBetter: !['economy', 'bowling_average', 'bowling_strike_rate'].includes(entry.metric_key),
      actual,
      levels: entry.levels,
    };
  });

  res.json({ ageGroup, career, benchmarks: comparisons });
}));

module.exports = router;
