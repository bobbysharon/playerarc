'use strict';
const express = require('express');
const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');
const { db, parseJson } = require('../db');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { audit } = require('../middleware/audit');
const { asyncHandler, ApiError } = require('../middleware/error');
const { allowedPlayerIds, allowedTeamIds, canAccessPlayer, scopeClause } = require('../middleware/scope');
const { getSport, listSports, playerCareer, playerCareerAllSports, playerSummary } = require('../lib/repo');
const { aggregateCareer, formatStat } = require('../lib/stats-engine');

const router = express.Router();

/* ==================================================================== */
/* Admin dashboard                                                      */
/* ==================================================================== */
router.get('/dashboard', requireAuth, (req, res) => {
  const count = (sql, ...params) => db.prepare(sql).get(...params).c;

  const totals = {
    athletes: count('SELECT COUNT(*) AS c FROM players'),
    activeAthletes: count(`SELECT COUNT(*) AS c FROM players WHERE status = 'active'`),
    sports: count('SELECT COUNT(*) AS c FROM sports WHERE is_active = 1'),
    teams: count('SELECT COUNT(*) AS c FROM teams WHERE is_active = 1'),
    coaches: count('SELECT COUNT(*) AS c FROM coaches WHERE is_active = 1'),
    matches: count('SELECT COUNT(*) AS c FROM matches'),
    completedMatches: count(`SELECT COUNT(*) AS c FROM matches WHERE status = 'completed'`),
    tournaments: count('SELECT COUNT(*) AS c FROM tournaments'),
    trainingSessions: count('SELECT COUNT(*) AS c FROM training_sessions'),
    assessments: count('SELECT COUNT(*) AS c FROM assessments'),
    achievements: count('SELECT COUNT(*) AS c FROM achievements'),
    performances: count('SELECT COUNT(*) AS c FROM match_performances'),
  };

  const bySport = db
    .prepare(`SELECT s.id, s.name, s.code, s.color,
                     (SELECT COUNT(*) FROM player_sports ps WHERE ps.sport_id = s.id) AS players,
                     (SELECT COUNT(*) FROM teams t WHERE t.sport_id = s.id) AS teams,
                     (SELECT COUNT(*) FROM matches m WHERE m.sport_id = s.id) AS matches
              FROM sports s WHERE s.is_active = 1 ORDER BY s.sort_order`)
    .all();

  const byStatus = db.prepare('SELECT status, COUNT(*) AS count FROM players GROUP BY status ORDER BY count DESC').all();

  const byAgeGroup = db
    .prepare(`SELECT t.age_group AS age_group, COUNT(DISTINCT tm.player_id) AS count
              FROM team_memberships tm JOIN teams t ON t.id = tm.team_id
              WHERE tm.end_date IS NULL AND t.age_group IS NOT NULL GROUP BY t.age_group ORDER BY t.age_group`)
    .all();

  const recentRegistrations = db
    .prepare(`SELECT id, athlete_id, first_name, last_name, display_name, photo_url, registration_date, status
              FROM players ORDER BY registration_date DESC, id DESC LIMIT 6`)
    .all();

  const recentAchievements = db
    .prepare(`SELECT a.*, p.athlete_id, p.first_name, p.last_name, p.photo_url, s.name AS sport_name, s.color
              FROM achievements a JOIN players p ON p.id = a.player_id LEFT JOIN sports s ON s.id = a.sport_id
              ORDER BY a.awarded_date DESC LIMIT 6`)
    .all();

  const upcomingMatches = db
    .prepare(`SELECT m.*, s.name AS sport_name, s.color, ht.name AS home_team_name, at.name AS away_team_name, t.name AS tournament_name
              FROM matches m JOIN sports s ON s.id = m.sport_id
              LEFT JOIN teams ht ON ht.id = m.home_team_id
              LEFT JOIN teams at ON at.id = m.away_team_id
              LEFT JOIN tournaments t ON t.id = m.tournament_id
              WHERE m.status IN ('scheduled','live') ORDER BY m.scheduled_at ASC LIMIT 6`)
    .all();

  const recentMatches = db
    .prepare(`SELECT m.*, s.name AS sport_name, s.color, ht.name AS home_team_name, at.name AS away_team_name,
                     p.first_name || ' ' || p.last_name AS motm_name
              FROM matches m JOIN sports s ON s.id = m.sport_id
              LEFT JOIN teams ht ON ht.id = m.home_team_id
              LEFT JOIN teams at ON at.id = m.away_team_id
              LEFT JOIN players p ON p.id = m.player_of_match_id
              WHERE m.status = 'completed' ORDER BY m.scheduled_at DESC LIMIT 6`)
    .all();

  const upcomingTraining = db
    .prepare(`SELECT ts.*, s.name AS sport_name, t.name AS team_name, c.full_name AS coach_name
              FROM training_sessions ts JOIN sports s ON s.id = ts.sport_id
              LEFT JOIN teams t ON t.id = ts.team_id LEFT JOIN coaches c ON c.id = ts.coach_id
              WHERE ts.session_date >= date('now') ORDER BY ts.session_date LIMIT 5`)
    .all();

  // Registrations per month for the last twelve months.
  const registrationTrend = db
    .prepare(`SELECT substr(registration_date, 1, 7) AS month, COUNT(*) AS count
              FROM players WHERE registration_date >= date('now', '-12 months')
              GROUP BY month ORDER BY month`)
    .all();

  const attendance = db
    .prepare(`SELECT COUNT(*) AS total,
                     SUM(CASE WHEN status IN ('present','late') THEN 1 ELSE 0 END) AS attended
              FROM training_attendance`)
    .get();

  res.json({
    totals,
    bySport,
    byStatus,
    byAgeGroup,
    recentRegistrations,
    recentAchievements,
    upcomingMatches,
    recentMatches,
    upcomingTraining,
    registrationTrend,
    attendanceRate: attendance.total ? Math.round((attendance.attended / attendance.total) * 1000) / 10 : 0,
    demoDataPresent: db.prepare('SELECT COUNT(*) AS c FROM players WHERE is_demo = 1').get().c > 0,
  });
});

/* ==================================================================== */
/* Global search                                                        */
/* ==================================================================== */
router.get('/search', requireAuth, (req, res) => {
  const q = String(req.query.q || '').trim();
  if (q.length < 2) return res.json({ players: [], teams: [], tournaments: [], matches: [], coaches: [] });
  const like = `%${q}%`;
  const scope = scopeClause('p.id', allowedPlayerIds(req.user));

  const players = db
    .prepare(`SELECT p.id, p.athlete_id, p.first_name, p.last_name, p.display_name, p.photo_url, p.status
              FROM players p
              WHERE (p.first_name LIKE ? OR p.last_name LIKE ? OR p.display_name LIKE ? OR p.athlete_id LIKE ?)${scope.sql}
              LIMIT 8`)
    .all(like, like, like, like, ...scope.params);

  const teams = db
    .prepare(`SELECT t.id, t.name, t.age_group, s.name AS sport_name FROM teams t JOIN sports s ON s.id = t.sport_id
              WHERE t.name LIKE ? LIMIT 5`)
    .all(like);

  const tournaments = db
    .prepare(`SELECT t.id, t.name, t.status, s.name AS sport_name FROM tournaments t JOIN sports s ON s.id = t.sport_id
              WHERE t.name LIKE ? LIMIT 5`)
    .all(like);

  const coaches = db.prepare('SELECT id, full_name, role FROM coaches WHERE full_name LIKE ? LIMIT 5').all(like);

  const matches = db
    .prepare(`SELECT m.id, m.scheduled_at, m.venue, m.opponent_name, s.name AS sport_name,
                     ht.name AS home_team_name, at.name AS away_team_name
              FROM matches m JOIN sports s ON s.id = m.sport_id
              LEFT JOIN teams ht ON ht.id = m.home_team_id LEFT JOIN teams at ON at.id = m.away_team_id
              WHERE m.venue LIKE ? OR m.opponent_name LIKE ? OR ht.name LIKE ? OR at.name LIKE ? LIMIT 5`)
    .all(like, like, like, like);

  res.json({ players, teams, tournaments, matches, coaches });
});

/* ==================================================================== */
/* Rankings & leaderboards                                              */
/* ==================================================================== */
router.get('/rankings', requirePermission('rankings.read'), (req, res) => {
  const sportParam = req.query.sport;
  if (!sportParam) throw new ApiError(422, 'Choose a sport — statistics from different sports are not comparable.');
  const sport = getSport(String(sportParam));
  if (!sport) throw new ApiError(404, 'That sport does not exist.');

  const where = ['p.sport_id = ?'];
  const params = [sport.id];
  if (req.query.season) { where.push('m.season_id = ?'); params.push(Number(req.query.season)); }
  if (req.query.tournament) { where.push('m.tournament_id = ?'); params.push(Number(req.query.tournament)); }
  if (req.query.team) { where.push('p.team_id = ?'); params.push(Number(req.query.team)); }
  if (req.query.ageGroup) {
    where.push(`EXISTS (SELECT 1 FROM team_memberships tm JOIN teams t ON t.id = tm.team_id
                        WHERE tm.player_id = p.player_id AND t.age_group = ?)`);
    params.push(req.query.ageGroup);
  }

  const rows = db
    .prepare(`SELECT p.player_id, p.stats_json, pl.athlete_id, pl.first_name, pl.last_name, pl.display_name, pl.photo_url, pl.status
              FROM match_performances p
              JOIN matches m ON m.id = p.match_id
              JOIN players pl ON pl.id = p.player_id
              WHERE ${where.join(' AND ')}`)
    .all(...params);

  const grouped = new Map();
  for (const r of rows) {
    if (!grouped.has(r.player_id)) grouped.set(r.player_id, { player: r, stats: [] });
    grouped.get(r.player_id).stats.push(parseJson(r.stats_json, {}));
  }

  const players = [...grouped.values()].map(({ player, stats }) => ({
    playerId: player.player_id,
    athleteId: player.athlete_id,
    name: player.display_name || `${player.first_name} ${player.last_name}`,
    photoUrl: player.photo_url,
    career: aggregateCareer(sport.config, stats).values,
  }));

  const boards = (sport.config.leaderboards || []).map((board) => {
    const entries = players
      .filter((p) => !board.qualifier || (p.career[board.qualifier.metric] || 0) >= board.qualifier.min)
      .map((p) => ({
        playerId: p.playerId,
        athleteId: p.athleteId,
        name: p.name,
        photoUrl: p.photoUrl,
        value: Number(p.career[board.metric]) || 0,
        display: formatStat(p.career[board.metric], board.format),
      }))
      .filter((e) => e.value > 0);
    entries.sort((a, b) => (board.order === 'asc' ? a.value - b.value : b.value - a.value));
    return {
      key: board.key,
      label: board.label,
      metric: board.metric,
      qualifier: board.qualifier ? `Minimum ${board.qualifier.min} ${board.qualifier.metric.replace(/_/g, ' ')}` : null,
      entries: entries.slice(0, Number(req.query.limit) || 10).map((e, i) => ({ ...e, rank: i + 1 })),
    };
  }).filter((b) => b.entries.length);

  res.json({ sport: { id: sport.id, name: sport.name, code: sport.code, color: sport.color }, boards });
});

/* ==================================================================== */
/* Reports                                                              */
/* ==================================================================== */
function buildPlayerReport(playerId) {
  const player = db.prepare('SELECT * FROM players WHERE id = ?').get(playerId);
  if (!player) throw new ApiError(404, 'That athlete record does not exist.');
  const careers = playerCareerAllSports(playerId);
  const teams = db
    .prepare(`SELECT tm.*, t.name AS team_name, t.age_group, s.name AS sport_name FROM team_memberships tm
              JOIN teams t ON t.id = tm.team_id JOIN sports s ON s.id = t.sport_id
              WHERE tm.player_id = ? ORDER BY tm.start_date DESC`)
    .all(playerId);
  const achievements = db
    .prepare(`SELECT a.*, s.name AS sport_name FROM achievements a LEFT JOIN sports s ON s.id = a.sport_id
              WHERE a.player_id = ? ORDER BY a.awarded_date DESC`)
    .all(playerId);
  const assessments = db
    .prepare('SELECT * FROM assessments WHERE player_id = ? ORDER BY assessment_date DESC')
    .all(playerId);
  const timelineEvents = db
    .prepare('SELECT * FROM player_timeline WHERE player_id = ? ORDER BY event_date DESC')
    .all(playerId);
  return { player, summary: playerSummary(playerId), careers, teams, achievements, assessments, timeline: timelineEvents };
}

router.get('/reports/player/:id', requirePermission('reports.read'), (req, res) => {
  if (!canAccessPlayer(req.user, Number(req.params.id))) throw new ApiError(403, 'That athlete is outside your assigned teams.');
  res.json(buildPlayerReport(Number(req.params.id)));
});

router.get('/reports/team/:id', requirePermission('reports.read'), (req, res) => {
  const team = db
    .prepare('SELECT t.*, s.name AS sport_name, s.id AS sport_id FROM teams t JOIN sports s ON s.id = t.sport_id WHERE t.id = ?')
    .get(req.params.id);
  if (!team) throw new ApiError(404, 'That team does not exist.');
  const sport = getSport(String(team.sport_id));

  const roster = db
    .prepare(`SELECT tm.*, p.id AS player_id, p.athlete_id, p.first_name, p.last_name, p.status AS player_status
              FROM team_memberships tm JOIN players p ON p.id = tm.player_id WHERE tm.team_id = ?`)
    .all(team.id);

  const players = roster.map((r) => {
    const career = playerCareer(r.player_id, sport, {});
    return {
      playerId: r.player_id,
      athleteId: r.athlete_id,
      name: `${r.first_name} ${r.last_name}`,
      role: r.role,
      jersey: r.jersey_number,
      active: !r.end_date,
      matches: career.matchesPlayed,
      rating: career.rating ? career.rating.overall : null,
      headline: career.headline,
    };
  });

  const matches = db
    .prepare(`SELECT m.*, ht.name AS home_team_name, at.name AS away_team_name FROM matches m
              LEFT JOIN teams ht ON ht.id = m.home_team_id LEFT JOIN teams at ON at.id = m.away_team_id
              WHERE m.home_team_id = ? OR m.away_team_id = ? ORDER BY m.scheduled_at DESC`)
    .all(team.id, team.id);

  const completed = matches.filter((m) => m.status === 'completed');
  const record = {
    played: completed.length,
    won: completed.filter((m) => m.winner_team_id === team.id).length,
    lost: completed.filter((m) => m.winner_team_id && m.winner_team_id !== team.id).length,
  };
  record.drawn = record.played - record.won - record.lost;
  record.winRate = record.played ? Math.round((record.won / record.played) * 1000) / 10 : 0;

  const attendance = db
    .prepare(`SELECT COUNT(*) AS total, SUM(CASE WHEN ta.status IN ('present','late') THEN 1 ELSE 0 END) AS attended
              FROM training_attendance ta JOIN training_sessions ts ON ts.id = ta.session_id WHERE ts.team_id = ?`)
    .get(team.id);

  res.json({
    team,
    record,
    players,
    matches,
    attendanceRate: attendance.total ? Math.round((attendance.attended / attendance.total) * 1000) / 10 : 0,
  });
});

router.get('/reports/tournament/:id', requirePermission('reports.read'), (req, res) => {
  const tournament = db
    .prepare('SELECT t.*, s.name AS sport_name, s.id AS sport_id FROM tournaments t JOIN sports s ON s.id = t.sport_id WHERE t.id = ?')
    .get(req.params.id);
  if (!tournament) throw new ApiError(404, 'That tournament does not exist.');
  const sport = getSport(String(tournament.sport_id));

  const matches = db
    .prepare(`SELECT m.*, ht.name AS home_team_name, at.name AS away_team_name FROM matches m
              LEFT JOIN teams ht ON ht.id = m.home_team_id LEFT JOIN teams at ON at.id = m.away_team_id
              WHERE m.tournament_id = ? ORDER BY m.scheduled_at`)
    .all(tournament.id);

  const rows = db
    .prepare(`SELECT p.player_id, p.stats_json, pl.athlete_id, pl.first_name, pl.last_name
              FROM match_performances p JOIN matches m ON m.id = p.match_id JOIN players pl ON pl.id = p.player_id
              WHERE m.tournament_id = ?`)
    .all(tournament.id);

  const grouped = new Map();
  for (const r of rows) {
    if (!grouped.has(r.player_id)) grouped.set(r.player_id, { r, stats: [] });
    grouped.get(r.player_id).stats.push(parseJson(r.stats_json, {}));
  }
  const players = [...grouped.values()].map(({ r, stats }) => {
    const career = aggregateCareer(sport.config, stats);
    return {
      playerId: r.player_id,
      athleteId: r.athlete_id,
      name: `${r.first_name} ${r.last_name}`,
      matches: stats.length,
      stats: (sport.config.headline || []).map((k) => career.entries.find((e) => e.key === k)).filter(Boolean),
    };
  });

  const awards = db
    .prepare(`SELECT a.*, p.first_name, p.last_name, p.athlete_id FROM achievements a JOIN players p ON p.id = a.player_id
              WHERE a.tournament_id = ?`)
    .all(tournament.id);

  res.json({ tournament, matches, players, awards });
});

router.get('/reports/sport/:id', requirePermission('reports.read'), (req, res) => {
  const sport = getSport(String(req.params.id));
  if (!sport) throw new ApiError(404, 'That sport does not exist.');
  const teams = db
    .prepare(`SELECT t.*, (SELECT COUNT(*) FROM team_memberships tm WHERE tm.team_id = t.id AND tm.end_date IS NULL) AS squad_size
              FROM teams t WHERE t.sport_id = ?`)
    .all(sport.id);
  const players = db
    .prepare(`SELECT p.id, p.athlete_id, p.first_name, p.last_name, ps.position, ps.playing_level, p.status
              FROM player_sports ps JOIN players p ON p.id = ps.player_id WHERE ps.sport_id = ? ORDER BY p.last_name`)
    .all(sport.id);
  const matches = db.prepare('SELECT COUNT(*) AS c FROM matches WHERE sport_id = ?').get(sport.id).c;
  const tournaments = db.prepare('SELECT COUNT(*) AS c FROM tournaments WHERE sport_id = ?').get(sport.id).c;
  const positionSplit = db
    .prepare(`SELECT position, COUNT(*) AS count FROM player_sports WHERE sport_id = ? AND position IS NOT NULL GROUP BY position ORDER BY count DESC`)
    .all(sport.id);
  res.json({ sport: { ...sport, config_json: undefined }, teams, players, matches, tournaments, positionSplit });
});

router.get('/reports/coach/:id', requirePermission('reports.read'), (req, res) => {
  const coach = db.prepare('SELECT * FROM coaches WHERE id = ?').get(req.params.id);
  if (!coach) throw new ApiError(404, 'That coach does not exist.');
  const teams = db.prepare('SELECT * FROM teams WHERE head_coach_id = ?').all(coach.id);
  const sessions = db.prepare('SELECT * FROM training_sessions WHERE coach_id = ? ORDER BY session_date DESC').all(coach.id);
  const assessments = db
    .prepare(`SELECT a.*, p.athlete_id, p.first_name, p.last_name FROM assessments a JOIN players p ON p.id = a.player_id
              WHERE a.assessed_by = ? ORDER BY a.assessment_date DESC`)
    .all(coach.id);
  const players = teams.length
    ? db.prepare(`SELECT DISTINCT p.id, p.athlete_id, p.first_name, p.last_name, p.status
                  FROM team_memberships tm JOIN players p ON p.id = tm.player_id
                  WHERE tm.team_id IN (${teams.map(() => '?').join(',')}) AND tm.end_date IS NULL`)
        .all(...teams.map((t) => t.id))
    : [];
  const attendance = sessions.length
    ? db.prepare(`SELECT COUNT(*) AS total, SUM(CASE WHEN status IN ('present','late') THEN 1 ELSE 0 END) AS attended
                  FROM training_attendance WHERE session_id IN (${sessions.map(() => '?').join(',')})`)
        .get(...sessions.map((s) => s.id))
    : { total: 0, attended: 0 };
  res.json({
    coach,
    teams,
    players,
    sessions: sessions.slice(0, 30),
    sessionCount: sessions.length,
    assessments: assessments.slice(0, 30),
    assessmentCount: assessments.length,
    attendanceRate: attendance.total ? Math.round((attendance.attended / attendance.total) * 1000) / 10 : 0,
  });
});

/* ---- Exports: CSV, Excel, PDF --------------------------------------- */
function toCsv(rows, columns) {
  const escape = (v) => {
    if (v === null || v === undefined) return '';
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = columns.map((c) => escape(c.label)).join(',');
  const body = rows.map((r) => columns.map((c) => escape(r[c.key])).join(',')).join('\n');
  return `${header}\n${body}`;
}

function playerExportRows(scopeIds) {
  const scope = scopeClause('p.id', scopeIds);
  return db
    .prepare(`SELECT p.athlete_id, p.first_name, p.last_name, p.dob, p.gender, p.nationality, p.status,
                     p.registration_date, p.height_cm, p.weight_kg,
                     (SELECT s.name FROM player_sports ps JOIN sports s ON s.id = ps.sport_id
                      WHERE ps.player_id = p.id ORDER BY ps.is_primary DESC LIMIT 1) AS primary_sport,
                     (SELECT group_concat(t.name, ' | ') FROM team_memberships tm JOIN teams t ON t.id = tm.team_id
                      WHERE tm.player_id = p.id AND tm.end_date IS NULL) AS current_teams,
                     (SELECT COUNT(*) FROM match_performances mp WHERE mp.player_id = p.id) AS matches,
                     (SELECT COUNT(*) FROM achievements a WHERE a.player_id = p.id) AS awards,
                     p.is_demo
              FROM players p WHERE 1 = 1${scope.sql} ORDER BY p.athlete_id`)
    .all(...scope.params);
}

const PLAYER_COLUMNS = [
  { key: 'athlete_id', label: 'Athlete ID' },
  { key: 'first_name', label: 'First name' },
  { key: 'last_name', label: 'Last name' },
  { key: 'dob', label: 'Date of birth' },
  { key: 'gender', label: 'Gender' },
  { key: 'nationality', label: 'Nationality' },
  { key: 'status', label: 'Status' },
  { key: 'registration_date', label: 'Registered' },
  { key: 'primary_sport', label: 'Primary sport' },
  { key: 'current_teams', label: 'Current teams' },
  { key: 'matches', label: 'Matches' },
  { key: 'awards', label: 'Awards' },
  { key: 'height_cm', label: 'Height (cm)' },
  { key: 'weight_kg', label: 'Weight (kg)' },
  { key: 'is_demo', label: 'Demo record' },
];

router.get('/export/players.csv', requirePermission('reports.export'), (req, res) => {
  const rows = playerExportRows(allowedPlayerIds(req.user));
  audit(req, { action: 'export', entity: 'players', summary: `Exported ${rows.length} athlete records to CSV` });
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="playerarc-athletes.csv"');
  res.send(toCsv(rows, PLAYER_COLUMNS));
});

router.get('/export/players.xlsx', requirePermission('reports.export'), asyncHandler(async (req, res) => {
  const rows = playerExportRows(allowedPlayerIds(req.user));
  const wb = new ExcelJS.Workbook();
  wb.creator = 'PlayerArc — Karwan Sports Club';
  wb.created = new Date();

  const sheet = wb.addWorksheet('Athletes');
  sheet.columns = PLAYER_COLUMNS.map((c) => ({ header: c.label, key: c.key, width: Math.max(14, c.label.length + 4) }));
  rows.forEach((r) => sheet.addRow({ ...r, is_demo: r.is_demo ? 'Yes' : 'No' }));
  sheet.getRow(1).font = { bold: true };
  sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0E2233' } };
  sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  sheet.autoFilter = { from: 'A1', to: { row: 1, column: PLAYER_COLUMNS.length } };
  sheet.views = [{ state: 'frozen', ySplit: 1 }];

  // One tab per sport with that sport's own career columns.
  for (const sport of listSports({ activeOnly: true })) {
    const players = db
      .prepare(`SELECT p.id, p.athlete_id, p.first_name, p.last_name FROM player_sports ps
                JOIN players p ON p.id = ps.player_id WHERE ps.sport_id = ? ORDER BY p.last_name`)
      .all(sport.id);
    if (!players.length) continue;
    const careerDefs = (sport.config.career || []).filter((c) => !c.hidden);
    const ws = wb.addWorksheet(sport.name.slice(0, 28));
    ws.columns = [
      { header: 'Athlete ID', key: 'athlete_id', width: 18 },
      { header: 'Name', key: 'name', width: 26 },
      ...careerDefs.map((c) => ({ header: c.label, key: c.key, width: Math.max(12, c.label.length + 3) })),
    ];
    for (const p of players) {
      const career = playerCareer(p.id, sport, {});
      const row = { athlete_id: p.athlete_id, name: `${p.first_name} ${p.last_name}` };
      careerDefs.forEach((c) => { row[c.key] = career.career.values[c.key]; });
      ws.addRow(row);
    }
    ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0E2233' } };
    ws.views = [{ state: 'frozen', ySplit: 1 }];
  }

  audit(req, { action: 'export', entity: 'players', summary: `Exported athlete records to Excel` });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="playerarc-athletes.xlsx"');
  await wb.xlsx.write(res);
  res.end();
}));

router.get('/export/player/:id.pdf', requirePermission('reports.export'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!canAccessPlayer(req.user, id)) throw new ApiError(403, 'That athlete is outside your assigned teams.');
  const report = buildPlayerReport(id);
  const p = report.player;
  const name = p.display_name || `${p.first_name} ${p.last_name}`;

  audit(req, { action: 'export', entity: 'players', entityId: id, summary: `Career report exported for ${p.athlete_id}` });

  const doc = new PDFDocument({ size: 'A4', margin: 48 });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${p.athlete_id}-career-report.pdf"`);
  doc.pipe(res);

  const INK = '#0E2233';
  const ACCENT = '#C8952F';

  doc.rect(0, 0, doc.page.width, 96).fill(INK);
  doc.fillColor('#FFFFFF').fontSize(20).text(name, 48, 30);
  doc.fillColor(ACCENT).fontSize(10).text(`${p.athlete_id}  ·  Karwan Sports Club  ·  Athlete Career Report`, 48, 58);
  doc.fillColor('#9BB0C0').fontSize(8).text(`Generated ${new Date().toISOString().slice(0, 10)} by PlayerArc`, 48, 74);
  doc.moveDown(4);
  doc.fillColor(INK);

  const line = (label, value) => {
    if (value === null || value === undefined || value === '') return;
    doc.fontSize(9).fillColor('#5A6B7A').text(label, { continued: true });
    doc.fillColor(INK).text(`  ${value}`);
  };

  doc.moveTo(48, 120).lineTo(doc.page.width - 48, 120).strokeColor('#DDE4EA').stroke();
  doc.y = 132;
  doc.fontSize(12).fillColor(INK).text('Profile');
  doc.moveDown(0.4);
  line('Status', p.status);
  line('Date of birth', p.dob);
  line('Nationality', p.nationality);
  line('Registered', p.registration_date);
  line('Height / weight', [p.height_cm ? `${p.height_cm} cm` : null, p.weight_kg ? `${p.weight_kg} kg` : null].filter(Boolean).join(' · '));

  doc.moveDown(0.8);
  doc.fontSize(12).text('Career summary');
  doc.moveDown(0.4);
  const s = report.summary;
  line('Matches', s.matches);
  line('Wins', `${s.wins} (${s.winRate}%)`);
  line('Tournaments', s.tournaments);
  line('Awards', s.awards);
  line('Sports played', s.sports);
  line('Training attendance', `${s.attendanceRate}%`);
  if (s.rating != null) line('Performance rating', `${s.rating} / 100`);

  for (const career of report.careers) {
    if (!career.matchesPlayed) continue;
    doc.moveDown(0.8);
    doc.fontSize(12).fillColor(INK).text(`${career.sport.name} — career statistics`);
    doc.moveDown(0.3);
    for (const group of career.career.groups) {
      if (!group.stats.length) continue;
      doc.fontSize(9).fillColor(ACCENT).text(group.label);
      const text = group.stats.map((st) => `${st.label}: ${st.display}`).join('   ·   ');
      doc.fontSize(9).fillColor(INK).text(text, { width: doc.page.width - 96 });
      doc.moveDown(0.3);
    }
    if (career.rating) line('Sport rating', `${career.rating.overall} / 100`);
  }

  if (report.teams.length) {
    doc.moveDown(0.8);
    doc.fontSize(12).fillColor(INK).text('Team history');
    doc.moveDown(0.3);
    report.teams.forEach((t) => {
      doc.fontSize(9).fillColor(INK)
        .text(`${t.start_date} – ${t.end_date || 'present'}   ${t.team_name} (${t.sport_name})${t.age_group ? ` · ${t.age_group}` : ''}${t.role !== 'player' ? ` · ${String(t.role).replace('_', ' ')}` : ''}`);
    });
  }

  if (report.achievements.length) {
    doc.moveDown(0.8);
    doc.fontSize(12).text('Achievements');
    doc.moveDown(0.3);
    report.achievements.forEach((a) => {
      doc.fontSize(9).text(`${a.awarded_date}   ${a.title}${a.sport_name ? ` · ${a.sport_name}` : ''}`);
    });
  }

  if (report.timeline.length) {
    doc.addPage();
    doc.fontSize(14).fillColor(INK).text('Career timeline');
    doc.moveDown(0.5);
    report.timeline.forEach((e) => {
      doc.fontSize(9).fillColor('#5A6B7A').text(e.event_date, { continued: true });
      doc.fillColor(INK).text(`   ${e.title}`);
      if (e.description) doc.fontSize(8).fillColor('#5A6B7A').text(`      ${e.description}`);
    });
  }

  if (p.is_demo) {
    doc.moveDown(1);
    doc.fontSize(8).fillColor('#B45309').text('This report is based on demonstration data.');
  }

  doc.end();
}));

module.exports = router;
