/* AUTO-GENERATED — do not edit.
 * Converted from server/src/lib/stats-engine.js by scripts/build-demo-engine.mjs.
 * Edit the server module and re-run: npm run demo:data
 */
/**
 * The statistics engine.
 *
 * Career records are never stored as running totals that a user maintains by
 * hand — they are computed from the underlying match performances every time
 * they are asked for, using the aggregation rules in the sport's config. That
 * is what keeps a player's career page correct after a scorer fixes a typo in
 * a match from three seasons ago.
 */
import { run } from './formula.js';

/** Coerce a stored stat value to a number. Booleans become 1/0. */
function num(v) {
  if (v === true) return 1;
  if (v === false || v === null || v === undefined || v === '') return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** Build the variable scope for one performance: raw stats + match derived. */
function performanceScope(stats, config) {
  const scope = {};
  for (const f of config.matchStats || []) scope[f.key] = num(stats[f.key]);
  for (const d of config.matchDerived || []) scope[d.key] = run(d.formula, scope);
  return scope;
}

/** Best bowling figures, cricket-style: most wickets, then fewest runs. */
function bestBowling(performances) {
  let best = null;
  for (const p of performances) {
    const w = num(p.wickets);
    const r = num(p.runs_conceded);
    if (w === 0 && !best) continue;
    if (!best || w > best.w || (w === best.w && r < best.r)) best = { w, r };
  }
  return best ? `${best.w}/${best.r}` : '—';
}

/**
 * Aggregate a list of raw stats objects into a career record for one sport.
 * @param {object} config  sports.config_json
 * @param {object[]} rawStatsList  one entry per match performance
 * @returns {{values: object, entries: object[], groups: object[]}}
 */
function aggregateCareer(config, rawStatsList) {
  const scopes = rawStatsList.map((s) => performanceScope(s, config));
  const values = {};

  for (const def of config.career || []) {
    if (def.formula) {
      values[def.key] = run(def.formula, values);
      continue;
    }
    switch (def.agg) {
      case 'count':
        values[def.key] = scopes.length;
        break;
      case 'count_if':
        values[def.key] = scopes.reduce((acc, s) => acc + (run(def.whenFormula, s) ? 1 : 0), 0);
        break;
      case 'sum':
        values[def.key] = scopes.reduce((acc, s) => acc + num(s[def.field]), 0);
        break;
      case 'max':
        values[def.key] = scopes.reduce((acc, s) => Math.max(acc, num(s[def.field])), 0);
        break;
      case 'min':
        values[def.key] = scopes.length ? scopes.reduce((acc, s) => Math.min(acc, num(s[def.field])), Infinity) : 0;
        break;
      case 'avg': {
        const used = scopes.filter((s) => num(s[def.field]) > 0);
        values[def.key] = used.length ? used.reduce((a, s) => a + num(s[def.field]), 0) / used.length : 0;
        break;
      }
      case 'best_bowling':
        values[def.key] = bestBowling(scopes);
        break;
      default:
        values[def.key] = 0;
    }
  }

  const entries = (config.career || [])
    .filter((d) => !d.hidden)
    .map((d) => ({
      key: d.key,
      label: d.label,
      group: d.group || 'general',
      format: d.format || 'int',
      value: values[d.key],
      display: formatStat(values[d.key], d.format),
    }));

  const groups = (config.statGroups || []).map((g) => ({
    ...g,
    stats: entries.filter((e) => e.group === g.key),
  }));

  return { values, entries, groups };
}

/** Format a value for display according to its declared format. */
function formatStat(value, format) {
  if (value === null || value === undefined) return '—';
  if (format === 'text') return String(value);
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  switch (format) {
    case 'overs': {
      const overs = Math.floor(n / 6);
      const balls = Math.round(n % 6);
      return `${overs}.${balls}`;
    }
    case 'pct':
      return `${n.toFixed(1)}%`;
    case '1dp':
      return n.toFixed(1);
    case '2dp':
      return n.toFixed(2);
    case 'int':
    default:
      return String(Math.round(n));
  }
}

/**
 * Compute the configurable performance rating for one sport.
 * Never a single universal formula — each sport declares its own components.
 */
function computeRating(config, careerValues) {
  const model = config.ratingModel;
  if (!model || !Array.isArray(model.components)) return null;
  const components = model.components.map((c) => {
    const score = Math.max(0, Math.min(100, run(c.formula, careerValues)));
    return { key: c.key, label: c.label, weight: c.weight, score: Math.round(score * 10) / 10 };
  });
  const totalWeight = components.reduce((a, c) => a + (c.weight || 0), 0) || 1;
  const overall = components.reduce((a, c) => a + c.score * (c.weight || 0), 0) / totalWeight;
  return { overall: Math.round(overall * 10) / 10, components, scale: model.scale || 100 };
}

/** Rating for a single match performance, using the same component model. */
function computeMatchRating(config, rawStats) {
  const scope = performanceScope(rawStats, config);
  const model = config.ratingModel;
  if (!model) return null;
  // Match-level ratings reuse the model but read per-match values.
  const components = model.components.map((c) => ({
    key: c.key,
    score: Math.max(0, Math.min(100, run(c.formula, scope))),
    weight: c.weight,
  }));
  const totalWeight = components.reduce((a, c) => a + (c.weight || 0), 0) || 1;
  const overall = components.reduce((a, c) => a + c.score * (c.weight || 0), 0) / totalWeight;
  return Math.round(overall * 10) / 10;
}

/**
 * Validate an incoming stats payload against the sport definition.
 * Returns { ok, errors, clean } — unknown keys are dropped, bounds enforced,
 * and calculated fields are never accepted from the client.
 */
function validateStats(config, payload = {}) {
  const errors = [];
  const clean = {};
  const fields = config.matchStats || [];
  for (const f of fields) {
    if (!(f.key in payload)) continue;
    const raw = payload[f.key];
    if (raw === null || raw === '' || raw === undefined) continue;
    if (f.type === 'bool') {
      clean[f.key] = raw === true || raw === 1 || raw === '1' || raw === 'true' ? 1 : 0;
      continue;
    }
    if (f.type === 'select' || f.type === 'text') {
      if (f.options && !f.options.includes(String(raw))) {
        errors.push(`${f.label}: "${raw}" is not an accepted value`);
        continue;
      }
      clean[f.key] = String(raw);
      continue;
    }
    const n = Number(raw);
    if (!Number.isFinite(n)) {
      errors.push(`${f.label} must be a number`);
      continue;
    }
    if (f.type === 'int' && !Number.isInteger(n)) {
      errors.push(`${f.label} must be a whole number`);
      continue;
    }
    if (f.min !== undefined && n < f.min) errors.push(`${f.label} cannot be below ${f.min}`);
    if (f.max !== undefined && n > f.max) errors.push(`${f.label} cannot be above ${f.max}`);
    clean[f.key] = n;
  }

  // Cross-field integrity rules that no bounds check can catch.
  const pairs = [
    ['shots_on_target', 'shots', 'Shots on target cannot exceed shots'],
    ['passes_completed', 'passes', 'Completed passes cannot exceed passes attempted'],
    ['tpm', 'fgm', '3-pointers made cannot exceed field goals made'],
    ['tpa', 'fga', '3-point attempts cannot exceed field goal attempts'],
    ['fgm', 'fga', 'Field goals made cannot exceed attempts'],
    ['ftm', 'fta', 'Free throws made cannot exceed attempts'],
    ['kills', 'attack_attempts', 'Kills cannot exceed attack attempts'],
  ];
  for (const [a, b, message] of pairs) {
    if (clean[a] !== undefined && clean[b] !== undefined && clean[a] > clean[b]) errors.push(message);
  }
  if (clean.balls_faced !== undefined && clean.runs !== undefined && clean.runs > clean.balls_faced * 6) {
    errors.push('Runs cannot exceed six per ball faced');
  }
  if (clean.wickets !== undefined && clean.balls_bowled !== undefined && clean.wickets > clean.balls_bowled) {
    errors.push('Wickets cannot exceed balls bowled');
  }
  if (clean.not_out === 1 && clean.dismissal && clean.dismissal !== 'not out' && clean.dismissal !== 'retired') {
    errors.push('A not-out innings cannot also record a dismissal');
  }

  return { ok: errors.length === 0, errors, clean };
}

/** Series of per-match values for a stat, oldest first — used by charts. */
function statSeries(config, performances, statKey) {
  return performances.map((p) => {
    const scope = performanceScope(p.stats, config);
    return { date: p.date, label: p.label, value: scope[statKey] ?? 0 };
  });
}

export {
  aggregateCareer,
  computeRating,
  computeMatchRating,
  validateStats,
  performanceScope,
  formatStat,
  statSeries,
  num,
};