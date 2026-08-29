'use strict';
const express = require('express');
const { z } = require('zod');
const { db, tx } = require('../db');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { audit } = require('../middleware/audit');
const { asyncHandler, ApiError } = require('../middleware/error');
const { canAccessPlayer } = require('../middleware/scope');
const timeline = require('../lib/timeline');

const router = express.Router();

/* ---- Criteria (configurable by sport and age group) ----------------- */
router.get('/criteria', requireAuth, (req, res) => {
  const where = ['c.is_active = 1'];
  const params = [];
  if (req.query.sport) { where.push('(c.sport_id = ? OR c.sport_id IS NULL)'); params.push(Number(req.query.sport)); }
  if (req.query.ageGroup) { where.push('(c.age_group = ? OR c.age_group IS NULL)'); params.push(req.query.ageGroup); }
  const criteria = db
    .prepare(`SELECT c.*, s.name AS sport_name FROM assessment_criteria c LEFT JOIN sports s ON s.id = c.sport_id
              WHERE ${where.join(' AND ')} ORDER BY c.category, c.sort_order, c.name`)
    .all(...params);
  res.json({ criteria });
});

const criteriaSchema = z.object({
  key: z.string().min(2).regex(/^[a-z0-9_]+$/, 'Use lowercase letters, numbers and underscores'),
  name: z.string().min(2),
  category: z.enum(['physical', 'technical', 'tactical', 'behavioural']),
  sport_id: z.coerce.number().int().optional().nullable(),
  age_group: z.string().optional().nullable(),
  scale_min: z.coerce.number().default(0),
  scale_max: z.coerce.number().default(10),
  unit: z.string().optional().nullable(),
  weight: z.coerce.number().min(0).max(10).default(1),
  higher_is_better: z.coerce.number().int().min(0).max(1).default(1),
  description: z.string().optional().nullable(),
  sort_order: z.coerce.number().int().default(100),
});

router.post('/criteria', requirePermission('assessments.write'), asyncHandler(async (req, res) => {
  const body = criteriaSchema.parse(req.body);
  if (body.scale_max <= body.scale_min) throw new ApiError(422, 'The top of the scale must be above the bottom.');
  const cols = Object.keys(body);
  const info = db.prepare(`INSERT INTO assessment_criteria (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`)
    .run(...cols.map((c) => body[c] ?? null));
  audit(req, { action: 'create', entity: 'assessment_criteria', entityId: info.lastInsertRowid, summary: `Assessment criterion added: ${body.name}` });
  res.status(201).json({ criteria: db.prepare('SELECT * FROM assessment_criteria WHERE id = ?').get(info.lastInsertRowid) });
}));

router.put('/criteria/:id', requirePermission('assessments.write'), asyncHandler(async (req, res) => {
  const before = db.prepare('SELECT * FROM assessment_criteria WHERE id = ?').get(req.params.id);
  if (!before) throw new ApiError(404, 'That criterion does not exist.');
  const body = criteriaSchema.partial().extend({ is_active: z.coerce.number().int().min(0).max(1).optional() }).parse(req.body);
  const sets = Object.keys(body).map((k) => `${k} = ?`);
  if (sets.length) db.prepare(`UPDATE assessment_criteria SET ${sets.join(', ')} WHERE id = ?`).run(...Object.values(body), before.id);
  audit(req, { action: 'update', entity: 'assessment_criteria', entityId: before.id, summary: `Criterion updated: ${before.name}` });
  res.json({ ok: true });
}));

/* ---- Assessments ---------------------------------------------------- */
router.get('/', requireAuth, (req, res) => {
  const where = ['1 = 1'];
  const params = [];
  if (req.query.player) { where.push('a.player_id = ?'); params.push(Number(req.query.player)); }
  if (req.query.sport) { where.push('a.sport_id = ?'); params.push(Number(req.query.sport)); }
  if (req.query.team) { where.push('a.team_id = ?'); params.push(Number(req.query.team)); }
  if (req.query.coach) { where.push('a.assessed_by = ?'); params.push(Number(req.query.coach)); }
  const rows = db
    .prepare(`SELECT a.*, p.athlete_id, p.first_name, p.last_name, p.photo_url, s.name AS sport_name, s.color,
                     c.full_name AS coach_name, t.name AS team_name
              FROM assessments a
              JOIN players p ON p.id = a.player_id
              JOIN sports s ON s.id = a.sport_id
              LEFT JOIN coaches c ON c.id = a.assessed_by
              LEFT JOIN teams t ON t.id = a.team_id
              WHERE ${where.join(' AND ')} ORDER BY a.assessment_date DESC LIMIT ?`)
    .all(...params, Math.min(Number(req.query.limit) || 100, 500));
  res.json({ assessments: rows });
});

router.get('/:id', requireAuth, (req, res) => {
  const assessment = db
    .prepare(`SELECT a.*, p.athlete_id, p.first_name, p.last_name, s.name AS sport_name, c.full_name AS coach_name
              FROM assessments a JOIN players p ON p.id = a.player_id JOIN sports s ON s.id = a.sport_id
              LEFT JOIN coaches c ON c.id = a.assessed_by WHERE a.id = ?`)
    .get(req.params.id);
  if (!assessment) throw new ApiError(404, 'That assessment does not exist.');
  const scores = db
    .prepare(`SELECT sc.*, cr.name, cr.key, cr.category, cr.scale_min, cr.scale_max, cr.unit, cr.weight
              FROM assessment_scores sc JOIN assessment_criteria cr ON cr.id = sc.criteria_id
              WHERE sc.assessment_id = ? ORDER BY cr.category, cr.sort_order`)
    .all(assessment.id);
  res.json({ assessment, scores });
});

router.post('/', requirePermission('assessments.write'), asyncHandler(async (req, res) => {
  const schema = z.object({
    player_id: z.coerce.number().int(),
    sport_id: z.coerce.number().int(),
    team_id: z.coerce.number().int().optional().nullable(),
    assessed_by: z.coerce.number().int().optional().nullable(),
    assessment_date: z.string().min(8),
    cycle: z.string().optional().nullable(),
    age_group: z.string().optional().nullable(),
    summary: z.string().optional().nullable(),
    recommendation: z.string().optional().nullable(),
    next_review_date: z.string().optional().nullable(),
    scores: z.array(z.object({
      criteria_id: z.coerce.number().int(),
      score: z.coerce.number(),
      comment: z.string().optional().nullable(),
    })).min(1, 'Score at least one criterion'),
  });
  const body = schema.parse(req.body);

  const player = db.prepare('SELECT * FROM players WHERE id = ?').get(body.player_id);
  if (!player) throw new ApiError(404, 'That athlete does not exist.');
  if (!canAccessPlayer(req.user, player.id)) throw new ApiError(403, 'That athlete is outside your assigned teams.');
  if (new Date(body.assessment_date) > new Date()) throw new ApiError(422, 'An assessment cannot be dated in the future.');

  // Validate every score against its own configured scale.
  let weighted = 0;
  let weightTotal = 0;
  const problems = [];
  for (const s of body.scores) {
    const criterion = db.prepare('SELECT * FROM assessment_criteria WHERE id = ?').get(s.criteria_id);
    if (!criterion) { problems.push(`Criterion #${s.criteria_id} does not exist`); continue; }
    if (s.score < criterion.scale_min || s.score > criterion.scale_max) {
      problems.push(`${criterion.name} must be between ${criterion.scale_min} and ${criterion.scale_max}`);
      continue;
    }
    const normalised = ((s.score - criterion.scale_min) / (criterion.scale_max - criterion.scale_min)) * 10;
    const value = criterion.higher_is_better ? normalised : 10 - normalised;
    weighted += value * criterion.weight;
    weightTotal += criterion.weight;
  }
  if (problems.length) throw new ApiError(422, 'Some scores are outside their scale.', problems);
  const overall = weightTotal ? Math.round((weighted / weightTotal) * 10) / 10 : null;

  let assessmentId;
  tx(() => {
    const info = db
      .prepare(`INSERT INTO assessments (player_id, sport_id, team_id, assessed_by, assessment_date, cycle, age_group, overall_score, summary, recommendation, next_review_date, created_by)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(body.player_id, body.sport_id, body.team_id ?? null, body.assessed_by ?? req.user.coachId ?? null,
           body.assessment_date, body.cycle ?? null, body.age_group ?? null, overall,
           body.summary ?? null, body.recommendation ?? null, body.next_review_date ?? null, req.user.id);
    assessmentId = info.lastInsertRowid;
    const stmt = db.prepare('INSERT INTO assessment_scores (assessment_id, criteria_id, score, comment) VALUES (?,?,?,?)');
    body.scores.forEach((s) => stmt.run(assessmentId, s.criteria_id, s.score, s.comment ?? null));
  });

  timeline.addEvent({
    playerId: body.player_id, date: body.assessment_date, type: 'assessment',
    title: `${body.cycle || 'Player'} assessment${overall != null ? ` — ${overall}/10` : ''}`,
    description: body.summary || null, sportId: body.sport_id,
    refTable: 'assessments', refId: assessmentId, importance: 2, userId: req.user.id,
  });
  audit(req, { action: 'create', entity: 'assessments', entityId: assessmentId, summary: `Assessment recorded for ${player.athlete_id}` });
  res.status(201).json({ assessment: db.prepare('SELECT * FROM assessments WHERE id = ?').get(assessmentId) });
}));

/**
 * Development history for one athlete — every criterion plotted over time.
 * Past assessments are never overwritten, so this is the true progression.
 */
router.get('/player/:playerId/development', requireAuth, (req, res) => {
  const playerId = Number(req.params.playerId);
  if (!canAccessPlayer(req.user, playerId)) throw new ApiError(403, 'That athlete is outside your assigned teams.');

  const where = ['a.player_id = ?'];
  const params = [playerId];
  if (req.query.sport) { where.push('a.sport_id = ?'); params.push(Number(req.query.sport)); }

  const assessments = db
    .prepare(`SELECT a.*, s.name AS sport_name, c.full_name AS coach_name FROM assessments a
              JOIN sports s ON s.id = a.sport_id LEFT JOIN coaches c ON c.id = a.assessed_by
              WHERE ${where.join(' AND ')} ORDER BY a.assessment_date ASC`)
    .all(...params);

  const rows = assessments.length
    ? db.prepare(`SELECT sc.*, a.assessment_date, a.id AS assessment_id, cr.key, cr.name, cr.category, cr.scale_min, cr.scale_max, cr.unit
                  FROM assessment_scores sc
                  JOIN assessments a ON a.id = sc.assessment_id
                  JOIN assessment_criteria cr ON cr.id = sc.criteria_id
                  WHERE a.id IN (${assessments.map(() => '?').join(',')})
                  ORDER BY a.assessment_date`)
        .all(...assessments.map((a) => a.id))
    : [];

  const series = {};
  for (const r of rows) {
    if (!series[r.key]) {
      series[r.key] = { key: r.key, name: r.name, category: r.category, unit: r.unit, scaleMin: r.scale_min, scaleMax: r.scale_max, points: [] };
    }
    series[r.key].points.push({ date: r.assessment_date, value: r.score, comment: r.comment });
  }

  const criteria = Object.values(series).map((s) => {
    const first = s.points[0]?.value ?? null;
    const last = s.points[s.points.length - 1]?.value ?? null;
    return { ...s, first, latest: last, change: first != null && last != null ? Math.round((last - first) * 10) / 10 : null };
  });

  const byCategory = ['physical', 'technical', 'tactical', 'behavioural'].map((category) => {
    const items = criteria.filter((c) => c.category === category);
    const latest = items.filter((c) => c.latest != null);
    return {
      category,
      average: latest.length ? Math.round((latest.reduce((a, c) => a + (c.latest / c.scaleMax) * 10, 0) / latest.length) * 10) / 10 : null,
      criteria: items,
    };
  }).filter((c) => c.criteria.length);

  res.json({
    assessments,
    criteria,
    byCategory,
    overallTrend: assessments.filter((a) => a.overall_score != null).map((a) => ({ date: a.assessment_date, value: a.overall_score })),
  });
});

module.exports = router;
