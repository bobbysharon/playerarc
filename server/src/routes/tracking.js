'use strict';
/**
 * Ball tracking, fitness and selection.
 *
 * Deliveries are measured somewhere else — by a coach with a speed gun, by a
 * phone app, or by a tracking provider — and recorded here. What this module
 * adds is the frame that makes those measurements comparable: a calibrated
 * session, a fixed coordinate origin, and a stated target to score against.
 *
 * No computer vision happens in this platform, and none is claimed. Every
 * delivery carries a `source` saying where its numbers came from, so a figure
 * measured by a provider is never confused with one a coach estimated.
 */
const express = require('express');
const { z } = require('zod');
const { db, parseJson, tx } = require('../db');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { audit } = require('../middleware/audit');
const { asyncHandler, ApiError } = require('../middleware/error');
const { canAccessPlayer, allowedPlayerIds } = require('../middleware/scope');
const { getSport, playerCareer } = require('../lib/repo');
const analysis = require('../lib/tracking-analysis');

const router = express.Router();

const loadDeliveries = (where, params) => db
  .prepare(`SELECT d.*, b.first_name AS bowler_first, b.last_name AS bowler_last,
                   bt.first_name AS batter_first, bt.last_name AS batter_last,
                   s.session_date, s.mode, s.title AS session_title
            FROM deliveries d
            JOIN tracking_sessions s ON s.id = d.session_id
            LEFT JOIN players b ON b.id = d.bowler_id
            LEFT JOIN players bt ON bt.id = d.batter_id
            WHERE ${where} ORDER BY s.session_date, d.sequence`)
  .all(...params)
  .map((d) => ({ ...d, trajectory: parseJson(d.trajectory_json, null), trajectory_json: undefined }));

/* ================================================================== */
/* Sessions                                                           */
/* ================================================================== */

router.get('/tracking/sessions', requireAuth, (req, res) => {
  const where = ['1 = 1'];
  const params = [];
  if (req.query.sport) { where.push('s.sport_id = ?'); params.push(Number(req.query.sport)); }
  if (req.query.mode) { where.push('s.mode = ?'); params.push(req.query.mode); }
  if (req.query.player) {
    where.push('EXISTS (SELECT 1 FROM deliveries d WHERE d.session_id = s.id AND (d.bowler_id = ? OR d.batter_id = ?))');
    params.push(Number(req.query.player), Number(req.query.player));
  }

  const sessions = db
    .prepare(`SELECT s.*, sp.name AS sport_name, sp.color, t.name AS team_name, c.full_name AS coach_name,
                     (SELECT COUNT(*) FROM deliveries d WHERE d.session_id = s.id) AS delivery_count
              FROM tracking_sessions s
              JOIN sports sp ON sp.id = s.sport_id
              LEFT JOIN teams t ON t.id = s.team_id
              LEFT JOIN coaches c ON c.id = s.coach_id
              WHERE ${where.join(' AND ')} ORDER BY s.session_date DESC, s.id DESC LIMIT 200`)
    .all(...params);
  res.json({ sessions });
});

router.get('/tracking/sessions/:id', requireAuth, (req, res) => {
  const session = db
    .prepare(`SELECT s.*, sp.name AS sport_name, sp.code AS sport_code, t.name AS team_name, c.full_name AS coach_name
              FROM tracking_sessions s JOIN sports sp ON sp.id = s.sport_id
              LEFT JOIN teams t ON t.id = s.team_id LEFT JOIN coaches c ON c.id = s.coach_id
              WHERE s.id = ?`)
    .get(req.params.id);
  if (!session) throw new ApiError(404, 'That tracking session does not exist.');

  const deliveries = loadDeliveries('d.session_id = ?', [session.id]);
  const targets = db.prepare('SELECT * FROM consistency_targets WHERE session_id = ?').all(session.id);

  // Per-bowler breakdown, because a net session usually has several.
  const bowlers = [...new Set(deliveries.map((d) => d.bowler_id).filter(Boolean))].map((id) => {
    const subset = deliveries.filter((d) => d.bowler_id === id);
    const p = db.prepare('SELECT id, first_name, last_name, display_name, photo_url FROM players WHERE id = ?').get(id);
    return {
      player: p,
      deliveries: subset.length,
      speed: analysis.speedSummary(subset),
      consistency: analysis.consistency(subset),
      stumpLine: analysis.stumpLine(subset),
    };
  }).sort((a, b) => b.deliveries - a.deliveries);

  res.json({
    session,
    deliveries,
    targets,
    bowlers,
    summary: {
      deliveries: deliveries.length,
      speed: analysis.speedSummary(deliveries),
      pitchMap: analysis.pitchMap(deliveries),
      stumpLine: analysis.stumpLine(deliveries),
      consistency: analysis.consistency(deliveries),
    },
  });
});

const sessionSchema = z.object({
  sport_id: z.coerce.number().int(),
  mode: z.enum(['nets', 'bowling_machine', 'match', 'fielding', 'fitness']).default('nets'),
  title: z.string().min(2),
  session_date: z.string().min(8),
  match_id: z.coerce.number().int().optional().nullable(),
  training_id: z.coerce.number().int().optional().nullable(),
  team_id: z.coerce.number().int().optional().nullable(),
  coach_id: z.coerce.number().int().optional().nullable(),
  venue: z.string().optional().nullable(),
  surface: z.string().optional().nullable(),
  conditions: z.string().optional().nullable(),
  calibrated: z.coerce.number().int().min(0).max(1).default(0),
  calibration_method: z.enum(['manual', 'crease_markers', 'stump_height', 'provider', 'none']).optional().nullable(),
  pitch_length_cm: z.coerce.number().min(500).max(3000).optional(),
  pitch_width_cm: z.coerce.number().min(100).max(1000).optional(),
  stump_width_cm: z.coerce.number().min(10).max(50).optional(),
  stump_height_cm: z.coerce.number().min(40).max(120).optional(),
  crease_to_stump_cm: z.coerce.number().min(50).max(300).optional(),
  calibration_note: z.string().optional().nullable(),
  machine_make: z.string().optional().nullable(),
  machine_speed_kph: z.coerce.number().min(30).max(200).optional().nullable(),
  machine_length: z.string().optional().nullable(),
  machine_line: z.string().optional().nullable(),
  machine_swing: z.string().optional().nullable(),
  source: z.enum(['manual', 'speed_gun', 'provider', 'imported']).default('manual'),
  provider: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

router.post('/tracking/sessions', requirePermission('performances.write'), asyncHandler(async (req, res) => {
  const body = sessionSchema.parse(req.body);
  if (body.mode === 'bowling_machine' && !body.machine_speed_kph) {
    throw new ApiError(422, 'Set the machine speed, so the deliveries can be read against what it was set to.');
  }
  const cols = Object.keys(body);
  const info = db
    .prepare(`INSERT INTO tracking_sessions (${cols.join(',')}, created_by) VALUES (${cols.map(() => '?').join(',')}, ?)`)
    .run(...cols.map((c) => body[c] ?? null), req.user.id);
  audit(req, { action: 'create', entity: 'tracking_sessions', entityId: info.lastInsertRowid, summary: `Tracking session opened: ${body.title}` });
  res.status(201).json({ session: db.prepare('SELECT * FROM tracking_sessions WHERE id = ?').get(info.lastInsertRowid) });
}));

/**
 * Scene calibration: record the pitch dimensions the measurements are
 * relative to. A session without it still accepts deliveries, but its
 * centimetre readings cannot be compared against another session's.
 */
router.put('/tracking/sessions/:id/calibration', requirePermission('performances.write'), asyncHandler(async (req, res) => {
  const session = db.prepare('SELECT * FROM tracking_sessions WHERE id = ?').get(req.params.id);
  if (!session) throw new ApiError(404, 'That tracking session does not exist.');

  const schema = z.object({
    method: z.enum(['manual', 'crease_markers', 'stump_height', 'provider', 'none']),
    pitch_length_cm: z.coerce.number().min(500).max(3000).optional(),
    pitch_width_cm: z.coerce.number().min(100).max(1000).optional(),
    stump_width_cm: z.coerce.number().min(10).max(50).optional(),
    stump_height_cm: z.coerce.number().min(40).max(120).optional(),
    crease_to_stump_cm: z.coerce.number().min(50).max(300).optional(),
    note: z.string().optional().nullable(),
  });
  const body = schema.parse(req.body);

  db.prepare(`UPDATE tracking_sessions SET calibrated = 1, calibration_method = ?,
              pitch_length_cm = COALESCE(?, pitch_length_cm),
              pitch_width_cm = COALESCE(?, pitch_width_cm),
              stump_width_cm = COALESCE(?, stump_width_cm),
              stump_height_cm = COALESCE(?, stump_height_cm),
              crease_to_stump_cm = COALESCE(?, crease_to_stump_cm),
              calibration_note = ?, updated_at = datetime('now')
              WHERE id = ?`)
    .run(body.method, body.pitch_length_cm ?? null, body.pitch_width_cm ?? null,
         body.stump_width_cm ?? null, body.stump_height_cm ?? null,
         body.crease_to_stump_cm ?? null, body.note ?? null, session.id);

  audit(req, { action: 'update', entity: 'tracking_sessions', entityId: session.id, summary: `Scene calibrated (${body.method})` });
  res.json({ session: db.prepare('SELECT * FROM tracking_sessions WHERE id = ?').get(session.id) });
}));

/* ================================================================== */
/* Deliveries                                                         */
/* ================================================================== */

const deliverySchema = z.object({
  event_id: z.coerce.number().int().optional().nullable(),
  over_number: z.coerce.number().int().min(0).max(120).optional().nullable(),
  ball_in_over: z.coerce.number().int().min(1).max(12).optional().nullable(),
  bowler_id: z.coerce.number().int().optional().nullable(),
  batter_id: z.coerce.number().int().optional().nullable(),
  batter_handedness: z.enum(['right', 'left']).optional().nullable(),
  release_speed_kph: z.coerce.number().min(30).max(200).optional().nullable(),
  speed_off_pitch_kph: z.coerce.number().min(20).max(200).optional().nullable(),
  pitch_x_cm: z.coerce.number().min(-250).max(250).optional().nullable(),
  pitch_y_cm: z.coerce.number().min(-200).max(2100).optional().nullable(),
  bounce_height_cm: z.coerce.number().min(0).max(300).optional().nullable(),
  stump_x_cm: z.coerce.number().min(-250).max(250).optional().nullable(),
  stump_z_cm: z.coerce.number().min(-50).max(300).optional().nullable(),
  deviation_deg: z.coerce.number().min(-30).max(30).optional().nullable(),
  swing_deg: z.coerce.number().min(-30).max(30).optional().nullable(),
  spin_rpm: z.coerce.number().min(0).max(4000).optional().nullable(),
  release_height_cm: z.coerce.number().min(100).max(300).optional().nullable(),
  delivery_type: z.string().optional().nullable(),
  target_id: z.coerce.number().int().optional().nullable(),
  outcome: z.string().optional().nullable(),
  runs: z.coerce.number().int().min(0).max(8).optional().nullable(),
  wicket: z.coerce.number().int().min(0).max(1).default(0),
  machine_delivery: z.coerce.number().int().min(0).max(1).default(0),
  trajectory: z.array(z.object({ x: z.number(), y: z.number(), z: z.number(), t: z.number().optional() })).optional(),
  source: z.enum(['manual', 'speed_gun', 'provider', 'imported']).default('manual'),
  notes: z.string().optional().nullable(),
});

/**
 * Record a delivery. The zones, the stump reading and the target score are
 * all worked out from the coordinates rather than typed, so they cannot
 * disagree with the measurement they came from.
 */
function buildDelivery(session, body, sequence) {
  const hand = body.batter_handedness
    || (body.batter_id
      ? (db.prepare('SELECT preferred_hand FROM players WHERE id = ?').get(body.batter_id)?.preferred_hand ?? 'right')
      : 'right');

  const target = body.target_id
    ? db.prepare('SELECT * FROM consistency_targets WHERE id = ?').get(body.target_id)
    : db.prepare('SELECT * FROM consistency_targets WHERE session_id = ? AND player_id IS ? AND active = 1 LIMIT 1')
      .get(session.id, body.bowler_id ?? null);

  const stump = analysis.stumpReading(body.stump_x_cm ?? null, body.stump_z_cm ?? null, hand);
  const aim = analysis.targetReading({ ...body, batter_handedness: hand }, target);

  const drop = Number.isFinite(body.release_speed_kph) && Number.isFinite(body.speed_off_pitch_kph) && body.release_speed_kph > 0
    ? ((body.release_speed_kph - body.speed_off_pitch_kph) / body.release_speed_kph) * 100
    : null;

  return {
    session_id: session.id,
    event_id: body.event_id ?? null,
    sequence,
    over_number: body.over_number ?? null,
    ball_in_over: body.ball_in_over ?? null,
    bowler_id: body.bowler_id ?? null,
    batter_id: body.batter_id ?? null,
    batter_handedness: hand,
    release_speed_kph: body.release_speed_kph ?? null,
    speed_off_pitch_kph: body.speed_off_pitch_kph ?? null,
    speed_drop_percent: drop === null ? null : Math.round(drop * 10) / 10,
    pitch_x_cm: body.pitch_x_cm ?? null,
    pitch_y_cm: body.pitch_y_cm ?? null,
    bounce_height_cm: body.bounce_height_cm ?? null,
    length_zone: analysis.lengthZoneFor(body.pitch_y_cm ?? null),
    line_zone: analysis.lineZoneFor(body.pitch_x_cm ?? null, hand),
    stump_x_cm: body.stump_x_cm ?? null,
    stump_z_cm: body.stump_z_cm ?? null,
    hits_stumps: stump.hits,
    stump_hit: stump.stump,
    deviation_deg: body.deviation_deg ?? null,
    swing_deg: body.swing_deg ?? null,
    spin_rpm: body.spin_rpm ?? null,
    release_height_cm: body.release_height_cm ?? null,
    delivery_type: body.delivery_type ?? null,
    target_line: target?.line_zone ?? null,
    target_length: target?.length_zone ?? null,
    in_target: aim.inTarget,
    distance_from_target_cm: aim.distanceCm,
    outcome: body.outcome ?? null,
    runs: body.runs ?? null,
    wicket: body.wicket ?? 0,
    machine_delivery: body.machine_delivery ?? (session.mode === 'bowling_machine' ? 1 : 0),
    trajectory_json: body.trajectory ? JSON.stringify(body.trajectory) : null,
    source: body.source ?? session.source ?? 'manual',
    notes: body.notes ?? null,
  };
}

router.post('/tracking/sessions/:id/deliveries', requirePermission('performances.write'), asyncHandler(async (req, res) => {
  const session = db.prepare('SELECT * FROM tracking_sessions WHERE id = ?').get(req.params.id);
  if (!session) throw new ApiError(404, 'That tracking session does not exist.');

  // One delivery or a whole spell in a single call.
  const payloads = Array.isArray(req.body.deliveries)
    ? req.body.deliveries.map((d) => deliverySchema.parse(d))
    : [deliverySchema.parse(req.body)];

  let next = (db.prepare('SELECT MAX(sequence) AS m FROM deliveries WHERE session_id = ?').get(session.id).m || 0) + 1;
  const cols = Object.keys(buildDelivery(session, payloads[0], next));
  const stmt = db.prepare(`INSERT INTO deliveries (${cols.join(',')}) VALUES (${cols.map((c) => `@${c}`).join(',')})`);

  const created = [];
  tx(() => {
    for (const payload of payloads) {
      const row = buildDelivery(session, payload, next);
      const info = stmt.run(row);
      created.push(info.lastInsertRowid);
      next += 1;
    }
  });

  audit(req, {
    action: 'create', entity: 'deliveries', entityId: session.id,
    summary: `${created.length} deliver${created.length === 1 ? 'y' : 'ies'} tracked in "${session.title}"`,
  });

  const rows = loadDeliveries(`d.id IN (${created.map(() => '?').join(',')})`, created);
  res.status(201).json({ deliveries: rows, count: created.length });
}));

router.delete('/tracking/deliveries/:id', requirePermission('performances.write'), asyncHandler(async (req, res) => {
  const row = db.prepare('SELECT * FROM deliveries WHERE id = ?').get(req.params.id);
  if (!row) throw new ApiError(404, 'That delivery does not exist.');
  db.prepare('DELETE FROM deliveries WHERE id = ?').run(row.id);
  audit(req, { action: 'delete', entity: 'deliveries', entityId: row.id, summary: 'Tracked delivery removed' });
  res.json({ ok: true });
}));

/* ================================================================== */
/* Consistency targets                                                */
/* ================================================================== */

router.get('/tracking/targets', requireAuth, (req, res) => {
  const where = ['1 = 1'];
  const params = [];
  if (req.query.player) { where.push('t.player_id = ?'); params.push(Number(req.query.player)); }
  if (req.query.session) { where.push('t.session_id = ?'); params.push(Number(req.query.session)); }
  const targets = db
    .prepare(`SELECT t.*, p.first_name, p.last_name FROM consistency_targets t
              LEFT JOIN players p ON p.id = t.player_id WHERE ${where.join(' AND ')} ORDER BY t.created_at DESC`)
    .all(...params);
  res.json({ targets });
});

router.post('/tracking/targets', requirePermission('performances.write'), asyncHandler(async (req, res) => {
  const schema = z.object({
    player_id: z.coerce.number().int(),
    sport_id: z.coerce.number().int(),
    session_id: z.coerce.number().int().optional().nullable(),
    name: z.string().min(2),
    line_zone: z.string().min(2),
    length_zone: z.string().min(2),
    x_min_cm: z.coerce.number().optional().nullable(),
    x_max_cm: z.coerce.number().optional().nullable(),
    y_min_cm: z.coerce.number().optional().nullable(),
    y_max_cm: z.coerce.number().optional().nullable(),
    tolerance_cm: z.coerce.number().min(5).max(150).default(30),
  });
  const body = schema.parse(req.body);
  const cols = Object.keys(body);
  const info = db
    .prepare(`INSERT INTO consistency_targets (${cols.join(',')}, created_by) VALUES (${cols.map(() => '?').join(',')}, ?)`)
    .run(...cols.map((c) => body[c] ?? null), req.user.id);
  audit(req, { action: 'create', entity: 'consistency_targets', entityId: info.lastInsertRowid, summary: `Target set: ${body.name}` });
  res.status(201).json({ target: db.prepare('SELECT * FROM consistency_targets WHERE id = ?').get(info.lastInsertRowid) });
}));

/* ================================================================== */
/* Per-athlete tracking report                                        */
/* ================================================================== */

router.get('/players/:id/tracking', requireAuth, (req, res) => {
  const playerId = Number(req.params.id);
  if (!canAccessPlayer(req.user, playerId)) {
    throw new ApiError(403, 'That athlete is outside the teams and sports assigned to you.');
  }

  const bowled = loadDeliveries('d.bowler_id = ?', [playerId]);
  const faced = loadDeliveries('d.batter_id = ?', [playerId]);

  const sessionIds = [...new Set(bowled.map((d) => d.session_id))];
  const sessions = sessionIds.map((id) => {
    const s = db.prepare('SELECT * FROM tracking_sessions WHERE id = ?').get(id);
    return { ...s, deliveries: bowled.filter((d) => d.session_id === id) };
  });

  res.json({
    playerId,
    bowling: bowled.length ? analysis.bowlerReport(bowled, sessions) : null,
    batting: faced.length ? analysis.batterReport(faced) : null,
    sessions: sessions.length,
    calibratedSessions: sessions.filter((s) => s.calibrated).length,
  });
});

/* ================================================================== */
/* Fitness                                                            */
/* ================================================================== */

router.get('/players/:id/fitness', requireAuth, (req, res) => {
  const playerId = Number(req.params.id);
  if (!canAccessPlayer(req.user, playerId)) {
    throw new ApiError(403, 'That athlete is outside the teams and sports assigned to you.');
  }

  const records = db
    .prepare(`SELECT f.*, c.full_name AS coach_name FROM fitness_records f
              LEFT JOIN coaches c ON c.id = f.coach_id
              WHERE f.player_id = ? ORDER BY f.record_date DESC, f.id DESC`)
    .all(playerId);

  // One series per metric, oldest first, so a trend line can be drawn.
  const metrics = {};
  for (const r of records) {
    if (r.kind === 'workout') continue;
    if (!metrics[r.metric]) {
      metrics[r.metric] = { metric: r.metric, label: r.label, unit: r.unit, category: r.category, higherIsBetter: !!r.higher_is_better, points: [] };
    }
    metrics[r.metric].points.push({ date: r.record_date, value: r.value });
  }

  const series = Object.values(metrics).map((m) => {
    const points = m.points.slice().sort((a, b) => String(a.date).localeCompare(String(b.date)));
    const first = points[0]?.value;
    const last = points.at(-1)?.value;
    const change = first !== undefined && last !== undefined ? last - first : null;
    return {
      ...m,
      points,
      latest: last ?? null,
      best: points.length ? (m.higherIsBetter ? Math.max(...points.map((p) => p.value)) : Math.min(...points.map((p) => p.value))) : null,
      change: change === null ? null : Math.round(change * 100) / 100,
      // "Improved" depends on the metric: a faster sprint is a smaller number.
      improved: change === null ? null : (m.higherIsBetter ? change > 0 : change < 0),
    };
  });

  const workouts = records.filter((r) => r.kind === 'workout');

  res.json({
    records,
    series,
    workouts,
    summary: {
      tests: records.filter((r) => r.kind === 'test').length,
      workouts: workouts.length,
      metricsTracked: series.length,
      improving: series.filter((s) => s.improved === true).length,
      lastRecorded: records[0]?.record_date ?? null,
      averageRpe: workouts.length
        ? Math.round((workouts.reduce((a, w) => a + (w.rpe || 0), 0) / workouts.filter((w) => w.rpe).length) * 10) / 10
        : null,
    },
  });
});

const fitnessSchema = z.object({
  player_id: z.coerce.number().int(),
  record_date: z.string().min(8),
  kind: z.enum(['test', 'workout', 'measurement']).default('test'),
  category: z.enum(['speed', 'strength', 'endurance', 'power', 'mobility', 'conditioning', 'body']).default('conditioning'),
  metric: z.string().min(2),
  label: z.string().min(2),
  value: z.coerce.number(),
  unit: z.string().optional().nullable(),
  higher_is_better: z.coerce.number().int().min(0).max(1).default(1),
  exercise: z.string().optional().nullable(),
  sets: z.coerce.number().int().min(1).max(30).optional().nullable(),
  reps: z.coerce.number().int().min(1).max(200).optional().nullable(),
  load_kg: z.coerce.number().min(0).max(500).optional().nullable(),
  duration_minutes: z.coerce.number().int().min(1).max(600).optional().nullable(),
  rpe: z.coerce.number().min(1).max(10).optional().nullable(),
  coach_id: z.coerce.number().int().optional().nullable(),
  notes: z.string().optional().nullable(),
});

router.post('/fitness', requirePermission('training.write'), asyncHandler(async (req, res) => {
  const body = fitnessSchema.parse(req.body);
  if (!canAccessPlayer(req.user, body.player_id)) {
    throw new ApiError(403, 'That athlete is outside the teams and sports assigned to you.');
  }
  const cols = Object.keys(body);
  const info = db
    .prepare(`INSERT INTO fitness_records (${cols.join(',')}, created_by) VALUES (${cols.map(() => '?').join(',')}, ?)`)
    .run(...cols.map((c) => body[c] ?? null), req.user.id);
  audit(req, { action: 'create', entity: 'fitness_records', entityId: info.lastInsertRowid, summary: `Fitness recorded: ${body.label}` });
  res.status(201).json({ record: db.prepare('SELECT * FROM fitness_records WHERE id = ?').get(info.lastInsertRowid) });
}));

/* ================================================================== */
/* Assessment templates                                               */
/* ================================================================== */

router.get('/assessment-templates', requireAuth, (req, res) => {
  const templates = db
    .prepare(`SELECT t.*, s.name AS sport_name FROM assessment_templates t
              LEFT JOIN sports s ON s.id = t.sport_id
              WHERE t.is_active = 1 ${req.query.sport ? 'AND (t.sport_id = ? OR t.sport_id IS NULL)' : ''}
              ORDER BY t.purpose, t.name`)
    .all(...(req.query.sport ? [Number(req.query.sport)] : []));

  res.json({
    templates: templates.map((t) => ({
      ...t,
      criteria: db
        .prepare(`SELECT tc.*, c.key, c.name, c.category, c.scale_min, c.scale_max, c.description
                  FROM assessment_template_criteria tc JOIN assessment_criteria c ON c.id = tc.criteria_id
                  WHERE tc.template_id = ? ORDER BY tc.sort_order`)
        .all(t.id),
    })),
  });
});

router.post('/assessment-templates', requirePermission('assessments.write'), asyncHandler(async (req, res) => {
  const schema = z.object({
    name: z.string().min(2),
    sport_id: z.coerce.number().int().optional().nullable(),
    age_group: z.string().optional().nullable(),
    purpose: z.enum(['trial', 'review', 'selection', 'induction', 'return_from_injury']).default('review'),
    description: z.string().optional().nullable(),
    criteria: z.array(z.object({
      criteria_id: z.coerce.number().int(),
      weight: z.coerce.number().min(0.1).max(5).default(1),
    })).min(1, 'Choose at least one criterion'),
  });
  const body = schema.parse(req.body);

  let id;
  tx(() => {
    const info = db
      .prepare('INSERT INTO assessment_templates (name, sport_id, age_group, purpose, description, created_by) VALUES (?,?,?,?,?,?)')
      .run(body.name, body.sport_id ?? null, body.age_group ?? null, body.purpose, body.description ?? null, req.user.id);
    id = info.lastInsertRowid;
    const stmt = db.prepare('INSERT INTO assessment_template_criteria (template_id, criteria_id, sort_order, weight) VALUES (?,?,?,?)');
    body.criteria.forEach((c, i) => stmt.run(id, c.criteria_id, i, c.weight));
  });

  audit(req, { action: 'create', entity: 'assessment_templates', entityId: id, summary: `Assessment template created: ${body.name}` });
  res.status(201).json({ template: db.prepare('SELECT * FROM assessment_templates WHERE id = ?').get(id) });
}));

/* ================================================================== */
/* Evidence-led selection                                             */
/* ================================================================== */

/**
 * Compare a shortlist side by side.
 *
 * The point is to make a selection argument checkable: every column is a
 * figure already in the record, so a disagreement is about weighting rather
 * than about whose memory of the season is right.
 */
router.get('/selection/compare', requireAuth, asyncHandler(async (req, res) => {
  const ids = String(req.query.players || '').split(',').map(Number).filter(Boolean);
  if (ids.length < 2) throw new ApiError(422, 'Choose at least two athletes to compare.');
  if (ids.length > 8) throw new ApiError(422, 'Compare up to eight athletes at a time.');

  const sportId = Number(req.query.sport);
  if (!sportId) throw new ApiError(422, 'Choose the sport to compare them in.');
  const sport = getSport(String(sportId));
  if (!sport) throw new ApiError(404, 'That sport does not exist.');

  const allowed = allowedPlayerIds(req.user);
  const rows = [];

  for (const id of ids) {
    if (allowed !== null && !allowed.includes(id)) continue;
    const player = db
      .prepare('SELECT id, athlete_id, first_name, last_name, display_name, photo_url, dob, status FROM players WHERE id = ?')
      .get(id);
    if (!player) continue;

    const career = playerCareer(id, sport, {});
    const team = db
      .prepare(`SELECT t.name, t.age_group FROM team_memberships tm JOIN teams t ON t.id = tm.team_id
                WHERE tm.player_id = ? AND tm.end_date IS NULL AND t.sport_id = ? LIMIT 1`)
      .get(id, sportId);

    const latest = db
      .prepare('SELECT overall_score, assessment_date FROM assessments WHERE player_id = ? AND sport_id = ? ORDER BY assessment_date DESC LIMIT 1')
      .get(id, sportId);

    const attendance = db
      .prepare(`SELECT COUNT(*) AS total, SUM(CASE WHEN ta.status IN ('present','late') THEN 1 ELSE 0 END) AS attended
                FROM training_attendance ta JOIN training_sessions ts ON ts.id = ta.session_id
                WHERE ta.player_id = ? AND ts.sport_id = ?`)
      .get(id, sportId);

    const tracked = db
      .prepare(`SELECT COUNT(*) AS balls, AVG(release_speed_kph) AS avg_speed,
                       AVG(CASE WHEN in_target = 1 THEN 100.0 ELSE 0 END) AS in_zone
                FROM deliveries WHERE bowler_id = ?`)
      .get(id);

    const fitness = db
      .prepare(`SELECT metric, label, value, unit FROM fitness_records
                WHERE player_id = ? AND kind = 'test' ORDER BY record_date DESC LIMIT 4`)
      .all(id);

    rows.push({
      player,
      team: team?.name ?? null,
      ageGroup: team?.age_group ?? null,
      matches: career.matchesPlayed,
      headline: career.headline,
      rating: career.rating?.overall ?? null,
      assessment: latest ? { score: latest.overall_score, date: latest.assessment_date } : null,
      attendance: attendance.total
        ? Math.round((attendance.attended / attendance.total) * 100)
        : null,
      tracking: tracked.balls
        ? {
          balls: tracked.balls,
          averageSpeed: tracked.avg_speed ? Math.round(tracked.avg_speed * 10) / 10 : null,
          inZonePercent: tracked.in_zone !== null ? Math.round(tracked.in_zone * 10) / 10 : null,
        }
        : null,
      fitness,
      achievements: db.prepare('SELECT COUNT(*) AS c FROM achievements WHERE player_id = ?').get(id).c,
    });
  }

  if (rows.length < 2) throw new ApiError(403, 'Fewer than two of those athletes are within the teams assigned to you.');

  // Which headline figures every athlete has, so the table has no empty columns.
  const common = (rows[0].headline || [])
    .filter((h) => rows.every((r) => (r.headline || []).some((x) => x.key === h.key)))
    .map((h) => ({ key: h.key, label: h.label }));

  res.json({
    sport: { id: sport.id, code: sport.code, name: sport.name },
    columns: common,
    rows,
    note: 'Every figure here is taken from the athlete\'s own record. Nothing is weighted or ranked — that judgement stays with the selectors.',
  });
}));

module.exports = router;
