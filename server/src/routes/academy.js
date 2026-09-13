'use strict';
/**
 * The academy layer: the material a coach works from.
 *
 *   Drills and session plans   reusable, so a warm-up is written once
 *   Benchmarks                 what "good" means for an age group
 *   Announcements              telling a squad something without another app
 *
 * None of it replaces what is already here — a training session still records
 * attendance and coach notes exactly as before. These give the session
 * something to be built from, and its numbers something to be read against.
 */
const express = require('express');
const { z } = require('zod');
const { db, tx } = require('../db');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { audit } = require('../middleware/audit');
const { asyncHandler, ApiError } = require('../middleware/error');
const { allowedTeamIds, allowedPlayerIds, canAccessTeam } = require('../middleware/scope');
const { getSport, playerCareer } = require('../lib/repo');

const router = express.Router();

/* ================================================================== */
/* Drill library                                                      */
/* ================================================================== */

router.get('/drills', requireAuth, (req, res) => {
  const where = ['d.is_active = 1'];
  const params = [];
  if (req.query.sport) { where.push('(d.sport_id = ? OR d.sport_id IS NULL)'); params.push(Number(req.query.sport)); }
  if (req.query.category) { where.push('d.category = ?'); params.push(req.query.category); }
  if (req.query.difficulty) { where.push('d.difficulty = ?'); params.push(req.query.difficulty); }
  if (req.query.ageGroup) { where.push("(d.age_groups IS NULL OR d.age_groups = '' OR d.age_groups LIKE ?)"); params.push(`%${req.query.ageGroup}%`); }
  if (req.query.q) {
    where.push('(d.name LIKE ? OR d.skill_focus LIKE ? OR d.description LIKE ?)');
    const like = `%${req.query.q}%`;
    params.push(like, like, like);
  }

  const drills = db
    .prepare(`SELECT d.*, s.name AS sport_name, s.color,
                     (SELECT COUNT(*) FROM training_session_drills tsd WHERE tsd.drill_id = d.id) AS times_used
              FROM drills d LEFT JOIN sports s ON s.id = d.sport_id
              WHERE ${where.join(' AND ')} ORDER BY d.category, d.name`)
    .all(...params);
  res.json({ drills });
});

router.get('/drills/:id', requireAuth, (req, res) => {
  const drill = db
    .prepare('SELECT d.*, s.name AS sport_name FROM drills d LEFT JOIN sports s ON s.id = d.sport_id WHERE d.id = ?')
    .get(req.params.id);
  if (!drill) throw new ApiError(404, 'That drill does not exist.');

  const sessions = db
    .prepare(`SELECT ts.id, ts.session_date, ts.training_type, t.name AS team_name, tsd.notes
              FROM training_session_drills tsd
              JOIN training_sessions ts ON ts.id = tsd.session_id
              LEFT JOIN teams t ON t.id = ts.team_id
              WHERE tsd.drill_id = ? ORDER BY ts.session_date DESC LIMIT 20`)
    .all(drill.id);

  res.json({ drill, sessions });
});

const drillSchema = z.object({
  name: z.string().min(2),
  sport_id: z.coerce.number().int().optional().nullable(),
  category: z.enum(['warm_up', 'technical', 'tactical', 'fitness', 'strength', 'skills', 'match_practice', 'recovery', 'fielding', 'goalkeeping']).default('technical'),
  skill_focus: z.string().optional().nullable(),
  age_groups: z.string().optional().nullable(),
  difficulty: z.enum(['beginner', 'intermediate', 'advanced', 'all']).default('all'),
  duration_minutes: z.coerce.number().int().min(1).max(240).optional().nullable(),
  players_min: z.coerce.number().int().min(1).max(60).optional().nullable(),
  players_max: z.coerce.number().int().min(1).max(60).optional().nullable(),
  equipment: z.string().optional().nullable(),
  description: z.string().optional().nullable(),
  coaching_points: z.string().optional().nullable(),
  progressions: z.string().optional().nullable(),
  video_url: z.string().optional().nullable(),
  is_active: z.coerce.number().int().min(0).max(1).default(1),
});

router.post('/drills', requirePermission('training.write'), asyncHandler(async (req, res) => {
  const body = drillSchema.parse(req.body);
  if (body.players_min && body.players_max && body.players_min > body.players_max) {
    throw new ApiError(422, 'The minimum number of players cannot exceed the maximum.');
  }
  const cols = Object.keys(body);
  const info = db
    .prepare(`INSERT INTO drills (${cols.join(',')}, created_by) VALUES (${cols.map(() => '?').join(',')}, ?)`)
    .run(...cols.map((c) => body[c] ?? null), req.user.id);
  audit(req, { action: 'create', entity: 'drills', entityId: info.lastInsertRowid, summary: `Drill added: ${body.name}` });
  res.status(201).json({ drill: db.prepare('SELECT * FROM drills WHERE id = ?').get(info.lastInsertRowid) });
}));

router.put('/drills/:id', requirePermission('training.write'), asyncHandler(async (req, res) => {
  const before = db.prepare('SELECT * FROM drills WHERE id = ?').get(req.params.id);
  if (!before) throw new ApiError(404, 'That drill does not exist.');
  const body = drillSchema.partial().parse(req.body);
  const sets = Object.keys(body).map((k) => `${k} = ?`);
  if (sets.length) {
    db.prepare(`UPDATE drills SET ${sets.join(', ')}, updated_at = datetime('now') WHERE id = ?`)
      .run(...Object.values(body).map((v) => (v === '' ? null : v)), before.id);
  }
  audit(req, { action: 'update', entity: 'drills', entityId: before.id, summary: `Drill updated: ${before.name}` });
  res.json({ drill: db.prepare('SELECT * FROM drills WHERE id = ?').get(before.id) });
}));

/* ================================================================== */
/* Session plans                                                      */
/* ================================================================== */

router.get('/session-templates', requireAuth, (req, res) => {
  const where = ['1 = 1'];
  const params = [];
  if (req.query.sport) { where.push('(t.sport_id = ? OR t.sport_id IS NULL)'); params.push(Number(req.query.sport)); }
  const templates = db
    .prepare(`SELECT t.*, s.name AS sport_name,
                     (SELECT COUNT(*) FROM session_template_drills d WHERE d.template_id = t.id) AS drill_count
              FROM session_templates t LEFT JOIN sports s ON s.id = t.sport_id
              WHERE ${where.join(' AND ')} ORDER BY t.name`)
    .all(...params);
  res.json({
    templates: templates.map((t) => ({
      ...t,
      drills: db
        .prepare(`SELECT td.*, d.name, d.category, d.skill_focus, d.equipment, d.coaching_points
                  FROM session_template_drills td JOIN drills d ON d.id = td.drill_id
                  WHERE td.template_id = ? ORDER BY td.sort_order`)
        .all(t.id),
    })),
  });
});

router.post('/session-templates', requirePermission('training.write'), asyncHandler(async (req, res) => {
  const schema = z.object({
    name: z.string().min(2),
    sport_id: z.coerce.number().int().optional().nullable(),
    training_type: z.string().default('technical'),
    age_group: z.string().optional().nullable(),
    duration_minutes: z.coerce.number().int().optional().nullable(),
    objectives: z.string().optional().nullable(),
    notes: z.string().optional().nullable(),
    drills: z.array(z.object({
      drill_id: z.coerce.number().int(),
      duration_minutes: z.coerce.number().int().optional().nullable(),
      notes: z.string().optional().nullable(),
    })).default([]),
  });
  const body = schema.parse(req.body);

  let templateId;
  tx(() => {
    const info = db
      .prepare(`INSERT INTO session_templates (name, sport_id, training_type, age_group, duration_minutes, objectives, notes, created_by)
                VALUES (?,?,?,?,?,?,?,?)`)
      .run(body.name, body.sport_id ?? null, body.training_type, body.age_group ?? null,
           body.duration_minutes ?? null, body.objectives ?? null, body.notes ?? null, req.user.id);
    templateId = info.lastInsertRowid;
    const stmt = db.prepare('INSERT INTO session_template_drills (template_id, drill_id, sort_order, duration_minutes, notes) VALUES (?,?,?,?,?)');
    body.drills.forEach((d, i) => stmt.run(templateId, d.drill_id, i, d.duration_minutes ?? null, d.notes ?? null));
  });

  audit(req, { action: 'create', entity: 'session_templates', entityId: templateId, summary: `Session plan created: ${body.name}` });
  res.status(201).json({ template: db.prepare('SELECT * FROM session_templates WHERE id = ?').get(templateId) });
}));

/** Drills run in one session. */
router.get('/training/:id/drills', requireAuth, (req, res) => {
  const drills = db
    .prepare(`SELECT tsd.*, d.name, d.category, d.skill_focus, d.equipment, d.coaching_points, d.video_url
              FROM training_session_drills tsd JOIN drills d ON d.id = tsd.drill_id
              WHERE tsd.session_id = ? ORDER BY tsd.sort_order`)
    .all(req.params.id);
  res.json({ drills });
});

router.put('/training/:id/drills', requirePermission('training.write'), asyncHandler(async (req, res) => {
  const session = db.prepare('SELECT * FROM training_sessions WHERE id = ?').get(req.params.id);
  if (!session) throw new ApiError(404, 'That training session does not exist.');
  if (session.team_id && !canAccessTeam(req.user, session.team_id)) throw new ApiError(403, 'That team is not assigned to you.');

  const schema = z.object({
    drills: z.array(z.object({
      drill_id: z.coerce.number().int(),
      duration_minutes: z.coerce.number().int().optional().nullable(),
      notes: z.string().optional().nullable(),
    })),
  });
  const { drills } = schema.parse(req.body);

  tx(() => {
    db.prepare('DELETE FROM training_session_drills WHERE session_id = ?').run(session.id);
    const stmt = db.prepare('INSERT INTO training_session_drills (session_id, drill_id, sort_order, duration_minutes, notes) VALUES (?,?,?,?,?)');
    drills.forEach((d, i) => stmt.run(session.id, d.drill_id, i, d.duration_minutes ?? null, d.notes ?? null));
  });

  audit(req, { action: 'update', entity: 'training_session_drills', entityId: session.id, summary: `${drills.length} drills set on session #${session.id}` });
  res.json({ ok: true, count: drills.length });
}));

/** Build a session from a saved plan, copying its drills across. */
router.post('/training/:id/apply-template/:templateId', requirePermission('training.write'), asyncHandler(async (req, res) => {
  const session = db.prepare('SELECT * FROM training_sessions WHERE id = ?').get(req.params.id);
  if (!session) throw new ApiError(404, 'That training session does not exist.');
  const template = db.prepare('SELECT * FROM session_templates WHERE id = ?').get(req.params.templateId);
  if (!template) throw new ApiError(404, 'That session plan does not exist.');

  const drills = db.prepare('SELECT * FROM session_template_drills WHERE template_id = ? ORDER BY sort_order').all(template.id);
  tx(() => {
    db.prepare('DELETE FROM training_session_drills WHERE session_id = ?').run(session.id);
    const stmt = db.prepare('INSERT INTO training_session_drills (session_id, drill_id, sort_order, duration_minutes, notes) VALUES (?,?,?,?,?)');
    drills.forEach((d, i) => stmt.run(session.id, d.drill_id, i, d.duration_minutes, d.notes));
    if (template.objectives && !session.objectives) {
      db.prepare('UPDATE training_sessions SET objectives = ? WHERE id = ?').run(template.objectives, session.id);
    }
  });

  audit(req, { action: 'update', entity: 'training_sessions', entityId: session.id, summary: `Session plan "${template.name}" applied` });
  res.json({ ok: true, drills: drills.length });
}));

/* ================================================================== */
/* Benchmarks                                                         */
/* ================================================================== */

router.get('/benchmarks', requireAuth, (req, res) => {
  const where = ['1 = 1'];
  const params = [];
  if (req.query.sport) { where.push('(b.sport_id = ? OR b.sport_id IS NULL)'); params.push(Number(req.query.sport)); }
  if (req.query.ageGroup) { where.push('b.age_group = ?'); params.push(req.query.ageGroup); }
  if (req.query.source) { where.push('b.source = ?'); params.push(req.query.source); }
  const benchmarks = db
    .prepare(`SELECT b.*, s.name AS sport_name FROM benchmarks b LEFT JOIN sports s ON s.id = b.sport_id
              WHERE ${where.join(' AND ')} ORDER BY b.source, b.age_group, b.label`)
    .all(...params);
  res.json({ benchmarks });
});

const benchmarkSchema = z.object({
  sport_id: z.coerce.number().int().optional().nullable(),
  age_group: z.string().min(1),
  gender: z.enum(['male', 'female', 'mixed']).optional().nullable(),
  source: z.enum(['career', 'assessment', 'fitness']).default('career'),
  metric: z.string().min(1),
  label: z.string().min(1),
  unit: z.string().optional().nullable(),
  higher_is_better: z.coerce.number().int().min(0).max(1).default(1),
  developing: z.coerce.number().optional().nullable(),
  competent: z.coerce.number().optional().nullable(),
  strong: z.coerce.number().optional().nullable(),
  exceptional: z.coerce.number().optional().nullable(),
  notes: z.string().optional().nullable(),
});

router.post('/benchmarks', requirePermission('assessments.write'), asyncHandler(async (req, res) => {
  const body = benchmarkSchema.parse(req.body);
  const cols = Object.keys(body);
  const info = db
    .prepare(`INSERT INTO benchmarks (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`)
    .run(...cols.map((c) => body[c] ?? null));
  audit(req, { action: 'create', entity: 'benchmarks', entityId: info.lastInsertRowid, summary: `Benchmark added: ${body.label} (${body.age_group})` });
  res.status(201).json({ benchmark: db.prepare('SELECT * FROM benchmarks WHERE id = ?').get(info.lastInsertRowid) });
}));

/** Where a value sits against its benchmark. */
function band(benchmark, value) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return null;
  const v = Number(value);
  const steps = benchmark.higher_is_better
    ? [['exceptional', benchmark.exceptional], ['strong', benchmark.strong], ['competent', benchmark.competent], ['developing', benchmark.developing]]
    : [['exceptional', benchmark.exceptional], ['strong', benchmark.strong], ['competent', benchmark.competent], ['developing', benchmark.developing]];
  for (const [name, threshold] of steps) {
    if (threshold === null || threshold === undefined) continue;
    if (benchmark.higher_is_better ? v >= threshold : v <= threshold) return name;
  }
  return 'below';
}

/**
 * One athlete measured against their age group.
 *
 * A raw number means little on its own — 24 runs an innings is excellent for an
 * under-14 and modest for a senior. This puts every headline metric next to the
 * standard for the group the athlete actually plays in.
 */
router.get('/players/:id/benchmarks', requireAuth, (req, res) => {
  const playerId = Number(req.params.id);
  const allowed = allowedPlayerIds(req.user);
  if (allowed !== null && !allowed.includes(playerId)) {
    throw new ApiError(403, 'That athlete is outside the teams and sports assigned to you.');
  }
  const player = db.prepare('SELECT * FROM players WHERE id = ?').get(playerId);
  if (!player) throw new ApiError(404, 'That athlete record does not exist.');

  // The age group is taken from the team they currently play in, falling back
  // to the one implied by their date of birth.
  const membership = db
    .prepare(`SELECT t.age_group FROM team_memberships tm JOIN teams t ON t.id = tm.team_id
              WHERE tm.player_id = ? AND tm.end_date IS NULL AND t.age_group IS NOT NULL
              ORDER BY tm.start_date DESC LIMIT 1`)
    .get(playerId);

  let ageGroup = membership?.age_group;
  if (!ageGroup && player.dob) {
    const age = Math.floor((Date.now() - new Date(player.dob)) / (365.25 * 864e5));
    ageGroup = age < 16 ? 'U16' : age < 18 ? 'U18' : 'Senior';
  }
  ageGroup = ageGroup || 'Senior';

  const sports = db
    .prepare('SELECT ps.sport_id FROM player_sports ps WHERE ps.player_id = ? ORDER BY ps.is_primary DESC')
    .all(playerId);

  const comparisons = [];
  for (const { sport_id: sportId } of sports) {
    const sport = getSport(String(sportId));
    if (!sport) continue;
    const career = playerCareer(playerId, sport, {});
    const benchmarks = db
      .prepare(`SELECT * FROM benchmarks WHERE age_group = ? AND source = 'career'
                AND (sport_id = ? OR sport_id IS NULL)
                AND (gender IS NULL OR gender = ?)`)
      .all(ageGroup, sportId, player.gender || 'male');

    for (const b of benchmarks) {
      const value = career.career.values[b.metric];
      if (value === undefined) continue;
      comparisons.push({
        sport: sport.name,
        sportId: sport.id,
        metric: b.metric,
        label: b.label,
        unit: b.unit,
        value: Math.round(Number(value) * 100) / 100,
        band: band(b, value),
        thresholds: {
          developing: b.developing, competent: b.competent,
          strong: b.strong, exceptional: b.exceptional,
        },
        higherIsBetter: !!b.higher_is_better,
        matchesPlayed: career.matchesPlayed,
      });
    }
  }

  // The same treatment for the latest assessment scores.
  const latest = db
    .prepare('SELECT * FROM assessments WHERE player_id = ? ORDER BY assessment_date DESC LIMIT 1')
    .get(playerId);
  const assessmentComparisons = [];
  if (latest) {
    const scores = db
      .prepare(`SELECT sc.score, c.key, c.name, c.category FROM assessment_scores sc
                JOIN assessment_criteria c ON c.id = sc.criteria_id WHERE sc.assessment_id = ?`)
      .all(latest.id);
    for (const sc of scores) {
      const b = db
        .prepare(`SELECT * FROM benchmarks WHERE age_group = ? AND source = 'assessment' AND metric = ?
                  AND (sport_id = ? OR sport_id IS NULL) LIMIT 1`)
        .get(ageGroup, sc.key, latest.sport_id);
      if (!b) continue;
      assessmentComparisons.push({
        metric: sc.key, label: sc.name, category: sc.category,
        value: sc.score, band: band(b, sc.score),
        thresholds: { developing: b.developing, competent: b.competent, strong: b.strong, exceptional: b.exceptional },
        higherIsBetter: !!b.higher_is_better,
      });
    }
  }

  res.json({
    ageGroup,
    assessedOn: latest?.assessment_date ?? null,
    career: comparisons,
    assessment: assessmentComparisons,
  });
});

/* ================================================================== */
/* Announcements                                                      */
/* ================================================================== */

router.get('/announcements', requireAuth, (req, res) => {
  const teams = allowedTeamIds(req.user);
  const linked = req.user.linkedPlayerIds || [];

  let rows = db
    .prepare(`SELECT a.*, s.name AS sport_name, t.name AS team_name, u.full_name AS author
              FROM announcements a
              LEFT JOIN sports s ON s.id = a.sport_id
              LEFT JOIN teams t ON t.id = a.team_id
              LEFT JOIN users u ON u.id = a.created_by
              WHERE (a.expires_at IS NULL OR a.expires_at >= date('now'))
              ORDER BY a.created_at DESC LIMIT 200`)
    .all();

  // A coach sees club-wide notices and anything for their own teams; an
  // athlete or guardian sees what was addressed to them.
  rows = rows.filter((a) => {
    if (a.audience === 'club') return true;
    if (a.audience === 'team') return teams === null || teams.includes(a.team_id);
    if (a.audience === 'sport') return true;
    if (a.audience === 'players' || a.audience === 'coaches') {
      const addressed = db
        .prepare('SELECT COUNT(*) AS c FROM announcement_recipients WHERE announcement_id = ? AND (user_id = ? OR player_id IN (SELECT value FROM json_each(?)))')
        .get(a.id, req.user.id, JSON.stringify(linked.length ? linked : [0])).c;
      return addressed > 0 || req.user.role === 'super_admin' || req.user.role === 'sports_director';
    }
    return false;
  });

  res.json({
    announcements: rows.map((a) => ({
      ...a,
      recipients: db
        .prepare(`SELECT r.*, p.first_name, p.last_name, p.athlete_id FROM announcement_recipients r
                  LEFT JOIN players p ON p.id = r.player_id WHERE r.announcement_id = ?`)
        .all(a.id),
    })),
  });
});

router.post('/announcements', requirePermission('training.write'), asyncHandler(async (req, res) => {
  const schema = z.object({
    title: z.string().min(2),
    body: z.string().min(1),
    audience: z.enum(['club', 'sport', 'team', 'players', 'coaches']).default('club'),
    sport_id: z.coerce.number().int().optional().nullable(),
    team_id: z.coerce.number().int().optional().nullable(),
    priority: z.enum(['normal', 'important', 'urgent']).default('normal'),
    starts_at: z.string().optional().nullable(),
    expires_at: z.string().optional().nullable(),
    playerIds: z.array(z.coerce.number().int()).optional(),
  });
  const body = schema.parse(req.body);

  if (body.audience === 'team' && !body.team_id) throw new ApiError(422, 'Choose the team this is for.');
  if (body.audience === 'sport' && !body.sport_id) throw new ApiError(422, 'Choose the sport this is for.');
  if (body.audience === 'players' && !(body.playerIds || []).length) {
    throw new ApiError(422, 'Choose at least one athlete to send this to.');
  }
  if (body.team_id && !canAccessTeam(req.user, body.team_id)) throw new ApiError(403, 'That team is not assigned to you.');

  let id;
  tx(() => {
    const info = db
      .prepare(`INSERT INTO announcements (title, body, audience, sport_id, team_id, priority, starts_at, expires_at, created_by)
                VALUES (?,?,?,?,?,?,?,?,?)`)
      .run(body.title, body.body, body.audience, body.sport_id ?? null, body.team_id ?? null,
           body.priority, body.starts_at ?? null, body.expires_at ?? null, req.user.id);
    id = info.lastInsertRowid;
    const stmt = db.prepare('INSERT OR IGNORE INTO announcement_recipients (announcement_id, player_id) VALUES (?,?)');
    (body.playerIds || []).forEach((playerId) => stmt.run(id, playerId));
  });

  audit(req, { action: 'create', entity: 'announcements', entityId: id, summary: `Announcement sent: ${body.title}` });
  res.status(201).json({ announcement: db.prepare('SELECT * FROM announcements WHERE id = ?').get(id) });
}));

router.delete('/announcements/:id', requirePermission('training.write'), asyncHandler(async (req, res) => {
  const row = db.prepare('SELECT * FROM announcements WHERE id = ?').get(req.params.id);
  if (!row) throw new ApiError(404, 'That announcement does not exist.');
  db.prepare('DELETE FROM announcements WHERE id = ?').run(row.id);
  audit(req, { action: 'delete', entity: 'announcements', entityId: row.id, summary: `Announcement removed: ${row.title}` });
  res.json({ ok: true });
}));

module.exports = router;
module.exports.band = band;
