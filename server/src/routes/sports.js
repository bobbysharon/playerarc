'use strict';
const express = require('express');
const { z } = require('zod');
const { db, parseJson } = require('../db');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { audit } = require('../middleware/audit');
const { asyncHandler, ApiError } = require('../middleware/error');
const { listSports, getSport } = require('../lib/repo');
const { validate: validateFormula } = require('../lib/formula');

const router = express.Router();

router.get('/', requireAuth, (req, res) => {
  const sports = listSports({ activeOnly: req.query.active === 'true' }).map((s) => {
    const players = db.prepare('SELECT COUNT(*) AS c FROM player_sports WHERE sport_id = ?').get(s.id).c;
    const teams = db.prepare('SELECT COUNT(*) AS c FROM teams WHERE sport_id = ?').get(s.id).c;
    const matches = db.prepare('SELECT COUNT(*) AS c FROM matches WHERE sport_id = ?').get(s.id).c;
    return { ...s, config_json: undefined, counts: { players, teams, matches } };
  });
  res.json({ sports });
});

router.get('/:idOrCode', requireAuth, (req, res) => {
  const sport = getSport(req.params.idOrCode);
  if (!sport) throw new ApiError(404, 'That sport does not exist.');
  res.json({ sport: { ...sport, config_json: undefined } });
});

const sportSchema = z.object({
  code: z.string().min(2).regex(/^[a-z0-9_]+$/, 'Use lowercase letters, numbers and underscores'),
  name: z.string().min(2),
  category: z.enum(['team', 'individual', 'racket', 'indoor']).default('team'),
  description: z.string().optional().nullable(),
  color: z.string().optional().nullable(),
  icon: z.string().optional().nullable(),
  is_active: z.coerce.number().int().min(0).max(1).default(1),
  sort_order: z.coerce.number().int().default(100),
  config: z.any().optional(),
});

router.post('/', requirePermission('sports.write'), asyncHandler(async (req, res) => {
  const body = sportSchema.parse(req.body);
  const config = body.config || { statGroups: [], matchStats: [], career: [], positions: [] };
  checkFormulas(config);
  const info = db
    .prepare(`INSERT INTO sports (code, name, category, description, color, icon, config_json, is_active, sort_order)
              VALUES (?,?,?,?,?,?,?,?,?)`)
    .run(body.code, body.name, body.category, body.description ?? null, body.color ?? null, body.icon ?? null,
         JSON.stringify(config), body.is_active, body.sort_order);
  audit(req, { action: 'create', entity: 'sports', entityId: info.lastInsertRowid, summary: `Sport added: ${body.name}` });
  res.status(201).json({ sport: getSport(String(info.lastInsertRowid)) });
}));

router.put('/:id', requirePermission('sports.write'), asyncHandler(async (req, res) => {
  const before = getSport(req.params.id);
  if (!before) throw new ApiError(404, 'That sport does not exist.');
  const body = sportSchema.partial().parse(req.body);
  const config = body.config !== undefined ? body.config : before.config;
  checkFormulas(config);
  db.prepare(`UPDATE sports SET name = ?, category = ?, description = ?, color = ?, icon = ?, config_json = ?,
              is_active = ?, sort_order = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(body.name ?? before.name, body.category ?? before.category, body.description ?? before.description,
         body.color ?? before.color, body.icon ?? before.icon, JSON.stringify(config),
         body.is_active ?? before.is_active, body.sort_order ?? before.sort_order, before.id);
  audit(req, { action: 'update', entity: 'sports', entityId: before.id, summary: `Sport updated: ${before.name}` });
  res.json({ sport: getSport(String(before.id)) });
}));

/** Reject a configuration whose formulas would silently evaluate to zero. */
function checkFormulas(config) {
  const problems = [];
  const check = (formula, where) => {
    if (!formula) return;
    const result = validateFormula(formula);
    if (!result.valid) problems.push(`${where}: ${result.error}`);
  };
  (config.matchDerived || []).forEach((d) => check(d.formula, `Match stat "${d.key}"`));
  (config.career || []).forEach((d) => {
    check(d.formula, `Career stat "${d.key}"`);
    check(d.whenFormula, `Career condition "${d.key}"`);
  });
  ((config.ratingModel || {}).components || []).forEach((c) => check(c.formula, `Rating component "${c.key}"`));
  if (problems.length) throw new ApiError(422, 'The sport configuration has invalid formulas.', problems);
}

/* ---- Seasons ------------------------------------------------------- */
router.get('/meta/seasons', requireAuth, (req, res) => {
  const rows = db
    .prepare(`SELECT s.*, sp.name AS sport_name FROM seasons s LEFT JOIN sports sp ON sp.id = s.sport_id ORDER BY s.start_date DESC`)
    .all();
  res.json({ seasons: rows });
});

router.post('/meta/seasons', requirePermission('seasons.write'), asyncHandler(async (req, res) => {
  const schema = z.object({
    name: z.string().min(2),
    sport_id: z.coerce.number().int().nullable().optional(),
    start_date: z.string().min(4),
    end_date: z.string().min(4),
    is_current: z.coerce.number().int().min(0).max(1).default(0),
  });
  const body = schema.parse(req.body);
  if (body.end_date < body.start_date) throw new ApiError(422, 'The season cannot end before it starts.');
  const info = db
    .prepare('INSERT INTO seasons (name, sport_id, start_date, end_date, is_current) VALUES (?,?,?,?,?)')
    .run(body.name, body.sport_id ?? null, body.start_date, body.end_date, body.is_current);
  audit(req, { action: 'create', entity: 'seasons', entityId: info.lastInsertRowid, summary: `Season added: ${body.name}` });
  res.status(201).json({ season: db.prepare('SELECT * FROM seasons WHERE id = ?').get(info.lastInsertRowid) });
}));

module.exports = router;
