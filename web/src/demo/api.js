/**
 * The browser demo.
 *
 * GitHub Pages serves static files only — there is no Node process and no
 * database. This module answers the same API calls the real server does, from a
 * dataset exported out of the seeded database, running the same statistics and
 * permission logic (see ./engine, generated from the server modules).
 *
 * What is faithful: every read endpoint, career aggregation, ratings,
 * leaderboards, role permissions, data scoping and field redaction. Writes work
 * and update everything downstream — they just live in memory and reset when
 * the page reloads.
 *
 * What is not: authentication. The demo compares a shared plain-text password
 * instead of a bcrypt hash, because hashes must never ship to a browser. That
 * is why this build is for showing the platform, not for running the club.
 */
import dataset from './dataset.json';
import {
  aggregateCareer, computeRating, computeMatchRating, validateStats, performanceScope, formatStat,
} from './engine/stats-engine.js';
import { ROLES, permissionsFor, can, redactPlayer } from './engine/permissions.js';
import { analyseMatch, derivePerformances, describeEvent } from './engine/match-analysis.js';
import * as track from './engine/tracking-analysis.js';

export const DEMO_PASSWORD = 'Karwan@2026';

/**
 * The demo has no server, so it cannot hash. It keeps passwords in memory for
 * the life of the page instead, which is enough to demonstrate the reset flow
 * end to end and is why this build is not for real use.
 */
let passwords = {};

/** Athlete portal passwords, held the same way and for the same reason. */
let athletePasswords = {};

/**
 * The athlete session, kept apart from the staff one exactly as on the server:
 * a staff session cannot read the portal, and an athlete session cannot read
 * anything else. Declared here because reset() runs when this module loads.
 */
let athleteSession = null;

/* ------------------------------------------------------------------ */
/* Store                                                               */
/* ------------------------------------------------------------------ */

let db = null;
let session = null;

function reset() {
  db = JSON.parse(JSON.stringify(dataset));
  if (!db.audit_logs) db.audit_logs = [];
  passwords = {};
  athletePasswords = {};
  session = null;
  athleteSession = null;
}

const passwordFor = (userId) => passwords[userId] ?? DEMO_PASSWORD;
reset();

const all = (t) => db[t] || [];
const find = (t, fn) => all(t).find(fn);
const filter = (t, fn) => all(t).filter(fn);
const byId = (t, id) => find(t, (r) => Number(r.id) === Number(id));
const nextId = (t) => all(t).reduce((m, r) => Math.max(m, Number(r.id) || 0), 0) + 1;
const today = () => new Date().toISOString().slice(0, 10);
const now = () => new Date().toISOString().replace('T', ' ').slice(0, 19);

function parseJson(value, fallback) {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { return fallback; }
}

class DemoError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}
const fail = (status, message, details) => { throw new DemoError(status, message, details); };

function audit(action, entity, entityId, summary) {
  db.audit_logs.unshift({
    id: nextId('audit_logs'),
    user_id: session?.id ?? null,
    user_email: session?.email ?? null,
    action, entity, entity_id: entityId ?? null, summary,
    ip: 'browser-demo', user_agent: 'demo', created_at: now(),
  });
}

/* ------------------------------------------------------------------ */
/* Lookups                                                             */
/* ------------------------------------------------------------------ */

const sportOf = (id) => {
  const s = byId('sports', id);
  return s ? { ...s, config: parseJson(s.config_json, {}) } : null;
};
const sportByCode = (code) => {
  const s = find('sports', (x) => x.code === code);
  return s ? { ...s, config: parseJson(s.config_json, {}) } : null;
};
const resolveSport = (idOrCode) => (/^\d+$/.test(String(idOrCode)) ? sportOf(idOrCode) : sportByCode(String(idOrCode)));
const teamName = (id) => byId('teams', id)?.name ?? null;
const coachName = (id) => byId('coaches', id)?.full_name ?? null;
const seasonName = (id) => byId('seasons', id)?.name ?? null;
const tournamentName = (id) => byId('tournaments', id)?.name ?? null;
const playerOf = (id) => byId('players', id);

/* ------------------------------------------------------------------ */
/* Scope — mirrors server/src/middleware/scope.js                       */
/* ------------------------------------------------------------------ */

const GLOBAL = new Set(['super_admin', 'sports_director', 'statistician']);
const SELF = new Set(['player', 'guardian']);

function allowedTeamIds(user) {
  if (!user) return [];
  if (GLOBAL.has(user.role)) return null;
  if (user.role === 'sport_admin') return filter('teams', (t) => user.sportIds.includes(t.sport_id)).map((t) => t.id);
  if (user.role === 'coach') return user.teamIds;
  return [];
}

function allowedPlayerIds(user) {
  if (!user) return [];
  if (GLOBAL.has(user.role)) return null;
  if (SELF.has(user.role)) return user.linkedPlayerIds;
  const ids = new Set();
  const teams = allowedTeamIds(user) || [];
  filter('team_memberships', (m) => teams.includes(m.team_id)).forEach((m) => ids.add(m.player_id));
  if (user.role === 'sport_admin') {
    filter('player_sports', (ps) => user.sportIds.includes(ps.sport_id)).forEach((ps) => ids.add(ps.player_id));
  }
  return [...ids];
}

const inScope = (ids, id) => ids === null || ids.includes(Number(id));

function requireAuth() {
  if (!session) fail(401, 'Sign in to continue.');
  return session;
}
function requirePermission(permission) {
  requireAuth();
  if (!can(session, permission)) fail(403, `Your role does not allow this action (${permission}).`);
}
function guardPlayer(id) {
  if (!inScope(allowedPlayerIds(session), id)) fail(403, 'That athlete is outside the teams and sports assigned to you.');
}

/* ------------------------------------------------------------------ */
/* Career statistics — mirrors server/src/lib/repo.js                   */
/* ------------------------------------------------------------------ */

function performancesFor(playerId, sportId) {
  return filter('match_performances', (p) => p.player_id === Number(playerId) && p.sport_id === Number(sportId))
    .map((p) => {
      const m = byId('matches', p.match_id) || {};
      return {
        ...p,
        stats: parseJson(p.stats_json, {}),
        scheduled_at: m.scheduled_at,
        venue: m.venue,
        stage: m.stage,
        result: m.result,
        tournament_id: m.tournament_id,
        tournament_name: tournamentName(m.tournament_id),
        opponent_name: m.opponent_name,
        home_team_id: m.home_team_id,
        away_team_id: m.away_team_id,
        season_id: m.season_id,
      };
    })
    .sort((a, b) => String(a.scheduled_at).localeCompare(String(b.scheduled_at)));
}

function playerCareer(playerId, sport, filters = {}) {
  let perfs = performancesFor(playerId, sport.id);
  if (filters.season) perfs = perfs.filter((p) => Number(p.season_id) === Number(filters.season));
  if (filters.tournament) perfs = perfs.filter((p) => Number(p.tournament_id) === Number(filters.tournament));
  if (filters.team) perfs = perfs.filter((p) => Number(p.team_id) === Number(filters.team));

  const career = aggregateCareer(sport.config, perfs.map((p) => p.stats));
  const rating = computeRating(sport.config, career.values);
  const headline = (sport.config.headline || [])
    .map((k) => career.entries.find((e) => e.key === k))
    .filter(Boolean);

  return {
    sport: { id: sport.id, code: sport.code, name: sport.name, color: sport.color, category: sport.category },
    matchesPlayed: perfs.length,
    career,
    headline,
    rating,
    performances: perfs.map((p) => ({
      id: p.id,
      matchId: p.match_id,
      date: p.scheduled_at,
      venue: p.venue,
      stage: p.stage,
      tournament: p.tournament_name,
      team: teamName(p.team_id),
      opponent: p.opponent_name || teamName(p.home_team_id === p.team_id ? p.away_team_id : p.home_team_id),
      result: p.result,
      isMotm: !!p.is_motm,
      rating: p.rating,
      stats: p.stats,
      computed: performanceScope(p.stats, sport.config),
      notes: p.notes,
    })),
  };
}

function careersFor(playerId, filters = {}) {
  return filter('player_sports', (ps) => ps.player_id === Number(playerId))
    .sort((a, b) => b.is_primary - a.is_primary)
    .map((ps) => sportOf(ps.sport_id))
    .filter(Boolean)
    .map((s) => playerCareer(playerId, s, filters));
}

function summaryFor(playerId) {
  const perfs = filter('match_performances', (p) => p.player_id === Number(playerId));
  const wins = perfs.filter((p) => byId('matches', p.match_id)?.result === 'win').length;
  const tournaments = new Set(perfs.map((p) => byId('matches', p.match_id)?.tournament_id).filter(Boolean));
  const attendance = filter('training_attendance', (a) => a.player_id === Number(playerId));
  const attended = attendance.filter((a) => a.status === 'present' || a.status === 'late').length;
  const rated = careersFor(playerId).filter((c) => c.rating && c.matchesPlayed > 0);

  return {
    matches: perfs.length,
    wins,
    winRate: perfs.length ? Math.round((wins / perfs.length) * 1000) / 10 : 0,
    awards: filter('achievements', (a) => a.player_id === Number(playerId)).length,
    tournaments: tournaments.size,
    sports: filter('player_sports', (ps) => ps.player_id === Number(playerId)).length,
    motm: filter('matches', (m) => m.player_of_match_id === Number(playerId)).length,
    trainingAttended: attended,
    trainingSessions: attendance.length,
    attendanceRate: attendance.length ? Math.round((attended / attendance.length) * 1000) / 10 : 0,
    rating: rated.length ? Math.round((rated.reduce((a, c) => a + c.rating.overall, 0) / rated.length) * 10) / 10 : null,
  };
}

/* ------------------------------------------------------------------ */
/* Timeline                                                            */
/* ------------------------------------------------------------------ */

function addTimeline(e) {
  const dup = find('player_timeline', (t) => t.is_system && t.player_id === e.player_id
    && t.event_type === e.event_type && t.ref_table === e.ref_table && Number(t.ref_id) === Number(e.ref_id));
  if (dup) return;
  db.player_timeline.push({
    id: nextId('player_timeline'),
    description: null, sport_id: null, ref_table: null, ref_id: null,
    importance: 2, is_system: 1, created_by: session?.id ?? null, created_at: now(),
    ...e,
  });
}

/* ------------------------------------------------------------------ */
/* Enrichment helpers used by list endpoints                            */
/* ------------------------------------------------------------------ */

function playerRow(p) {
  const sports = filter('player_sports', (ps) => ps.player_id === p.id)
    .map((ps) => {
      const s = byId('sports', ps.sport_id);
      return { ...ps, sport_name: s?.name, sport_code: s?.code, color: s?.color, category: s?.category };
    })
    .sort((a, b) => b.is_primary - a.is_primary);
  const teams = filter('team_memberships', (m) => m.player_id === p.id && !m.end_date)
    .map((m) => {
      const t = byId('teams', m.team_id);
      return t ? { id: t.id, name: t.name, age_group: t.age_group } : null;
    })
    .filter(Boolean);
  return { ...redactPlayer(p, session), sports, teams };
}

function teamRow(t) {
  const s = byId('sports', t.sport_id);
  return {
    ...t,
    sport_name: s?.name, sport_code: s?.code, color: s?.color,
    season_name: seasonName(t.season_id),
    coach_name: coachName(t.head_coach_id),
    squad_size: filter('team_memberships', (m) => m.team_id === t.id && !m.end_date).length,
    match_count: filter('matches', (m) => m.home_team_id === t.id || m.away_team_id === t.id).length,
  };
}

function matchRow(m) {
  const s = byId('sports', m.sport_id);
  return {
    ...m,
    sport_name: s?.name, sport_code: s?.code, color: s?.color,
    tournament_name: tournamentName(m.tournament_id),
    home_team_name: teamName(m.home_team_id),
    away_team_name: teamName(m.away_team_id),
    season_name: seasonName(m.season_id),
    performance_count: filter('match_performances', (p) => p.match_id === m.id).length,
  };
}

function sessionRow(t) {
  const attendance = filter('training_attendance', (a) => a.session_id === t.id);
  const s = byId('sports', t.sport_id);
  return {
    ...t,
    sport_name: s?.name, color: s?.color,
    team_name: teamName(t.team_id),
    coach_name: coachName(t.coach_id),
    invited: attendance.length,
    attended: attendance.filter((a) => a.status === 'present' || a.status === 'late').length,
    exercises: parseJson(t.exercises_json, []),
    skills: parseJson(t.skills_json, []),
  };
}

function profileFor(user) {
  return {
    id: user.id,
    email: user.email,
    fullName: user.full_name,
    role: user.role,
    roleName: user.role_name,
    avatarUrl: user.avatar_url,
    mustChangePassword: !!user.must_change_password,
    permissions: permissionsFor(user.role),
    sportIds: user.sportIds,
    teamIds: user.teamIds,
    linkedPlayerIds: user.linkedPlayerIds,
    coachId: user.coachId,
  };
}

function hydrateUser(row) {
  const role = byId('roles', row.role_id);
  return {
    ...row,
    role: role?.key,
    role_name: role?.name,
    sportIds: filter('user_sport_scopes', (s) => s.user_id === row.id).map((s) => s.sport_id),
    teamIds: filter('user_team_scopes', (s) => s.user_id === row.id).map((s) => s.team_id),
    linkedPlayerIds: filter('user_player_links', (s) => s.user_id === row.id).map((s) => s.player_id),
    coachId: find('coaches', (c) => c.user_id === row.id)?.id ?? null,
  };
}

/* ------------------------------------------------------------------ */
/* Leaderboards                                                        */
/* ------------------------------------------------------------------ */

function leaderboards(sport, perfRows, limit = 10) {
  const grouped = new Map();
  for (const r of perfRows) {
    if (!grouped.has(r.player_id)) grouped.set(r.player_id, []);
    grouped.get(r.player_id).push(parseJson(r.stats_json, {}));
  }
  const people = [...grouped.entries()].map(([playerId, stats]) => {
    const p = playerOf(playerId) || {};
    return {
      playerId,
      athleteId: p.athlete_id,
      name: p.display_name || `${p.first_name} ${p.last_name}`,
      photoUrl: p.photo_url,
      career: aggregateCareer(sport.config, stats).values,
    };
  });

  return (sport.config.leaderboards || []).map((board) => {
    const entries = people
      .filter((p) => !board.qualifier || (p.career[board.qualifier.metric] || 0) >= board.qualifier.min)
      .map((p) => ({
        playerId: p.playerId,
        athleteId: p.athleteId,
        name: p.name,
        photoUrl: p.photoUrl,
        value: Number(p.career[board.metric]) || 0,
        display: formatStat(p.career[board.metric], board.format),
      }))
      .filter((e) => e.value > 0)
      .sort((a, b) => (board.order === 'asc' ? a.value - b.value : b.value - a.value))
      .slice(0, limit)
      .map((e, i) => ({ ...e, rank: i + 1 }));
    return {
      key: board.key,
      label: board.label,
      metric: board.metric,
      qualifier: board.qualifier ? `Minimum ${board.qualifier.min} ${board.qualifier.metric.replace(/_/g, ' ')}` : null,
      entries,
    };
  }).filter((b) => b.entries.length);
}

/* ------------------------------------------------------------------ */
/* Routes                                                             */
/* ------------------------------------------------------------------ */

const ROUTES = [];
const route = (method, pattern, handler) => ROUTES.push({ method, pattern, handler });

/* ---- Auth ---- */
route('POST', /^\/auth\/login$/, (_, body) => {
  const row = find('users', (u) => u.email.toLowerCase() === String(body.email || '').toLowerCase());
  if (!row || body.password !== passwordFor(row.id)) {
    audit('login_failed', 'users', null, `Failed sign-in for ${body.email}`);
    fail(401, 'Email or password is incorrect.');
  }
  session = hydrateUser(row);
  session.last_login_at = now();
  audit('login', 'users', row.id, `${row.email} signed in`);
  return { token: `demo.${row.id}`, user: profileFor(session) };
});

route('GET', /^\/auth\/me$/, () => ({ user: profileFor(requireAuth()) }));
route('GET', /^\/auth\/roles$/, () => ({ roles: ROLES.map((r) => ({ ...r, permissions: permissionsFor(r.key) })) }));
route('POST', /^\/auth\/change-password$/, (_, body) => {
  const user = requireAuth();
  if (body.currentPassword !== passwordFor(user.id)) fail(400, 'Current password is incorrect.');
  if (!body.newPassword || body.newPassword.length < 8) fail(422, 'Use at least 8 characters.');
  passwords[user.id] = body.newPassword;
  const row = byId('users', user.id);
  if (row) row.must_change_password = 0;
  session.must_change_password = 0;
  audit('update', 'users', user.id, 'Password changed');
  return { ok: true };
});
route('POST', /^\/auth\/logout$/, () => { session = null; return { ok: true }; });

/* ---- Dashboard ---- */
route('GET', /^\/dashboard$/, () => {
  requireAuth();
  const completed = filter('matches', (m) => m.status === 'completed');
  const attendance = all('training_attendance');
  const attended = attendance.filter((a) => a.status === 'present' || a.status === 'late').length;

  const byStatusMap = {};
  all('players').forEach((p) => { byStatusMap[p.status] = (byStatusMap[p.status] || 0) + 1; });

  const ageGroups = {};
  filter('team_memberships', (m) => !m.end_date).forEach((m) => {
    const g = byId('teams', m.team_id)?.age_group;
    if (g) ageGroups[g] = (ageGroups[g] || 0) + 1;
  });

  const months = {};
  all('players').forEach((p) => {
    const key = String(p.registration_date).slice(0, 7);
    months[key] = (months[key] || 0) + 1;
  });
  const cutoff = new Date(Date.now() - 365 * 864e5).toISOString().slice(0, 7);

  return {
    totals: {
      athletes: all('players').length,
      activeAthletes: filter('players', (p) => p.status === 'active').length,
      sports: filter('sports', (s) => s.is_active).length,
      teams: filter('teams', (t) => t.is_active).length,
      coaches: filter('coaches', (c) => c.is_active).length,
      matches: all('matches').length,
      completedMatches: completed.length,
      tournaments: all('tournaments').length,
      trainingSessions: all('training_sessions').length,
      assessments: all('assessments').length,
      achievements: all('achievements').length,
      performances: all('match_performances').length,
    },
    bySport: filter('sports', (s) => s.is_active).map((s) => ({
      id: s.id, name: s.name, code: s.code, color: s.color,
      players: filter('player_sports', (ps) => ps.sport_id === s.id).length,
      teams: filter('teams', (t) => t.sport_id === s.id).length,
      matches: filter('matches', (m) => m.sport_id === s.id).length,
    })),
    byStatus: Object.entries(byStatusMap).map(([status, count]) => ({ status, count })).sort((a, b) => b.count - a.count),
    byAgeGroup: Object.entries(ageGroups).map(([age_group, count]) => ({ age_group, count })).sort((a, b) => a.age_group.localeCompare(b.age_group)),
    recentRegistrations: [...all('players')]
      .sort((a, b) => String(b.registration_date).localeCompare(String(a.registration_date))).slice(0, 6),
    recentAchievements: [...all('achievements')]
      .sort((a, b) => String(b.awarded_date).localeCompare(String(a.awarded_date))).slice(0, 6)
      .map((a) => {
        const p = playerOf(a.player_id) || {};
        const s = byId('sports', a.sport_id);
        return { ...a, athlete_id: p.athlete_id, first_name: p.first_name, last_name: p.last_name, photo_url: p.photo_url, sport_name: s?.name, color: s?.color };
      }),
    upcomingMatches: filter('matches', (m) => m.status === 'scheduled' || m.status === 'live')
      .sort((a, b) => String(a.scheduled_at).localeCompare(String(b.scheduled_at))).slice(0, 6).map(matchRow),
    recentMatches: completed
      .sort((a, b) => String(b.scheduled_at).localeCompare(String(a.scheduled_at))).slice(0, 6)
      .map((m) => {
        const motm = playerOf(m.player_of_match_id);
        return { ...matchRow(m), motm_name: motm ? `${motm.first_name} ${motm.last_name}` : null };
      }),
    upcomingTraining: filter('training_sessions', (t) => t.session_date >= today())
      .sort((a, b) => String(a.session_date).localeCompare(String(b.session_date))).slice(0, 5).map(sessionRow),
    registrationTrend: Object.entries(months).filter(([m]) => m >= cutoff)
      .map(([month, count]) => ({ month, count })).sort((a, b) => a.month.localeCompare(b.month)),
    attendanceRate: attendance.length ? Math.round((attended / attendance.length) * 1000) / 10 : 0,
    demoDataPresent: true,
  };
});

/* ---- Search ---- */
route('GET', /^\/search$/, (_, __, query) => {
  requireAuth();
  const q = String(query.q || '').trim().toLowerCase();
  if (q.length < 2) return { players: [], teams: [], tournaments: [], matches: [], coaches: [] };
  const scope = allowedPlayerIds(session);
  const has = (v) => String(v || '').toLowerCase().includes(q);

  return {
    players: filter('players', (p) => inScope(scope, p.id)
      && (has(p.first_name) || has(p.last_name) || has(p.display_name) || has(p.athlete_id))).slice(0, 8),
    teams: filter('teams', (t) => has(t.name)).slice(0, 5)
      .map((t) => ({ id: t.id, name: t.name, age_group: t.age_group, sport_name: byId('sports', t.sport_id)?.name })),
    tournaments: filter('tournaments', (t) => has(t.name)).slice(0, 5)
      .map((t) => ({ id: t.id, name: t.name, status: t.status, sport_name: byId('sports', t.sport_id)?.name })),
    matches: filter('matches', (m) => has(m.venue) || has(m.opponent_name)
      || has(teamName(m.home_team_id)) || has(teamName(m.away_team_id))).slice(0, 5).map(matchRow),
    coaches: filter('coaches', (c) => has(c.full_name)).slice(0, 5)
      .map((c) => ({ id: c.id, full_name: c.full_name, role: c.role })),
  };
});

/* ---- Sports & seasons ---- */
route('GET', /^\/sports$/, (_, __, query) => {
  requireAuth();
  let rows = all('sports');
  if (query.active === 'true') rows = rows.filter((s) => s.is_active);
  return {
    sports: rows.sort((a, b) => a.sort_order - b.sort_order).map((s) => ({
      ...s,
      config: parseJson(s.config_json, {}),
      config_json: undefined,
      counts: {
        players: filter('player_sports', (ps) => ps.sport_id === s.id).length,
        teams: filter('teams', (t) => t.sport_id === s.id).length,
        matches: filter('matches', (m) => m.sport_id === s.id).length,
      },
    })),
  };
});

route('GET', /^\/sports\/meta\/seasons$/, () => {
  requireAuth();
  return {
    seasons: [...all('seasons')]
      .sort((a, b) => String(b.start_date).localeCompare(String(a.start_date)))
      .map((s) => ({ ...s, sport_name: byId('sports', s.sport_id)?.name ?? null })),
  };
});

route('POST', /^\/sports\/meta\/seasons$/, (_, body) => {
  requirePermission('seasons.write');
  if (body.end_date < body.start_date) fail(422, 'The season cannot end before it starts.');
  const season = { id: nextId('seasons'), is_current: 0, created_at: now(), ...body };
  db.seasons.push(season);
  audit('create', 'seasons', season.id, `Season added: ${season.name}`);
  return { season };
});

route('GET', /^\/sports\/([^/]+)$/, (m) => {
  requireAuth();
  const sport = resolveSport(m[1]);
  if (!sport) fail(404, 'That sport does not exist.');
  return { sport: { ...sport, config_json: undefined } };
});

/* ---- Players ---- */
route('GET', /^\/players$/, (_, __, query) => {
  requireAuth();
  const scope = allowedPlayerIds(session);
  const q = String(query.q || '').toLowerCase();

  let rows = filter('players', (p) => {
    if (!inScope(scope, p.id)) return false;
    if (q && ![p.first_name, p.last_name, p.display_name, p.athlete_id]
      .some((v) => String(v || '').toLowerCase().includes(q))) return false;
    if (query.status && p.status !== query.status) return false;
    if (query.gender && p.gender !== query.gender) return false;
    if (query.nationality && p.nationality !== query.nationality) return false;
    if (query.sport && !find('player_sports', (ps) => ps.player_id === p.id && ps.sport_id === Number(query.sport))) return false;
    if (query.position && !find('player_sports', (ps) => ps.player_id === p.id && ps.position === query.position)) return false;
    if (query.level && !find('player_sports', (ps) => ps.player_id === p.id && ps.playing_level === query.level)) return false;
    if (query.team && !find('team_memberships', (tm) => tm.player_id === p.id && tm.team_id === Number(query.team) && !tm.end_date)) return false;
    if (query.ageGroup && !find('team_memberships', (tm) => tm.player_id === p.id && byId('teams', tm.team_id)?.age_group === query.ageGroup)) return false;
    if (query.season && !find('team_memberships', (tm) => tm.player_id === p.id && byId('teams', tm.team_id)?.season_id === Number(query.season))) return false;
    if (query.coach && !find('team_memberships', (tm) => tm.player_id === p.id && !tm.end_date
      && byId('teams', tm.team_id)?.head_coach_id === Number(query.coach))) return false;
    return true;
  });

  const sorters = {
    name: (a, b) => `${a.last_name}${a.first_name}`.localeCompare(`${b.last_name}${b.first_name}`),
    athlete_id: (a, b) => String(a.athlete_id).localeCompare(String(b.athlete_id)),
    registered: (a, b) => String(a.registration_date).localeCompare(String(b.registration_date)),
    status: (a, b) => String(a.status).localeCompare(String(b.status)),
    dob: (a, b) => String(a.dob).localeCompare(String(b.dob)),
  };
  rows.sort(sorters[query.sort] || sorters.name);
  if (String(query.dir).toLowerCase() === 'desc') rows.reverse();

  const pageSize = Math.min(Number(query.pageSize) || 25, 200);
  const page = Math.max(Number(query.page) || 1, 1);
  const total = rows.length;

  return {
    players: rows.slice((page - 1) * pageSize, page * pageSize).map(playerRow),
    total, page, pageSize, pages: Math.ceil(total / pageSize) || 1,
  };
});

route('GET', /^\/players\/filters\/options$/, () => {
  requireAuth();
  const uniq = (arr) => [...new Set(arr.filter(Boolean))].sort();
  return {
    statuses: uniq(all('players').map((p) => p.status)),
    nationalities: uniq(all('players').map((p) => p.nationality)),
    ageGroups: uniq(all('teams').map((t) => t.age_group)),
    positions: uniq(all('player_sports').map((p) => p.position)),
    levels: ['academy', 'development', 'senior', 'representative', 'recreational'],
  };
});

route('POST', /^\/players$/, (_, body) => {
  requirePermission('players.write');
  if (body.dob && new Date(body.dob) > new Date()) fail(422, 'Date of birth cannot be in the future.');
  const dup = find('players', (p) => p.first_name.toLowerCase() === String(body.first_name).toLowerCase()
    && p.last_name.toLowerCase() === String(body.last_name).toLowerCase()
    && String(p.dob || '') === String(body.dob || ''));
  if (dup) {
    fail(409, `${body.first_name} ${body.last_name} is already registered as ${dup.athlete_id}. Add the new sport to that record instead of creating a second one.`);
  }
  const id = nextId('players');
  const seq = all('players').reduce((m, p) => {
    const n = Number(String(p.athlete_id).split('-').pop());
    return Number.isFinite(n) ? Math.max(m, n) : m;
  }, 0) + 1;
  const player = {
    id,
    athlete_id: `KSC-PLY-${String(seq).padStart(6, '0')}`,
    registration_date: body.registration_date || today(),
    status: 'active', visibility: 'club', is_demo: 0,
    created_by: session.id, created_at: now(), updated_at: now(),
    ...body,
  };
  db.players.push(player);
  db.player_status_history.push({
    id: nextId('player_status_history'), player_id: id, status: player.status,
    effective_from: player.registration_date, effective_to: null,
    reason: 'Initial registration', changed_by: session.id, created_at: now(),
  });
  addTimeline({
    player_id: id, event_date: player.registration_date, event_type: 'registration',
    title: 'Registered with Karwan Sports Club',
    description: `Athlete ID ${player.athlete_id} issued.`,
    importance: 3, ref_table: 'players', ref_id: id,
  });
  audit('create', 'players', id, `Athlete registered: ${player.athlete_id} ${player.first_name} ${player.last_name}`);
  return { player };
});

route('PUT', /^\/players\/(\d+)$/, (m, body) => {
  requirePermission('players.write');
  const player = playerOf(m[1]);
  if (!player) fail(404, 'That athlete record does not exist.');
  guardPlayer(player.id);

  if (body.status && body.status !== player.status) {
    const open = find('player_status_history', (h) => h.player_id === player.id && !h.effective_to);
    if (open) open.effective_to = today();
    db.player_status_history.push({
      id: nextId('player_status_history'), player_id: player.id, status: body.status,
      effective_from: today(), effective_to: null, reason: body.status_reason || null,
      changed_by: session.id, created_at: now(),
    });
    addTimeline({
      player_id: player.id, event_date: today(), event_type: 'status_change',
      title: `Status changed to ${String(body.status).replace('_', ' ')}`,
      description: body.status_reason || null,
      ref_table: 'player_status_history', ref_id: nextId('player_status_history'),
    });
  }
  delete body.status_reason;
  Object.assign(player, body, { updated_at: now() });
  audit('update', 'players', player.id, `Athlete updated: ${player.athlete_id}`);
  return { player };
});

route('GET', /^\/players\/(\d+)$/, (m) => {
  requireAuth();
  const player = playerOf(m[1]);
  if (!player) fail(404, 'That athlete record does not exist.');
  guardPlayer(player.id);

  return {
    player: redactPlayer(player, session),
    sports: filter('player_sports', (ps) => ps.player_id === player.id).map((ps) => {
      const s = byId('sports', ps.sport_id);
      return { ...ps, sport_name: s?.name, sport_code: s?.code, color: s?.color, category: s?.category };
    }).sort((a, b) => b.is_primary - a.is_primary),
    teamHistory: filter('team_memberships', (tm) => tm.player_id === player.id).map((tm) => {
      const t = byId('teams', tm.team_id) || {};
      const s = byId('sports', t.sport_id);
      return {
        ...tm, team_name: t.name, age_group: t.age_group, level: t.level, sport_id: t.sport_id,
        sport_name: s?.name, color: s?.color, season_name: seasonName(t.season_id), coach_name: coachName(t.head_coach_id),
      };
    }).sort((a, b) => String(b.start_date).localeCompare(String(a.start_date))),
    achievements: filter('achievements', (a) => a.player_id === player.id).map((a) => ({
      ...a, sport_name: byId('sports', a.sport_id)?.name, tournament_name: tournamentName(a.tournament_id),
    })).sort((a, b) => String(b.awarded_date).localeCompare(String(a.awarded_date))),
    statusHistory: filter('player_status_history', (h) => h.player_id === player.id)
      .sort((a, b) => String(b.effective_from).localeCompare(String(a.effective_from))),
    attributeHistory: filter('player_attribute_history', (h) => h.player_id === player.id)
      .map((h) => ({ ...h, sport_name: byId('sports', h.sport_id)?.name }))
      .sort((a, b) => String(b.effective_date).localeCompare(String(a.effective_date))),
    staff: filter('player_staff', (ps) => ps.player_id === player.id).map((ps) => {
      const c = byId('coaches', ps.coach_id) || {};
      const sp = byId('sports', ps.sport_id);
      return {
        ...ps, coach_name: c.full_name, coach_role: c.role, qualification: c.qualification,
        photo_url: c.photo_url, sport_name: sp?.name, color: sp?.color,
      };
    }).sort((a, b) => (!!a.end_date - !!b.end_date) || String(b.start_date).localeCompare(String(a.start_date))),
    media: filter('media', (x) => x.player_id === player.id),
    documents: can(session, 'documents.read') ? filter('documents', (d) => d.player_id === player.id) : [],
    summary: summaryFor(player.id),
  };
});

route('GET', /^\/players\/(\d+)\/stats$/, (m, __, query) => {
  requireAuth();
  guardPlayer(m[1]);
  if (query.sport) {
    const sport = resolveSport(query.sport);
    if (!sport) fail(404, 'That sport does not exist.');
    return { careers: [playerCareer(Number(m[1]), sport, query)] };
  }
  return { careers: careersFor(Number(m[1]), query) };
});

route('GET', /^\/players\/(\d+)\/timeline$/, (m) => {
  requireAuth();
  guardPlayer(m[1]);
  return {
    events: filter('player_timeline', (t) => t.player_id === Number(m[1]))
      .map((t) => ({ ...t, sport_name: byId('sports', t.sport_id)?.name, color: byId('sports', t.sport_id)?.color }))
      .sort((a, b) => String(b.event_date).localeCompare(String(a.event_date)) || b.id - a.id),
  };
});

route('POST', /^\/players\/(\d+)\/timeline$/, (m, body) => {
  requirePermission('players.write');
  guardPlayer(m[1]);
  db.player_timeline.push({
    id: nextId('player_timeline'), player_id: Number(m[1]),
    is_system: 0, created_by: session.id, created_at: now(),
    ref_table: null, ref_id: null, ...body,
  });
  audit('create', 'player_timeline', Number(m[1]), 'Timeline entry added');
  return { ok: true };
});

route('GET', /^\/players\/(\d+)\/activity$/, (m, __, query) => {
  requireAuth();
  guardPlayer(m[1]);
  const id = Number(m[1]);
  const limit = Math.min(Number(query.limit) || 5, 25);

  return {
    matches: filter('match_performances', (p) => p.player_id === id).map((p) => {
      const match = byId('matches', p.match_id) || {};
      const s = byId('sports', match.sport_id);
      return {
        ...match, stats: parseJson(p.stats_json, {}), rating: p.rating, is_motm: p.is_motm,
        sport_name: s?.name, color: s?.color, tournament_name: tournamentName(match.tournament_id),
        home_team_name: teamName(match.home_team_id), away_team_name: teamName(match.away_team_id),
      };
    }).sort((a, b) => String(b.scheduled_at).localeCompare(String(a.scheduled_at))).slice(0, limit),

    training: filter('training_attendance', (a) => a.player_id === id).map((a) => {
      const s = byId('training_sessions', a.session_id) || {};
      return {
        ...s, status: a.status, performance_score: a.performance_score, coach_notes: a.coach_notes,
        sport_name: byId('sports', s.sport_id)?.name, team_name: teamName(s.team_id),
      };
    }).sort((a, b) => String(b.session_date).localeCompare(String(a.session_date))).slice(0, limit),

    assessments: filter('assessments', (a) => a.player_id === id).map((a) => ({
      ...a, sport_name: byId('sports', a.sport_id)?.name, coach_name: coachName(a.assessed_by),
    })).sort((a, b) => String(b.assessment_date).localeCompare(String(a.assessment_date))).slice(0, limit),

    achievements: filter('achievements', (a) => a.player_id === id)
      .sort((a, b) => String(b.awarded_date).localeCompare(String(a.awarded_date))).slice(0, limit),
  };
});

route('POST', /^\/players\/(\d+)\/sports$/, (m, body) => {
  requirePermission('players.write');
  const player = playerOf(m[1]);
  guardPlayer(player.id);
  const sport = sportOf(body.sport_id);
  if (!sport) fail(404, 'That sport does not exist.');
  if (find('player_sports', (ps) => ps.player_id === player.id && ps.sport_id === sport.id)) {
    fail(409, `${player.display_name || player.first_name} is already registered for ${sport.name}.`);
  }
  if (body.is_primary) filter('player_sports', (ps) => ps.player_id === player.id).forEach((ps) => { ps.is_primary = 0; });
  const row = {
    id: nextId('player_sports'), player_id: player.id, status: 'active',
    joined_date: body.joined_date || today(), created_at: now(), updated_at: now(), ...body,
  };
  db.player_sports.push(row);
  addTimeline({
    player_id: player.id, event_date: row.joined_date, event_type: 'sport_added',
    title: `Registered for ${sport.name}`,
    description: body.position ? `Position: ${body.position}` : null,
    sport_id: sport.id, ref_table: 'player_sports', ref_id: sport.id, importance: 3,
  });
  audit('create', 'player_sports', player.id, `${player.athlete_id} registered for ${sport.name}`);
  return { ok: true };
});

route('PUT', /^\/players\/(\d+)\/sports\/(\d+)$/, (m, body) => {
  requirePermission('players.write');
  guardPlayer(m[1]);
  const row = find('player_sports', (ps) => ps.player_id === Number(m[1]) && ps.sport_id === Number(m[2]));
  if (!row) fail(404, 'That athlete is not registered for this sport.');

  for (const field of ['position', 'playing_level', 'jersey_number']) {
    if (field in body && String(body[field] ?? '') !== String(row[field] ?? '')) {
      db.player_attribute_history.push({
        id: nextId('player_attribute_history'), player_id: row.player_id, sport_id: row.sport_id,
        attribute: field, old_value: row[field] ?? null, new_value: body[field] ?? null,
        effective_date: today(), changed_by: session.id, note: body.change_note || null, created_at: now(),
      });
    }
  }
  if (body.is_primary) filter('player_sports', (ps) => ps.player_id === row.player_id).forEach((ps) => { ps.is_primary = 0; });
  Object.assign(row, body, { updated_at: now() });
  audit('update', 'player_sports', row.id, 'Sport profile updated');
  return { ok: true };
});

route('POST', /^\/players\/(\d+)\/staff$/, (m, body) => {
  requirePermission('players.write');
  const player = playerOf(m[1]);
  if (!player) fail(404, 'That athlete record does not exist.');
  guardPlayer(player.id);
  const coach = byId('coaches', body.coach_id);
  if (!coach) fail(404, 'That staff member does not exist.');
  const role = body.role || 'coach';
  if (find('player_staff', (x) => x.player_id === player.id && x.coach_id === coach.id && x.role === role && !x.end_date)) {
    fail(409, `${coach.full_name} is already assigned to this athlete as ${role.replace('_', ' ')}.`);
  }
  const row = {
    id: nextId('player_staff'), player_id: player.id, coach_id: coach.id,
    sport_id: body.sport_id ?? coach.sport_id ?? null, role,
    start_date: body.start_date || today(), end_date: null,
    notes: body.notes ?? null, created_by: session.id, created_at: now(),
  };
  if (!db.player_staff) db.player_staff = [];
  db.player_staff.push(row);
  addTimeline({
    player_id: player.id, event_date: row.start_date, event_type: 'note',
    title: `${coach.full_name} assigned as ${role.replace('_', ' ')}`,
    sport_id: row.sport_id, ref_table: 'player_staff', ref_id: row.id,
  });
  audit('create', 'player_staff', row.id, `${coach.full_name} assigned to ${player.athlete_id}`);
  return { ok: true };
});

route('PUT', /^\/players\/(\d+)\/staff\/(\d+)$/, (m, body) => {
  requirePermission('players.write');
  guardPlayer(m[1]);
  const row = find('player_staff', (x) => x.id === Number(m[2]) && x.player_id === Number(m[1]));
  if (!row) fail(404, 'That assignment does not exist.');
  if (body.end_date && body.end_date < row.start_date) fail(422, 'An assignment cannot end before it started.');
  Object.assign(row, body);
  audit('update', 'player_staff', row.id, 'Staff assignment updated');
  return { ok: true };
});

/* ---- Teams ---- */
route('GET', /^\/teams$/, (_, __, query) => {
  requireAuth();
  const scope = allowedTeamIds(session);
  return {
    teams: filter('teams', (t) => {
      if (!inScope(scope, t.id)) return false;
      if (query.sport && t.sport_id !== Number(query.sport)) return false;
      if (query.season && t.season_id !== Number(query.season)) return false;
      if (query.ageGroup && t.age_group !== query.ageGroup) return false;
      if (query.level && t.level !== query.level) return false;
      if (query.active === 'true' && !t.is_active) return false;
      if (query.q && !t.name.toLowerCase().includes(String(query.q).toLowerCase())) return false;
      return true;
    }).map(teamRow),
  };
});

route('POST', /^\/teams$/, (_, body) => {
  requirePermission('teams.write');
  const team = { id: nextId('teams'), is_active: 1, is_demo: 0, created_at: now(), updated_at: now(), ...body };
  db.teams.push(team);
  audit('create', 'teams', team.id, `Team created: ${team.name}`);
  return { team };
});

route('PUT', /^\/teams\/(\d+)$/, (m, body) => {
  requirePermission('teams.write');
  const team = byId('teams', m[1]);
  if (!team) fail(404, 'That team does not exist.');
  Object.assign(team, body, { updated_at: now() });
  audit('update', 'teams', team.id, `Team updated: ${team.name}`);
  return { team };
});

route('GET', /^\/teams\/(\d+)$/, (m) => {
  requireAuth();
  const team = byId('teams', m[1]);
  if (!team) fail(404, 'That team does not exist.');
  if (!inScope(allowedTeamIds(session), team.id)) fail(403, 'That team is not assigned to you.');

  const roster = filter('team_memberships', (tm) => tm.team_id === team.id).map((tm) => {
    const p = playerOf(tm.player_id) || {};
    const ps = find('player_sports', (x) => x.player_id === tm.player_id && x.sport_id === team.sport_id);
    return {
      ...tm, athlete_id: p.athlete_id, first_name: p.first_name, last_name: p.last_name,
      display_name: p.display_name, photo_url: p.photo_url, player_status: p.status,
      position: ps?.position, playing_role: ps?.playing_role,
    };
  }).sort((a, b) => (!!a.end_date - !!b.end_date) || String(a.last_name).localeCompare(String(b.last_name)));

  const matches = filter('matches', (x) => x.home_team_id === team.id || x.away_team_id === team.id)
    .map(matchRow).sort((a, b) => String(b.scheduled_at).localeCompare(String(a.scheduled_at)));

  const record = { played: matches.filter((x) => x.status === 'completed').length };
  record.won = matches.filter((x) => x.status === 'completed' && x.winner_team_id === team.id).length;
  record.lost = matches.filter((x) => x.status === 'completed' && x.winner_team_id && x.winner_team_id !== team.id).length;
  record.drawn = record.played - record.won - record.lost;

  return {
    team: {
      ...team,
      sport_name: byId('sports', team.sport_id)?.name,
      sport_code: byId('sports', team.sport_id)?.code,
      color: byId('sports', team.sport_id)?.color,
      season_name: seasonName(team.season_id),
      coach_name: coachName(team.head_coach_id),
    },
    roster,
    matches,
    training: filter('training_sessions', (t) => t.team_id === team.id).map(sessionRow)
      .sort((a, b) => String(b.session_date).localeCompare(String(a.session_date))).slice(0, 20),
    record,
  };
});

route('POST', /^\/teams\/(\d+)\/members$/, (m, body) => {
  requirePermission('teams.write');
  const team = byId('teams', m[1]);
  if (!team) fail(404, 'That team does not exist.');
  const player = playerOf(body.player_id);
  if (!player) fail(404, 'That athlete does not exist.');
  if (find('team_memberships', (x) => x.team_id === team.id && x.player_id === player.id && !x.end_date)) {
    fail(409, `${player.first_name} ${player.last_name} is already on this roster.`);
  }
  if (body.jersey_number != null) {
    const clash = find('team_memberships', (x) => x.team_id === team.id && !x.end_date && x.jersey_number === Number(body.jersey_number));
    if (clash) {
      const other = playerOf(clash.player_id);
      fail(409, `Jersey ${body.jersey_number} is already worn by ${other.first_name} ${other.last_name}.`);
    }
  }
  if (!find('player_sports', (ps) => ps.player_id === player.id && ps.sport_id === team.sport_id)) {
    db.player_sports.push({
      id: nextId('player_sports'), player_id: player.id, sport_id: team.sport_id,
      is_primary: filter('player_sports', (ps) => ps.player_id === player.id).length === 0 ? 1 : 0,
      joined_date: body.start_date || today(), status: 'active', created_at: now(), updated_at: now(),
    });
  }
  const row = {
    id: nextId('team_memberships'), team_id: team.id, player_id: player.id,
    role: body.role || 'player', jersey_number: body.jersey_number ?? null,
    start_date: body.start_date || today(), end_date: null, status: 'active',
    notes: body.notes ?? null, created_at: now(),
  };
  db.team_memberships.push(row);
  addTimeline({
    player_id: player.id, event_date: row.start_date, event_type: 'team_joined',
    title: `Joined ${team.name}`, sport_id: team.sport_id,
    ref_table: 'team_memberships', ref_id: row.id, importance: 3,
  });
  audit('create', 'team_memberships', row.id, `${player.athlete_id} added to ${team.name}`);
  return { ok: true };
});

route('PUT', /^\/teams\/(\d+)\/members\/(\d+)$/, (m, body) => {
  requirePermission('teams.write');
  const row = find('team_memberships', (x) => x.id === Number(m[2]) && x.team_id === Number(m[1]));
  if (!row) fail(404, 'That roster entry does not exist.');
  if (body.end_date && body.end_date < row.start_date) fail(422, 'A membership cannot end before it started.');
  const team = byId('teams', row.team_id);
  const wasOpen = !row.end_date;
  Object.assign(row, body);
  if (body.end_date && wasOpen) {
    addTimeline({
      player_id: row.player_id, event_date: body.end_date,
      event_type: body.status === 'promoted' ? 'promotion' : 'team_left',
      title: body.status === 'promoted' ? `Promoted from ${team.name}` : `Left ${team.name}`,
      sport_id: team.sport_id, ref_table: 'team_memberships_end', ref_id: row.id,
    });
  }
  audit('update', 'team_memberships', row.id, `Roster updated for ${team.name}`);
  return { ok: true };
});

/* ---- Coaches ---- */
route('GET', /^\/coaches$/, (_, __, query) => {
  requireAuth();
  return {
    coaches: filter('coaches', (c) => {
      if (query.sport && c.sport_id !== Number(query.sport)) return false;
      if (query.active === 'true' && !c.is_active) return false;
      if (query.q && !c.full_name.toLowerCase().includes(String(query.q).toLowerCase())) return false;
      return true;
    }).map((c) => ({
      ...c,
      sport_name: byId('sports', c.sport_id)?.name,
      color: byId('sports', c.sport_id)?.color,
      team_count: filter('teams', (t) => t.head_coach_id === c.id).length,
      session_count: filter('training_sessions', (t) => t.coach_id === c.id).length,
    })).sort((a, b) => a.full_name.localeCompare(b.full_name)),
  };
});

route('POST', /^\/coaches$/, (_, body) => {
  requirePermission('coaches.write');
  const coach = { id: nextId('coaches'), is_active: 1, is_demo: 0, created_at: now(), updated_at: now(), ...body };
  db.coaches.push(coach);
  audit('create', 'coaches', coach.id, `Coach added: ${coach.full_name}`);
  return { coach };
});

route('PUT', /^\/coaches\/(\d+)$/, (m, body) => {
  requirePermission('coaches.write');
  const coach = byId('coaches', m[1]);
  if (!coach) fail(404, 'That coach does not exist.');
  Object.assign(coach, body, { updated_at: now() });
  audit('update', 'coaches', coach.id, `Coach updated: ${coach.full_name}`);
  return { coach };
});

route('GET', /^\/coaches\/(\d+)$/, (m) => {
  requireAuth();
  const coach = byId('coaches', m[1]);
  if (!coach) fail(404, 'That coach does not exist.');
  const teams = filter('teams', (t) => t.head_coach_id === coach.id)
    .map((t) => ({ ...t, sport_name: byId('sports', t.sport_id)?.name }));
  const players = new Set();
  teams.forEach((t) => filter('team_memberships', (x) => x.team_id === t.id && !x.end_date).forEach((x) => players.add(x.player_id)));
  return {
    coach: { ...coach, sport_name: byId('sports', coach.sport_id)?.name },
    teams,
    sessions: filter('training_sessions', (t) => t.coach_id === coach.id)
      .map((t) => ({ ...t, team_name: teamName(t.team_id) }))
      .sort((a, b) => String(b.session_date).localeCompare(String(a.session_date))).slice(0, 20),
    assessments: filter('assessments', (a) => a.assessed_by === coach.id).map((a) => {
      const p = playerOf(a.player_id) || {};
      return { ...a, athlete_id: p.athlete_id, first_name: p.first_name, last_name: p.last_name };
    }).sort((a, b) => String(b.assessment_date).localeCompare(String(a.assessment_date))).slice(0, 20),
    playerCount: players.size,
  };
});

/* ---- Tournaments ---- */
route('GET', /^\/tournaments$/, (_, __, query) => {
  requireAuth();
  return {
    tournaments: filter('tournaments', (t) => {
      if (query.sport && t.sport_id !== Number(query.sport)) return false;
      if (query.season && t.season_id !== Number(query.season)) return false;
      if (query.status && t.status !== query.status) return false;
      if (query.q && !t.name.toLowerCase().includes(String(query.q).toLowerCase())) return false;
      return true;
    }).map((t) => ({
      ...t,
      sport_name: byId('sports', t.sport_id)?.name,
      color: byId('sports', t.sport_id)?.color,
      season_name: seasonName(t.season_id),
      match_count: filter('matches', (m) => m.tournament_id === t.id).length,
      team_count: filter('tournament_teams', (x) => x.tournament_id === t.id).length,
    })).sort((a, b) => String(b.start_date).localeCompare(String(a.start_date))),
  };
});

route('POST', /^\/tournaments$/, (_, body) => {
  requirePermission('tournaments.write');
  if (body.start_date && body.end_date && body.end_date < body.start_date) {
    fail(422, 'The tournament cannot end before it starts.');
  }
  const t = { id: nextId('tournaments'), status: 'upcoming', is_demo: 0, created_at: now(), updated_at: now(), ...body };
  db.tournaments.push(t);
  audit('create', 'tournaments', t.id, `Tournament created: ${t.name}`);
  return { tournament: t };
});

route('PUT', /^\/tournaments\/(\d+)$/, (m, body) => {
  requirePermission('tournaments.write');
  const t = byId('tournaments', m[1]);
  if (!t) fail(404, 'That tournament does not exist.');
  Object.assign(t, body, { updated_at: now() });
  audit('update', 'tournaments', t.id, `Tournament updated: ${t.name}`);
  return { tournament: t };
});

route('POST', /^\/tournaments\/(\d+)\/teams$/, (m, body) => {
  requirePermission('tournaments.write');
  if (!body.team_id && !body.external_name) fail(422, 'Choose a club team or name the visiting side.');
  db.tournament_teams.push({ id: nextId('tournament_teams'), tournament_id: Number(m[1]), ...body });
  audit('create', 'tournament_teams', Number(m[1]), 'Team entered into tournament');
  return { ok: true };
});

route('GET', /^\/tournaments\/(\d+)$/, (m) => {
  requireAuth();
  const t = byId('tournaments', m[1]);
  if (!t) fail(404, 'That tournament does not exist.');
  const sport = sportOf(t.sport_id);
  const matchIds = filter('matches', (x) => x.tournament_id === t.id).map((x) => x.id);

  return {
    tournament: {
      ...t, sport_name: sport?.name, sport_code: sport?.code, color: sport?.color, season_name: seasonName(t.season_id),
    },
    teams: filter('tournament_teams', (x) => x.tournament_id === t.id).map((x) => ({
      ...x, team_name: teamName(x.team_id), age_group: byId('teams', x.team_id)?.age_group,
    })),
    matches: filter('matches', (x) => x.tournament_id === t.id).map((x) => {
      const motm = playerOf(x.player_of_match_id);
      return { ...matchRow(x), motm_name: motm ? `${motm.first_name} ${motm.last_name}` : null };
    }).sort((a, b) => String(a.scheduled_at).localeCompare(String(b.scheduled_at))),
    awards: filter('achievements', (a) => a.tournament_id === t.id).map((a) => {
      const p = playerOf(a.player_id) || {};
      return { ...a, athlete_id: p.athlete_id, first_name: p.first_name, last_name: p.last_name };
    }),
    leaders: sport ? leaderboards(sport, filter('match_performances', (p) => matchIds.includes(p.match_id)), 5).slice(0, 4) : [],
  };
});

/* ---- Matches ---- */
route('GET', /^\/matches$/, (_, __, query) => {
  requireAuth();
  return {
    matches: filter('matches', (m) => {
      if (query.sport && m.sport_id !== Number(query.sport)) return false;
      if (query.tournament && m.tournament_id !== Number(query.tournament)) return false;
      if (query.season && m.season_id !== Number(query.season)) return false;
      if (query.team && m.home_team_id !== Number(query.team) && m.away_team_id !== Number(query.team)) return false;
      if (query.status && m.status !== query.status) return false;
      if (query.from && m.scheduled_at < query.from) return false;
      if (query.to && m.scheduled_at > query.to) return false;
      return true;
    }).map(matchRow)
      .sort((a, b) => String(b.scheduled_at).localeCompare(String(a.scheduled_at)))
      .slice(0, Math.min(Number(query.limit) || 100, 500)),
  };
});

route('POST', /^\/matches$/, (_, body) => {
  requirePermission('matches.write');
  if (body.home_team_id && body.home_team_id === body.away_team_id) fail(422, 'A team cannot play itself.');
  if (!body.away_team_id && !body.opponent_name) {
    fail(422, 'Choose an opposing club team or type the name of the visiting side.');
  }
  const match = { id: nextId('matches'), status: 'scheduled', is_home: 1, is_demo: 0, created_by: session.id, created_at: now(), updated_at: now(), ...body };
  db.matches.push(match);
  audit('create', 'matches', match.id, `Match created for ${match.scheduled_at}`);
  return { match };
});

route('PUT', /^\/matches\/(\d+)$/, (m, body) => {
  requirePermission('matches.write');
  const match = byId('matches', m[1]);
  if (!match) fail(404, 'That match does not exist.');
  const previousMotm = match.player_of_match_id;
  Object.assign(match, body, { updated_at: now() });

  if (body.player_of_match_id && body.player_of_match_id !== previousMotm) {
    const date = String(match.scheduled_at).slice(0, 10);
    if (!find('achievements', (a) => a.player_id === body.player_of_match_id && a.match_id === match.id && a.category === 'match')) {
      db.achievements.push({
        id: nextId('achievements'), player_id: body.player_of_match_id, title: 'Player of the Match',
        category: 'match', level: 'club', sport_id: match.sport_id, tournament_id: match.tournament_id,
        match_id: match.id, team_id: match.home_team_id, awarded_date: date,
        description: match.result_summary || null, is_demo: 0, created_by: session.id, created_at: now(),
      });
    }
    const perf = find('match_performances', (p) => p.match_id === match.id && p.player_id === body.player_of_match_id);
    if (perf) perf.is_motm = 1;
    addTimeline({
      player_id: body.player_of_match_id, event_date: date, event_type: 'achievement',
      title: 'Player of the Match', description: match.result_summary || null,
      sport_id: match.sport_id, ref_table: 'matches_motm', ref_id: match.id, importance: 3,
    });
  }
  audit('update', 'matches', match.id, `Match updated (#${match.id})`);
  return { match };
});

route('DELETE', /^\/matches\/(\d+)$/, (m) => {
  requirePermission('matches.write');
  const id = Number(m[1]);
  db.matches = db.matches.filter((x) => x.id !== id);
  db.match_players = db.match_players.filter((x) => x.match_id !== id);
  db.match_performances = db.match_performances.filter((x) => x.match_id !== id);
  audit('delete', 'matches', id, `Match deleted (#${id})`);
  return { ok: true };
});

route('GET', /^\/matches\/(\d+)$/, (m) => {
  requireAuth();
  const match = byId('matches', m[1]);
  if (!match) fail(404, 'That match does not exist.');
  const sport = sportOf(match.sport_id);

  return {
    match: matchRow(match),
    sport: { ...sport, config_json: undefined },
    lineup: filter('match_players', (x) => x.match_id === match.id).map((x) => {
      const p = playerOf(x.player_id) || {};
      const ps = find('player_sports', (y) => y.player_id === x.player_id && y.sport_id === match.sport_id);
      return {
        ...x, athlete_id: p.athlete_id, first_name: p.first_name, last_name: p.last_name,
        display_name: p.display_name, photo_url: p.photo_url,
        team_name: teamName(x.team_id), default_position: ps?.position,
      };
    }).sort((a, b) => (a.is_substitute - b.is_substitute) || ((a.batting_order || 99) - (b.batting_order || 99))),
    performances: filter('match_performances', (x) => x.match_id === match.id).map((x) => {
      const p = playerOf(x.player_id) || {};
      const stats = parseJson(x.stats_json, {});
      return {
        ...x, stats, computed: performanceScope(stats, sport.config), stats_json: undefined,
        athlete_id: p.athlete_id, first_name: p.first_name, last_name: p.last_name,
        display_name: p.display_name, photo_url: p.photo_url,
      };
    }),
  };
});

route('PUT', /^\/matches\/(\d+)\/lineup$/, (m, body) => {
  requirePermission('matches.write');
  const match = byId('matches', m[1]);
  if (!match) fail(404, 'That match does not exist.');
  const sport = sportOf(match.sport_id);
  const players = body.players || [];

  const ids = players.map((p) => p.player_id);
  if (new Set(ids).size !== ids.length) fail(422, 'The same athlete appears twice in this lineup.');
  const starters = players.filter((p) => p.is_starting && !p.is_substitute).length;
  if (sport.config.squadSize && starters > sport.config.squadSize) {
    fail(422, `${sport.name} allows ${sport.config.squadSize} in the starting lineup — you have selected ${starters}.`);
  }
  if (players.filter((p) => p.is_captain).length > 1) fail(422, 'Only one captain can be named.');

  for (const existing of filter('match_players', (x) => x.match_id === match.id)) {
    if (!ids.includes(existing.player_id)) {
      if (find('match_performances', (p) => p.match_id === match.id && p.player_id === existing.player_id)) {
        fail(409, 'Remove the recorded performance before dropping that athlete from the lineup.');
      }
      db.match_players = db.match_players.filter((x) => x.id !== existing.id);
    }
  }
  for (const p of players) {
    const existing = find('match_players', (x) => x.match_id === match.id && x.player_id === p.player_id);
    if (existing) Object.assign(existing, p);
    else db.match_players.push({ id: nextId('match_players'), match_id: match.id, ...p });
  }
  audit('update', 'match_players', match.id, `Lineup set for match #${match.id} (${players.length} selected)`);
  return { ok: true };
});

route('PUT', /^\/matches\/(\d+)\/performances$/, (m, body) => {
  requirePermission('performances.write');
  const match = byId('matches', m[1]);
  if (!match) fail(404, 'That match does not exist.');
  const sport = sportOf(match.sport_id);
  const date = String(match.scheduled_at).slice(0, 10);

  const problems = [];
  const cleaned = [];
  for (const entry of body.performances || []) {
    const player = playerOf(entry.player_id);
    if (!player) { problems.push(`Athlete #${entry.player_id} does not exist`); continue; }
    const squad = find('match_players', (x) => x.match_id === match.id && x.player_id === player.id);
    if (!squad) { problems.push(`${player.first_name} ${player.last_name} is not in this match's squad`); continue; }
    const { ok, errors, clean } = validateStats(sport.config, entry.stats || {});
    if (!ok) { problems.push(...errors.map((e) => `${player.first_name} ${player.last_name}: ${e}`)); continue; }
    cleaned.push({ player, teamId: entry.team_id ?? squad.team_id ?? match.home_team_id, stats: clean, notes: entry.notes ?? null });
  }
  if (problems.length) fail(422, 'Some statistics could not be saved.', problems);

  const milestones = [];
  for (const c of cleaned) {
    const existing = find('match_performances', (x) => x.match_id === match.id && x.player_id === c.player.id);
    const payload = {
      match_id: match.id, player_id: c.player.id, sport_id: match.sport_id, team_id: c.teamId,
      stats_json: JSON.stringify(c.stats), rating: computeMatchRating(sport.config, c.stats),
      notes: c.notes, created_by: session.id, updated_at: now(),
    };
    if (existing) Object.assign(existing, payload);
    else db.match_performances.push({ id: nextId('match_performances'), is_motm: 0, created_at: now(), ...payload });

    addTimeline({
      player_id: c.player.id, event_date: date, event_type: 'match',
      title: `Played ${sport.name}${match.opponent_name ? ` vs ${match.opponent_name}` : ''}`,
      description: match.result_summary || match.venue || null,
      sport_id: match.sport_id, ref_table: 'matches', ref_id: match.id, importance: 1,
    });

    // Milestone detection, mirroring server/src/lib/timeline.js
    const s = c.stats;
    const mark = (title, description) => {
      addTimeline({
        player_id: c.player.id, event_date: date, event_type: 'milestone', title, description,
        sport_id: match.sport_id, ref_table: `milestone:${match.id}:${title}`, ref_id: match.id, importance: 3,
      });
      milestones.push(`${c.player.first_name} ${c.player.last_name}: ${title}`);
    };
    if (sport.code === 'cricket') {
      if (Number(s.runs) >= 100) mark(`Century — ${s.runs} runs`, 'Scored a hundred in a single innings.');
      else if (Number(s.runs) >= 50) mark(`Half-century — ${s.runs} runs`, 'Passed fifty in a single innings.');
      if (Number(s.wickets) >= 5) mark(`Five-wicket haul — ${s.wickets} wickets`, 'Took five or more wickets in an innings.');
      else if (Number(s.wickets) >= 3) mark(`${s.wickets}-wicket haul`, 'Took three or more wickets in an innings.');
    }
    if ((sport.code === 'football' || sport.code === 'futsal') && Number(s.goals) >= 3) {
      mark(`Hat-trick — ${s.goals} goals`, 'Scored three or more goals in a single match.');
    }
    if (sport.code === 'basketball') {
      const pts = (Number(s.fgm || 0) - Number(s.tpm || 0)) * 2 + Number(s.tpm || 0) * 3 + Number(s.ftm || 0);
      if (pts >= 30) mark(`${pts}-point game`, 'Scored thirty or more points in a single game.');
    }
  }
  audit('update', 'match_performances', match.id, `Performances saved for match #${match.id} (${cleaned.length} athletes)`);
  return { ok: true, saved: cleaned.length, milestones };
});

route('DELETE', /^\/matches\/(\d+)\/performances\/(\d+)$/, (m) => {
  requirePermission('performances.write');
  const before = db.match_performances.length;
  db.match_performances = db.match_performances.filter(
    (x) => !(x.match_id === Number(m[1]) && x.player_id === Number(m[2])),
  );
  if (db.match_performances.length === before) fail(404, 'No performance recorded for that athlete in this match.');
  audit('delete', 'match_performances', Number(m[1]), 'Performance removed');
  return { ok: true };
});


/* ---- Ball-by-ball capture and analysis ---- */

const eventPayload = (e) => ({ ...e, payload: parseJson(e.payload_json, {}) });

function matchEvents(matchId) {
  return filter('match_events', (e) => e.match_id === Number(matchId))
    .map(eventPayload)
    .sort((a, b) => a.sequence - b.sequence || a.id - b.id);
}

function matchPlayerMap(matchId) {
  const ids = new Set();
  filter('match_players', (mp) => mp.match_id === Number(matchId)).forEach((mp) => ids.add(mp.player_id));
  matchEvents(matchId).forEach((e) => {
    [e.primary_player_id, e.secondary_player_id, e.tertiary_player_id].forEach((id) => { if (id) ids.add(id); });
  });
  const map = new Map();
  ids.forEach((id) => { const p = playerOf(id); if (p) map.set(id, p); });
  return map;
}

/** Mirrors the server: rebuild match_performances from the event stream. */
function refreshPerformances(match, sport) {
  const events = matchEvents(match.id);
  if (!events.length) return 0;
  const derived = derivePerformances(sport.config, events);
  const derivable = new Set((sport.config.events?.derive || []).map((r) => r.stat));
  const squad = new Map(filter('match_players', (mp) => mp.match_id === match.id).map((mp) => [mp.player_id, mp.team_id]));

  let updated = 0;
  for (const [playerId, stats] of derived) {
    const existing = find('match_performances', (p) => p.match_id === match.id && p.player_id === playerId);
    const merged = { ...parseJson(existing?.stats_json, {}) };
    for (const key of derivable) delete merged[key];
    Object.assign(merged, stats);

    const payload = {
      match_id: match.id, player_id: playerId, sport_id: match.sport_id,
      team_id: squad.get(playerId) ?? match.home_team_id ?? null,
      stats_json: JSON.stringify(merged),
      rating: computeMatchRating(sport.config, merged),
      updated_at: now(),
    };
    if (existing) Object.assign(existing, payload);
    else db.match_performances.push({ id: nextId('match_performances'), is_motm: 0, notes: null, created_by: session?.id ?? null, created_at: now(), ...payload });

    if (!squad.has(playerId)) {
      db.match_players.push({
        id: nextId('match_players'), match_id: match.id, player_id: playerId,
        team_id: match.home_team_id ?? null, is_starting: 1, is_substitute: 0,
        is_captain: 0, is_keeper: 0,
      });
    }
    updated += 1;
  }
  return updated;
}

route('GET', /^\/matches\/(\d+)\/periods$/, (m) => {
  requireAuth();
  return { periods: filter('match_periods', (p) => p.match_id === Number(m[1])).sort((a, b) => a.sequence - b.sequence) };
});

route('POST', /^\/matches\/(\d+)\/periods$/, (m, body) => {
  requirePermission('performances.write');
  const match = byId('matches', m[1]);
  if (!match) fail(404, 'That match does not exist.');
  if (find('match_periods', (p) => p.match_id === match.id && p.sequence === Number(body.sequence))) {
    fail(409, `${body.label} already exists for this match.`);
  }
  const period = {
    id: nextId('match_periods'), match_id: match.id, status: 'in_progress',
    created_at: now(), updated_at: now(), ...body,
  };
  if (!db.match_periods) db.match_periods = [];
  db.match_periods.push(period);
  audit('create', 'match_periods', period.id, `${period.label} opened for match #${match.id}`);
  return { period };
});

route('PUT', /^\/matches\/(\d+)\/periods\/(\d+)$/, (m, body) => {
  requirePermission('performances.write');
  const period = find('match_periods', (p) => p.id === Number(m[2]) && p.match_id === Number(m[1]));
  if (!period) fail(404, 'That period does not exist.');
  Object.assign(period, body, { updated_at: now() });
  return { period };
});

route('GET', /^\/matches\/(\d+)\/events$/, (m, __, query) => {
  requireAuth();
  const match = byId('matches', m[1]);
  if (!match) fail(404, 'That match does not exist.');
  const sport = sportOf(match.sport_id);
  const players = matchPlayerMap(match.id);
  let events = matchEvents(match.id);
  if (query.period) events = events.filter((e) => e.period_id === Number(query.period));
  if (query.type) events = events.filter((e) => e.event_type === query.type);
  if (query.player) {
    const id = Number(query.player);
    events = events.filter((e) => [e.primary_player_id, e.secondary_player_id, e.tertiary_player_id].includes(id));
  }
  const nm = (id) => { const p = players.get(id); return p ? (p.display_name || `${p.first_name} ${p.last_name}`) : null; };
  return {
    events: events.map((e) => ({
      ...e, payload_json: undefined,
      commentary: e.commentary || describeEvent(e, players, sport.code),
      primary_name: nm(e.primary_player_id),
      secondary_name: nm(e.secondary_player_id),
      tertiary_name: nm(e.tertiary_player_id),
    })),
    total: events.length,
  };
});

route('POST', /^\/matches\/(\d+)\/events$/, (m, body) => {
  requirePermission('performances.write');
  const match = byId('matches', m[1]);
  if (!match) fail(404, 'That match does not exist.');
  const sport = sportOf(match.sport_id);
  const definition = (sport.config.events?.types || []).find((t) => t.key === body.event_type);
  if (!definition) {
    const known = (sport.config.events?.types || []).map((t) => t.key).join(', ');
    fail(422, `"${body.event_type}" is not an event type for ${sport.name}. Accepted: ${known || 'none configured'}.`);
  }

  const payload = {};
  const errors = [];
  for (const f of definition.fields || []) {
    if (!(f.key in (body.payload || {}))) continue;
    const raw = body.payload[f.key];
    if (raw === null || raw === '' || raw === undefined) continue;
    if (f.type === 'bool') { payload[f.key] = raw === true || raw === 1 || raw === '1' || raw === 'true' ? 1 : 0; continue; }
    if (f.type === 'select') {
      if (f.options && !f.options.includes(String(raw))) { errors.push(`${f.label}: "${raw}" is not an accepted value`); continue; }
      payload[f.key] = String(raw); continue;
    }
    if (f.type === 'text') { payload[f.key] = String(raw); continue; }
    const n = Number(raw);
    if (!Number.isFinite(n)) { errors.push(`${f.label} must be a number`); continue; }
    if (f.min !== undefined && n < f.min) errors.push(`${f.label} cannot be below ${f.min}`);
    if (f.max !== undefined && n > f.max) errors.push(`${f.label} cannot be above ${f.max}`);
    payload[f.key] = n;
  }
  for (const pass of ['dismissed_player_id', 'text']) {
    if (body.payload?.[pass] !== undefined && body.payload[pass] !== '') payload[pass] = body.payload[pass];
  }
  if (errors.length) fail(422, 'That event could not be recorded.', errors);

  // Cricket works out its own over and ball position.
  let over = body.over_number ?? null;
  let ball = body.ball_in_over ?? null;
  if (sport.config.events?.ballBased && body.event_type === 'ball' && over === null) {
    const prior = matchEvents(match.id)
      .filter((e) => e.event_type === 'ball' && !e.is_void && e.period_id === (body.period_id ?? null))
      .at(-1);
    if (!prior) { over = 0; ball = 1; } else {
      const extra = String(prior.payload.extra_type || '').toLowerCase();
      const counted = !['wide', 'no ball'].includes(extra);
      const o = Math.floor(Number(prior.over_number) || 0);
      const b = Number(prior.ball_in_over) || 0;
      if (!counted) { over = o; ball = b; }
      else if (b >= 6) { over = o + 1; ball = 1; }
      else { over = o; ball = b + 1; }
    }
  }

  const sequence = matchEvents(match.id).reduce((mx, e) => Math.max(mx, e.sequence), 0) + 1;
  const event = {
    id: nextId('match_events'), match_id: match.id, period_id: body.period_id ?? null,
    sequence, event_type: body.event_type, over_number: over, ball_in_over: ball,
    minute: body.minute ?? null, clock: body.clock ?? null,
    team_id: body.team_id ?? match.home_team_id ?? null,
    primary_player_id: body.primary_player_id ?? null,
    secondary_player_id: body.secondary_player_id ?? null,
    tertiary_player_id: body.tertiary_player_id ?? null,
    opponent_name: body.opponent_name ?? null,
    x: body.x ?? null, y: body.y ?? null, end_x: body.end_x ?? null, end_y: body.end_y ?? null,
    outcome: body.outcome ?? null, payload_json: JSON.stringify(payload),
    commentary: body.commentary ?? null, is_void: 0,
    created_by: session.id, created_at: now(), updated_at: now(),
  };
  if (!db.match_events) db.match_events = [];
  db.match_events.push(event);

  const updated = refreshPerformances(match, sport);

  const milestones = [];
  const derived = derivePerformances(sport.config, matchEvents(match.id));
  const date = String(match.scheduled_at).slice(0, 10);
  for (const [playerId, stats] of derived) {
    const p = playerOf(playerId);
    if (!p) continue;
    const mark = (title) => {
      addTimeline({
        player_id: playerId, event_date: date, event_type: 'milestone', title,
        sport_id: match.sport_id, ref_table: `milestone:${match.id}:${title}`, ref_id: match.id, importance: 3,
      });
      milestones.push(`${p.first_name} ${p.last_name}: ${title}`);
    };
    if (sport.code === 'cricket') {
      if (Number(stats.runs) >= 100) mark(`Century — ${stats.runs} runs`);
      else if (Number(stats.runs) >= 50) mark(`Half-century — ${stats.runs} runs`);
      if (Number(stats.wickets) >= 5) mark(`Five-wicket haul — ${stats.wickets} wickets`);
    }
    if ((sport.code === 'football' || sport.code === 'futsal') && Number(stats.goals) >= 3) {
      mark(`Hat-trick — ${stats.goals} goals`);
    }
  }

  const players = matchPlayerMap(match.id);
  return {
    event: { ...eventPayload(event), payload_json: undefined, commentary: event.commentary || describeEvent({ ...event, payload }, players, sport.code) },
    performancesUpdated: updated,
    milestones,
  };
});

route('PUT', /^\/matches\/(\d+)\/events\/(\d+)$/, (m, body) => {
  requirePermission('performances.write');
  const match = byId('matches', m[1]);
  const event = find('match_events', (e) => e.id === Number(m[2]) && e.match_id === Number(m[1]));
  if (!event) fail(404, 'That event does not exist.');
  const patch = { ...body };
  if (patch.payload) { patch.payload_json = JSON.stringify(patch.payload); delete patch.payload; }
  Object.assign(event, patch, { updated_at: now() });
  const updated = refreshPerformances(match, sportOf(match.sport_id));
  audit('update', 'match_events', event.id, `Event corrected in match #${match.id}`);
  return { ok: true, performancesUpdated: updated };
});

route('DELETE', /^\/matches\/(\d+)\/events\/(\d+)$/, (m) => {
  requirePermission('performances.write');
  const match = byId('matches', m[1]);
  const event = find('match_events', (e) => e.id === Number(m[2]) && e.match_id === Number(m[1]));
  if (!event) fail(404, 'That event does not exist.');
  const last = matchEvents(match.id).at(-1);
  if (last && last.id === event.id) {
    db.match_events = db.match_events.filter((e) => e.id !== event.id);
    audit('delete', 'match_events', event.id, `Last event undone in match #${match.id}`);
  } else {
    event.is_void = 1;
    audit('update', 'match_events', event.id, `Event voided in match #${match.id}`);
  }
  const updated = refreshPerformances(match, sportOf(match.sport_id));
  return { ok: true, performancesUpdated: updated };
});

route('GET', /^\/matches\/(\d+)\/analysis$/, (m) => {
  requireAuth();
  const match = byId('matches', m[1]);
  if (!match) fail(404, 'That match does not exist.');
  const sport = sportOf(match.sport_id);
  const analysis = analyseMatch(sport, matchEvents(match.id), matchPlayerMap(match.id),
    filter('match_periods', (p) => p.match_id === match.id).sort((a, b) => a.sequence - b.sequence));
  return {
    match: {
      id: match.id, sport: sport.name, sportCode: sport.code,
      scheduledAt: match.scheduled_at, venue: match.venue, status: match.status,
      result: match.result, resultSummary: match.result_summary,
      homeTeam: teamName(match.home_team_id), opponent: match.opponent_name,
    },
    ...analysis,
  };
});

route('GET', /^\/matches\/(\d+)\/analysis\/player\/(\d+)$/, (m) => {
  requireAuth();
  const match = byId('matches', m[1]);
  const sport = sportOf(match.sport_id);
  const playerId = Number(m[2]);
  const players = matchPlayerMap(match.id);
  const involved = matchEvents(match.id)
    .filter((e) => [e.primary_player_id, e.secondary_player_id, e.tertiary_player_id].includes(playerId));
  const analysis = analyseMatch(sport, involved, players,
    filter('match_periods', (p) => p.match_id === match.id).sort((a, b) => a.sequence - b.sequence));
  const perf = find('match_performances', (p) => p.match_id === match.id && p.player_id === playerId);
  return {
    player: players.get(playerId) || null,
    performance: perf ? { ...perf, stats: parseJson(perf.stats_json, {}), stats_json: undefined } : null,
    events: involved.length,
    asPrimary: involved.filter((e) => e.primary_player_id === playerId).length,
    asSecondary: involved.filter((e) => e.secondary_player_id === playerId).length,
    asTertiary: involved.filter((e) => e.tertiary_player_id === playerId).length,
    overall: analysis.overall,
    commentary: analysis.commentary,
  };
});

route('POST', /^\/matches\/(\d+)\/analysis\/rebuild$/, (m) => {
  requirePermission('performances.write');
  const match = byId('matches', m[1]);
  const updated = refreshPerformances(match, sportOf(match.sport_id));
  return { ok: true, performancesUpdated: updated };
});


/* ---- Drill library, session plans, benchmarks, announcements ---- */

route('GET', /^\/drills$/, (_, __, query) => {
  requireAuth();
  const q = String(query.q || '').toLowerCase();
  return {
    drills: filter('drills', (d) => {
      if (!d.is_active) return false;
      if (query.sport && d.sport_id != null && d.sport_id !== Number(query.sport)) return false;
      if (query.category && d.category !== query.category) return false;
      if (query.difficulty && d.difficulty !== query.difficulty) return false;
      if (query.ageGroup && d.age_groups && !d.age_groups.includes(query.ageGroup)) return false;
      if (q && ![d.name, d.skill_focus, d.description].some((v) => String(v || '').toLowerCase().includes(q))) return false;
      return true;
    }).map((d) => ({
      ...d,
      sport_name: byId('sports', d.sport_id)?.name,
      color: byId('sports', d.sport_id)?.color,
      times_used: filter('training_session_drills', (x) => x.drill_id === d.id).length,
    })).sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name)),
  };
});

route('GET', /^\/drills\/(\d+)$/, (m) => {
  requireAuth();
  const drill = byId('drills', m[1]);
  if (!drill) fail(404, 'That drill does not exist.');
  return {
    drill: { ...drill, sport_name: byId('sports', drill.sport_id)?.name },
    sessions: filter('training_session_drills', (x) => x.drill_id === drill.id).map((x) => {
      const s = byId('training_sessions', x.session_id) || {};
      return { id: s.id, session_date: s.session_date, training_type: s.training_type, team_name: teamName(s.team_id), notes: x.notes };
    }).sort((a, b) => String(b.session_date).localeCompare(String(a.session_date))).slice(0, 20),
  };
});

route('POST', /^\/drills$/, (_, body) => {
  requirePermission('training.write');
  if (body.players_min && body.players_max && body.players_min > body.players_max) {
    fail(422, 'The minimum number of players cannot exceed the maximum.');
  }
  const drill = {
    id: nextId('drills'), is_active: 1, is_demo: 0, created_by: session.id,
    created_at: now(), updated_at: now(), category: 'technical', difficulty: 'all', ...body,
  };
  if (!db.drills) db.drills = [];
  db.drills.push(drill);
  audit('create', 'drills', drill.id, `Drill added: ${drill.name}`);
  return { drill };
});

route('PUT', /^\/drills\/(\d+)$/, (m, body) => {
  requirePermission('training.write');
  const drill = byId('drills', m[1]);
  if (!drill) fail(404, 'That drill does not exist.');
  Object.assign(drill, body, { updated_at: now() });
  audit('update', 'drills', drill.id, `Drill updated: ${drill.name}`);
  return { drill };
});

route('GET', /^\/session-templates$/, (_, __, query) => {
  requireAuth();
  return {
    templates: filter('session_templates', (t) => !query.sport || t.sport_id == null || t.sport_id === Number(query.sport))
      .map((t) => ({
        ...t,
        sport_name: byId('sports', t.sport_id)?.name,
        drill_count: filter('session_template_drills', (d) => d.template_id === t.id).length,
        drills: filter('session_template_drills', (d) => d.template_id === t.id)
          .sort((a, b) => a.sort_order - b.sort_order)
          .map((d) => {
            const dr = byId('drills', d.drill_id) || {};
            return { ...d, name: dr.name, category: dr.category, skill_focus: dr.skill_focus, equipment: dr.equipment, coaching_points: dr.coaching_points };
          }),
      })).sort((a, b) => a.name.localeCompare(b.name)),
  };
});

route('POST', /^\/session-templates$/, (_, body) => {
  requirePermission('training.write');
  const template = {
    id: nextId('session_templates'), is_demo: 0, created_by: session.id, created_at: now(),
    name: body.name, sport_id: body.sport_id ?? null, training_type: body.training_type || 'technical',
    age_group: body.age_group ?? null, duration_minutes: body.duration_minutes ?? null,
    objectives: body.objectives ?? null, notes: body.notes ?? null,
  };
  if (!db.session_templates) db.session_templates = [];
  db.session_templates.push(template);
  if (!db.session_template_drills) db.session_template_drills = [];
  (body.drills || []).forEach((d, i) => db.session_template_drills.push({
    id: nextId('session_template_drills'), template_id: template.id, drill_id: d.drill_id,
    sort_order: i, duration_minutes: d.duration_minutes ?? null, notes: d.notes ?? null,
  }));
  audit('create', 'session_templates', template.id, `Session plan created: ${template.name}`);
  return { template };
});

route('GET', /^\/training\/(\d+)\/drills$/, (m) => {
  requireAuth();
  return {
    drills: filter('training_session_drills', (x) => x.session_id === Number(m[1]))
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((x) => {
        const d = byId('drills', x.drill_id) || {};
        return { ...x, name: d.name, category: d.category, skill_focus: d.skill_focus, equipment: d.equipment, coaching_points: d.coaching_points, video_url: d.video_url };
      }),
  };
});

route('PUT', /^\/training\/(\d+)\/drills$/, (m, body) => {
  requirePermission('training.write');
  const s2 = byId('training_sessions', m[1]);
  if (!s2) fail(404, 'That training session does not exist.');
  db.training_session_drills = (db.training_session_drills || []).filter((x) => x.session_id !== s2.id);
  (body.drills || []).forEach((d, i) => db.training_session_drills.push({
    id: nextId('training_session_drills'), session_id: s2.id, drill_id: d.drill_id,
    sort_order: i, duration_minutes: d.duration_minutes ?? null, notes: d.notes ?? null,
  }));
  audit('update', 'training_session_drills', s2.id, `${(body.drills || []).length} drills set on session #${s2.id}`);
  return { ok: true, count: (body.drills || []).length };
});

route('POST', /^\/training\/(\d+)\/apply-template\/(\d+)$/, (m) => {
  requirePermission('training.write');
  const s2 = byId('training_sessions', m[1]);
  if (!s2) fail(404, 'That training session does not exist.');
  const template = byId('session_templates', m[2]);
  if (!template) fail(404, 'That session plan does not exist.');
  const drills = filter('session_template_drills', (d) => d.template_id === template.id).sort((a, b) => a.sort_order - b.sort_order);
  db.training_session_drills = (db.training_session_drills || []).filter((x) => x.session_id !== s2.id);
  drills.forEach((d, i) => db.training_session_drills.push({
    id: nextId('training_session_drills'), session_id: s2.id, drill_id: d.drill_id,
    sort_order: i, duration_minutes: d.duration_minutes, notes: d.notes,
  }));
  if (template.objectives && !s2.objectives) s2.objectives = template.objectives;
  audit('update', 'training_sessions', s2.id, `Session plan "${template.name}" applied`);
  return { ok: true, drills: drills.length };
});

route('GET', /^\/benchmarks$/, (_, __, query) => {
  requireAuth();
  return {
    benchmarks: filter('benchmarks', (b) => {
      if (query.sport && b.sport_id != null && b.sport_id !== Number(query.sport)) return false;
      if (query.ageGroup && b.age_group !== query.ageGroup) return false;
      if (query.source && b.source !== query.source) return false;
      return true;
    }).map((b) => ({ ...b, sport_name: byId('sports', b.sport_id)?.name })),
  };
});

route('POST', /^\/benchmarks$/, (_, body) => {
  requirePermission('assessments.write');
  const b = { id: nextId('benchmarks'), is_demo: 0, created_at: now(), source: 'career', higher_is_better: 1, ...body };
  if (!db.benchmarks) db.benchmarks = [];
  db.benchmarks.push(b);
  audit('create', 'benchmarks', b.id, `Benchmark added: ${b.label} (${b.age_group})`);
  return { benchmark: b };
});

/** Which band a value falls into — mirrors the server. */
function benchmarkBand(b, value) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return null;
  const v = Number(value);
  for (const name of ['exceptional', 'strong', 'competent', 'developing']) {
    const threshold = b[name];
    if (threshold === null || threshold === undefined) continue;
    if (b.higher_is_better ? v >= threshold : v <= threshold) return name;
  }
  return 'below';
}

route('GET', /^\/players\/(\d+)\/benchmarks$/, (m) => {
  requireAuth();
  const playerId = Number(m[1]);
  guardPlayer(playerId);
  const player = playerOf(playerId);
  if (!player) fail(404, 'That athlete record does not exist.');

  const membership = filter('team_memberships', (tm) => tm.player_id === playerId && !tm.end_date)
    .map((tm) => byId('teams', tm.team_id))
    .find((t) => t && t.age_group);
  let ageGroup = membership?.age_group;
  if (!ageGroup && player.dob) {
    const age = Math.floor((Date.now() - new Date(player.dob)) / (365.25 * 864e5));
    ageGroup = age < 16 ? 'U16' : age < 18 ? 'U18' : 'Senior';
  }
  ageGroup = ageGroup || 'Senior';

  const career = [];
  for (const ps of filter('player_sports', (x) => x.player_id === playerId).sort((a, b) => b.is_primary - a.is_primary)) {
    const sport = sportOf(ps.sport_id);
    if (!sport) continue;
    const values = playerCareer(playerId, sport).career.values;
    for (const b of filter('benchmarks', (x) => x.age_group === ageGroup && x.source === 'career'
      && (x.sport_id === sport.id || x.sport_id == null)
      && (x.gender == null || x.gender === (player.gender || 'male')))) {
      if (values[b.metric] === undefined) continue;
      career.push({
        sport: sport.name, sportId: sport.id, metric: b.metric, label: b.label, unit: b.unit,
        value: Math.round(Number(values[b.metric]) * 100) / 100,
        band: benchmarkBand(b, values[b.metric]),
        thresholds: { developing: b.developing, competent: b.competent, strong: b.strong, exceptional: b.exceptional },
        higherIsBetter: !!b.higher_is_better,
      });
    }
  }

  const latest = filter('assessments', (a) => a.player_id === playerId)
    .sort((a, b) => String(b.assessment_date).localeCompare(String(a.assessment_date)))[0];
  const assessment = [];
  if (latest) {
    for (const sc of filter('assessment_scores', (x) => x.assessment_id === latest.id)) {
      const c = byId('assessment_criteria', sc.criteria_id);
      if (!c) continue;
      const b = find('benchmarks', (x) => x.age_group === ageGroup && x.source === 'assessment' && x.metric === c.key
        && (x.sport_id === latest.sport_id || x.sport_id == null));
      if (!b) continue;
      assessment.push({
        metric: c.key, label: c.name, category: c.category, value: sc.score,
        band: benchmarkBand(b, sc.score),
        thresholds: { developing: b.developing, competent: b.competent, strong: b.strong, exceptional: b.exceptional },
        higherIsBetter: !!b.higher_is_better,
      });
    }
  }

  return { ageGroup, assessedOn: latest?.assessment_date ?? null, career, assessment };
});

route('GET', /^\/announcements$/, () => {
  const user = requireAuth();
  const teams = allowedTeamIds(user);
  const linked = user.linkedPlayerIds || [];
  const today10 = today();

  return {
    announcements: filter('announcements', (a) => {
      if (a.expires_at && a.expires_at < today10) return false;
      if (a.audience === 'club' || a.audience === 'sport') return true;
      if (a.audience === 'team') return teams === null || teams.includes(a.team_id);
      const addressed = filter('announcement_recipients', (r) => r.announcement_id === a.id
        && (r.user_id === user.id || linked.includes(r.player_id)));
      return addressed.length > 0 || ['super_admin', 'sports_director'].includes(user.role);
    }).map((a) => ({
      ...a,
      sport_name: byId('sports', a.sport_id)?.name,
      team_name: teamName(a.team_id),
      author: byId('users', a.created_by)?.full_name,
      recipients: filter('announcement_recipients', (r) => r.announcement_id === a.id).map((r) => {
        const p = playerOf(r.player_id) || {};
        return { ...r, first_name: p.first_name, last_name: p.last_name, athlete_id: p.athlete_id };
      }),
    })).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))),
  };
});

route('POST', /^\/announcements$/, (_, body) => {
  requirePermission('training.write');
  if (body.audience === 'team' && !body.team_id) fail(422, 'Choose the team this is for.');
  if (body.audience === 'sport' && !body.sport_id) fail(422, 'Choose the sport this is for.');
  if (body.audience === 'players' && !(body.playerIds || []).length) {
    fail(422, 'Choose at least one athlete to send this to.');
  }
  const a = {
    id: nextId('announcements'), priority: 'normal', audience: 'club', is_demo: 0,
    created_by: session.id, created_at: now(),
    title: body.title, body: body.body, sport_id: body.sport_id ?? null, team_id: body.team_id ?? null,
    starts_at: body.starts_at ?? null, expires_at: body.expires_at ?? null,
    ...(body.priority ? { priority: body.priority } : {}),
    ...(body.audience ? { audience: body.audience } : {}),
  };
  if (!db.announcements) db.announcements = [];
  db.announcements.push(a);
  if (!db.announcement_recipients) db.announcement_recipients = [];
  (body.playerIds || []).forEach((player_id) => db.announcement_recipients.push({
    id: nextId('announcement_recipients'), announcement_id: a.id, player_id, user_id: null, read_at: null,
  }));
  audit('create', 'announcements', a.id, `Announcement sent: ${a.title}`);
  return { announcement: a };
});

route('DELETE', /^\/announcements\/(\d+)$/, (m) => {
  requirePermission('training.write');
  const a = byId('announcements', m[1]);
  if (!a) fail(404, 'That announcement does not exist.');
  db.announcements = db.announcements.filter((x) => x.id !== a.id);
  audit('delete', 'announcements', a.id, `Announcement removed: ${a.title}`);
  return { ok: true };
});

/* ---- Showcase profile ---- */

route('PUT', /^\/players\/(\d+)\/showcase$/, (m, body) => {
  requirePermission('players.write');
  const player = playerOf(m[1]);
  if (!player) fail(404, 'That athlete record does not exist.');
  guardPlayer(player.id);

  let token = player.showcase_token;
  if (!body.enabled) token = null;
  else if (!token || body.regenerate) token = `sc-${Math.random().toString(36).slice(2, 14)}`;

  player.showcase_enabled = body.enabled ? 1 : 0;
  player.showcase_token = token;
  if (body.headline !== undefined) player.showcase_headline = body.headline;
  player.showcase_updated_at = now();

  audit('update', 'players', player.id, `Showcase ${body.enabled ? 'enabled' : 'disabled'} for ${player.athlete_id}`);
  return { enabled: !!body.enabled, token, path: token ? `/showcase/${token}` : null };
});

route('GET', /^\/players\/showcase\/([^/]+)$/, (m) => {
  const player = find('players', (p) => p.showcase_token === m[1] && p.showcase_enabled);
  if (!player) fail(404, 'That showcase profile is not available. The link may have been withdrawn.');

  return {
    athlete: {
      athleteId: player.athlete_id,
      name: player.display_name || `${player.first_name} ${player.last_name}`,
      headline: player.showcase_headline,
      photoUrl: player.photo_url,
      nationality: player.nationality,
      dob: player.dob,
      preferredHand: player.preferred_hand,
      preferredFoot: player.preferred_foot,
      heightCm: player.height_cm,
      registeredSince: player.registration_date,
      club: 'Karwan Sports Club',
      updatedAt: player.showcase_updated_at,
    },
    summary: summaryFor(player.id),
    careers: careersFor(player.id).map((c) => ({
      sport: c.sport, matchesPlayed: c.matchesPlayed, headline: c.headline,
      rating: c.rating ? { overall: c.rating.overall, components: c.rating.components } : null,
      career: { groups: c.career.groups },
    })),
    teams: filter('team_memberships', (tm) => tm.player_id === player.id).map((tm) => {
      const t = byId('teams', tm.team_id) || {};
      return {
        name: t.name, age_group: t.age_group, level: t.level,
        sport_name: byId('sports', t.sport_id)?.name,
        start_date: tm.start_date, end_date: tm.end_date, role: tm.role,
      };
    }).sort((a, b) => (!!a.end_date - !!b.end_date) || String(b.start_date).localeCompare(String(a.start_date))),
    achievements: filter('achievements', (a) => a.player_id === player.id).map((a) => ({
      title: a.title, category: a.category, level: a.level, awarded_date: a.awarded_date,
      description: a.description, sport_name: byId('sports', a.sport_id)?.name,
      tournament_name: tournamentName(a.tournament_id),
    })).sort((a, b) => String(b.awarded_date).localeCompare(String(a.awarded_date))),
    milestones: filter('player_timeline', (t) => t.player_id === player.id && t.importance === 3)
      .map((t) => ({ event_date: t.event_date, event_type: t.event_type, title: t.title, description: t.description }))
      .sort((a, b) => String(b.event_date).localeCompare(String(a.event_date))).slice(0, 30),
  };
});


/* ---- Ball tracking, fitness, templates, selection ---- */

const deliveryRow = (d) => {
  const b = playerOf(d.bowler_id) || {};
  const bt = playerOf(d.batter_id) || {};
  const s2 = byId('tracking_sessions', d.session_id) || {};
  return {
    ...d,
    bowler_first: b.first_name, bowler_last: b.last_name,
    batter_first: bt.first_name, batter_last: bt.last_name,
    session_date: s2.session_date, mode: s2.mode, session_title: s2.title,
    trajectory: parseJson(d.trajectory_json, null), trajectory_json: undefined,
  };
};

route('GET', /^\/tracking\/sessions$/, (_, __, query) => {
  requireAuth();
  return {
    sessions: filter('tracking_sessions', (s2) => {
      if (query.sport && s2.sport_id !== Number(query.sport)) return false;
      if (query.mode && s2.mode !== query.mode) return false;
      if (query.player) {
        const id = Number(query.player);
        return filter('deliveries', (d) => d.session_id === s2.id && (d.bowler_id === id || d.batter_id === id)).length > 0;
      }
      return true;
    }).map((s2) => ({
      ...s2,
      sport_name: byId('sports', s2.sport_id)?.name,
      color: byId('sports', s2.sport_id)?.color,
      team_name: teamName(s2.team_id),
      coach_name: byId('coaches', s2.coach_id)?.full_name,
      delivery_count: filter('deliveries', (d) => d.session_id === s2.id).length,
    })).sort((a, b) => String(b.session_date).localeCompare(String(a.session_date)) || b.id - a.id),
  };
});

route('GET', /^\/tracking\/sessions\/(\d+)$/, (m) => {
  requireAuth();
  const session = byId('tracking_sessions', m[1]);
  if (!session) fail(404, 'That tracking session does not exist.');
  const deliveries = filter('deliveries', (d) => d.session_id === session.id)
    .sort((a, b) => a.sequence - b.sequence).map(deliveryRow);

  const bowlers = [...new Set(deliveries.map((d) => d.bowler_id).filter(Boolean))].map((id) => {
    const subset = deliveries.filter((d) => d.bowler_id === id);
    const p = playerOf(id);
    return {
      player: p ? { id: p.id, first_name: p.first_name, last_name: p.last_name, display_name: p.display_name, photo_url: p.photo_url } : null,
      deliveries: subset.length,
      speed: track.speedSummary(subset),
      consistency: track.consistency(subset),
      stumpLine: track.stumpLine(subset),
    };
  }).sort((a, b) => b.deliveries - a.deliveries);

  return {
    session: { ...session, sport_name: byId('sports', session.sport_id)?.name, sport_code: byId('sports', session.sport_id)?.code, team_name: teamName(session.team_id), coach_name: byId('coaches', session.coach_id)?.full_name },
    deliveries,
    targets: filter('consistency_targets', (t) => t.session_id === session.id),
    bowlers,
    summary: {
      deliveries: deliveries.length,
      speed: track.speedSummary(deliveries),
      pitchMap: track.pitchMap(deliveries),
      stumpLine: track.stumpLine(deliveries),
      consistency: track.consistency(deliveries),
    },
  };
});

route('POST', /^\/tracking\/sessions$/, (_, body) => {
  requirePermission('performances.write');
  if (body.mode === 'bowling_machine' && !body.machine_speed_kph) {
    fail(422, 'Set the machine speed, so the deliveries can be read against what it was set to.');
  }
  // Named `row` here: `session` is the signed-in user in this module.
  const row = {
    id: nextId('tracking_sessions'), mode: 'nets', calibrated: 0, source: 'manual',
    pitch_length_cm: 2012, pitch_width_cm: 305, stump_width_cm: 22.86, stump_height_cm: 71.1,
    crease_to_stump_cm: 122, is_demo: 0, created_by: session.id, created_at: now(), updated_at: now(),
    ...body,
  };
  if (!db.tracking_sessions) db.tracking_sessions = [];
  db.tracking_sessions.push(row);
  audit('create', 'tracking_sessions', row.id, `Tracking session opened: ${row.title}`);
  return { session: row };
});

route('PUT', /^\/tracking\/sessions\/(\d+)\/calibration$/, (m, body) => {
  requirePermission('performances.write');
  const s2 = byId('tracking_sessions', m[1]);
  if (!s2) fail(404, 'That tracking session does not exist.');
  s2.calibrated = 1;
  s2.calibration_method = body.method;
  for (const k of ['pitch_length_cm', 'pitch_width_cm', 'stump_width_cm', 'stump_height_cm', 'crease_to_stump_cm']) {
    if (body[k] !== undefined && body[k] !== null) s2[k] = body[k];
  }
  s2.calibration_note = body.note ?? null;
  s2.updated_at = now();
  audit('update', 'tracking_sessions', s2.id, `Scene calibrated (${body.method})`);
  return { session: s2 };
});

route('POST', /^\/tracking\/sessions\/(\d+)\/deliveries$/, (m, body) => {
  requirePermission('performances.write');
  const s2 = byId('tracking_sessions', m[1]);
  if (!s2) fail(404, 'That tracking session does not exist.');

  const payloads = Array.isArray(body.deliveries) ? body.deliveries : [body];
  let next = filter('deliveries', (d) => d.session_id === s2.id).reduce((mx, d) => Math.max(mx, d.sequence), 0) + 1;
  if (!db.deliveries) db.deliveries = [];
  const created = [];

  for (const p of payloads) {
    const hand = p.batter_handedness
      || (p.batter_id ? (playerOf(p.batter_id)?.preferred_hand === 'left' ? 'left' : 'right') : 'right');
    const target = p.target_id
      ? byId('consistency_targets', p.target_id)
      : find('consistency_targets', (t) => t.session_id === s2.id && t.player_id === (p.bowler_id ?? null) && t.active);

    const reading = track.stumpReading(p.stump_x_cm ?? null, p.stump_z_cm ?? null, hand);
    const aim = track.targetReading({ ...p, batter_handedness: hand }, target);
    const drop = Number.isFinite(p.release_speed_kph) && Number.isFinite(p.speed_off_pitch_kph) && p.release_speed_kph > 0
      ? Math.round(((p.release_speed_kph - p.speed_off_pitch_kph) / p.release_speed_kph) * 1000) / 10
      : null;

    const row = {
      id: nextId('deliveries'), session_id: s2.id, event_id: p.event_id ?? null, sequence: next,
      over_number: p.over_number ?? null, ball_in_over: p.ball_in_over ?? null,
      bowler_id: p.bowler_id ?? null, batter_id: p.batter_id ?? null, batter_handedness: hand,
      release_speed_kph: p.release_speed_kph ?? null, speed_off_pitch_kph: p.speed_off_pitch_kph ?? null,
      speed_drop_percent: drop,
      pitch_x_cm: p.pitch_x_cm ?? null, pitch_y_cm: p.pitch_y_cm ?? null,
      bounce_height_cm: p.bounce_height_cm ?? null,
      length_zone: track.lengthZoneFor(p.pitch_y_cm ?? null),
      line_zone: track.lineZoneFor(p.pitch_x_cm ?? null, hand),
      stump_x_cm: p.stump_x_cm ?? null, stump_z_cm: p.stump_z_cm ?? null,
      hits_stumps: reading.hits, stump_hit: reading.stump,
      deviation_deg: p.deviation_deg ?? null, swing_deg: p.swing_deg ?? null, spin_rpm: p.spin_rpm ?? null,
      release_height_cm: p.release_height_cm ?? null, delivery_type: p.delivery_type ?? null,
      target_line: target?.line_zone ?? null, target_length: target?.length_zone ?? null,
      in_target: aim.inTarget, distance_from_target_cm: aim.distanceCm,
      outcome: p.outcome ?? null, runs: p.runs ?? null, wicket: p.wicket ?? 0,
      machine_delivery: p.machine_delivery ?? (s2.mode === 'bowling_machine' ? 1 : 0),
      trajectory_json: p.trajectory ? JSON.stringify(p.trajectory) : null,
      source: p.source ?? s2.source ?? 'manual', notes: p.notes ?? null, created_at: now(),
    };
    db.deliveries.push(row);
    created.push(deliveryRow(row));
    next += 1;
  }

  audit('create', 'deliveries', s2.id, `${created.length} deliveries tracked in "${s2.title}"`);
  return { deliveries: created, count: created.length };
});

route('DELETE', /^\/tracking\/deliveries\/(\d+)$/, (m) => {
  requirePermission('performances.write');
  const row = byId('deliveries', m[1]);
  if (!row) fail(404, 'That delivery does not exist.');
  db.deliveries = db.deliveries.filter((d) => d.id !== row.id);
  audit('delete', 'deliveries', row.id, 'Tracked delivery removed');
  return { ok: true };
});

route('GET', /^\/tracking\/targets$/, (_, __, query) => {
  requireAuth();
  return {
    targets: filter('consistency_targets', (t) => {
      if (query.player && t.player_id !== Number(query.player)) return false;
      if (query.session && t.session_id !== Number(query.session)) return false;
      return true;
    }).map((t) => {
      const p = playerOf(t.player_id) || {};
      return { ...t, first_name: p.first_name, last_name: p.last_name };
    }),
  };
});

route('POST', /^\/tracking\/targets$/, (_, body) => {
  requirePermission('performances.write');
  const target = { id: nextId('consistency_targets'), tolerance_cm: 30, active: 1, is_demo: 0, created_by: session.id, created_at: now(), ...body };
  if (!db.consistency_targets) db.consistency_targets = [];
  db.consistency_targets.push(target);
  audit('create', 'consistency_targets', target.id, `Target set: ${target.name}`);
  return { target };
});

route('GET', /^\/players\/(\d+)\/tracking$/, (m) => {
  requireAuth();
  const id = Number(m[1]);
  guardPlayer(id);
  const bowled = filter('deliveries', (d) => d.bowler_id === id).map(deliveryRow);
  const faced = filter('deliveries', (d) => d.batter_id === id).map(deliveryRow);
  const sessionIds = [...new Set(bowled.map((d) => d.session_id))];
  const sessions = sessionIds.map((sid) => ({
    ...byId('tracking_sessions', sid),
    deliveries: bowled.filter((d) => d.session_id === sid),
  }));
  return {
    playerId: id,
    bowling: bowled.length ? track.bowlerReport(bowled, sessions) : null,
    batting: faced.length ? track.batterReport(faced) : null,
    sessions: sessions.length,
    calibratedSessions: sessions.filter((s2) => s2.calibrated).length,
  };
});

route('GET', /^\/players\/(\d+)\/fitness$/, (m) => {
  requireAuth();
  const id = Number(m[1]);
  guardPlayer(id);
  const records = filter('fitness_records', (f) => f.player_id === id)
    .map((f) => ({ ...f, coach_name: byId('coaches', f.coach_id)?.full_name }))
    .sort((a, b) => String(b.record_date).localeCompare(String(a.record_date)) || b.id - a.id);

  const metrics = {};
  for (const r of records) {
    if (r.kind === 'workout') continue;
    if (!metrics[r.metric]) {
      metrics[r.metric] = { metric: r.metric, label: r.label, unit: r.unit, category: r.category, higherIsBetter: !!r.higher_is_better, points: [] };
    }
    metrics[r.metric].points.push({ date: r.record_date, value: r.value });
  }
  const series = Object.values(metrics).map((mm) => {
    const points = mm.points.slice().sort((a, b) => String(a.date).localeCompare(String(b.date)));
    const first = points[0]?.value;
    const last = points.at(-1)?.value;
    const change = first !== undefined && last !== undefined ? last - first : null;
    return {
      ...mm, points, latest: last ?? null,
      best: points.length ? (mm.higherIsBetter ? Math.max(...points.map((p) => p.value)) : Math.min(...points.map((p) => p.value))) : null,
      change: change === null ? null : Math.round(change * 100) / 100,
      improved: change === null ? null : (mm.higherIsBetter ? change > 0 : change < 0),
    };
  });
  const workouts = records.filter((r) => r.kind === 'workout');
  const rpes = workouts.filter((w) => w.rpe);
  return {
    records, series, workouts,
    summary: {
      tests: records.filter((r) => r.kind === 'test').length,
      workouts: workouts.length,
      metricsTracked: series.length,
      improving: series.filter((s2) => s2.improved === true).length,
      lastRecorded: records[0]?.record_date ?? null,
      averageRpe: rpes.length ? Math.round((rpes.reduce((a, w) => a + w.rpe, 0) / rpes.length) * 10) / 10 : null,
    },
  };
});

route('POST', /^\/fitness$/, (_, body) => {
  requirePermission('training.write');
  guardPlayer(body.player_id);
  const record = { id: nextId('fitness_records'), kind: 'test', category: 'conditioning', higher_is_better: 1, is_demo: 0, created_by: session.id, created_at: now(), ...body };
  if (!db.fitness_records) db.fitness_records = [];
  db.fitness_records.push(record);
  audit('create', 'fitness_records', record.id, `Fitness recorded: ${record.label}`);
  return { record };
});

route('GET', /^\/assessment-templates$/, (_, __, query) => {
  requireAuth();
  return {
    templates: filter('assessment_templates', (t) => t.is_active
      && (!query.sport || t.sport_id === Number(query.sport) || t.sport_id == null))
      .map((t) => ({
        ...t,
        sport_name: byId('sports', t.sport_id)?.name,
        criteria: filter('assessment_template_criteria', (tc) => tc.template_id === t.id)
          .sort((a, b) => a.sort_order - b.sort_order)
          .map((tc) => {
            const c = byId('assessment_criteria', tc.criteria_id) || {};
            return { ...tc, key: c.key, name: c.name, category: c.category, scale_min: c.scale_min, scale_max: c.scale_max, description: c.description };
          }),
      })).sort((a, b) => a.purpose.localeCompare(b.purpose) || a.name.localeCompare(b.name)),
  };
});

route('POST', /^\/assessment-templates$/, (_, body) => {
  requirePermission('assessments.write');
  if (!(body.criteria || []).length) fail(422, 'Choose at least one criterion.');
  const t = {
    id: nextId('assessment_templates'), purpose: 'review', is_active: 1, is_demo: 0,
    created_by: session.id, created_at: now(),
    name: body.name, sport_id: body.sport_id ?? null, age_group: body.age_group ?? null,
    description: body.description ?? null,
    ...(body.purpose ? { purpose: body.purpose } : {}),
  };
  if (!db.assessment_templates) db.assessment_templates = [];
  db.assessment_templates.push(t);
  if (!db.assessment_template_criteria) db.assessment_template_criteria = [];
  body.criteria.forEach((c, i) => db.assessment_template_criteria.push({
    id: nextId('assessment_template_criteria'), template_id: t.id, criteria_id: c.criteria_id,
    sort_order: i, weight: c.weight ?? 1,
  }));
  audit('create', 'assessment_templates', t.id, `Assessment template created: ${t.name}`);
  return { template: t };
});

route('GET', /^\/selection\/compare$/, (_, __, query) => {
  requireAuth();
  const ids = String(query.players || '').split(',').map(Number).filter(Boolean);
  if (ids.length < 2) fail(422, 'Choose at least two athletes to compare.');
  if (ids.length > 8) fail(422, 'Compare up to eight athletes at a time.');
  const sport = sportOf(Number(query.sport));
  if (!sport) fail(422, 'Choose the sport to compare them in.');

  const rows = [];
  for (const id of ids) {
    const p = playerOf(id);
    if (!p) continue;
    const career = playerCareer(id, sport);
    const membership = filter('team_memberships', (tm) => tm.player_id === id && !tm.end_date)
      .map((tm) => byId('teams', tm.team_id)).find((t) => t && t.sport_id === sport.id);
    const latest = filter('assessments', (a) => a.player_id === id && a.sport_id === sport.id)
      .sort((a, b) => String(b.assessment_date).localeCompare(String(a.assessment_date)))[0];
    const att = filter('training_attendance', (ta) => {
      const ts = byId('training_sessions', ta.session_id);
      return ta.player_id === id && ts && ts.sport_id === sport.id;
    });
    const tracked = filter('deliveries', (d) => d.bowler_id === id);
    const inZone = tracked.filter((d) => d.in_target === 1).length;

    rows.push({
      player: { id: p.id, athlete_id: p.athlete_id, first_name: p.first_name, last_name: p.last_name, display_name: p.display_name, photo_url: p.photo_url, dob: p.dob, status: p.status },
      team: membership?.name ?? null,
      ageGroup: membership?.age_group ?? null,
      matches: career.matchesPlayed,
      headline: career.headline,
      rating: career.rating?.overall ?? null,
      assessment: latest ? { score: latest.overall_score, date: latest.assessment_date } : null,
      attendance: att.length
        ? Math.round((att.filter((a) => ['present', 'late'].includes(a.status)).length / att.length) * 100)
        : null,
      tracking: tracked.length
        ? {
          balls: tracked.length,
          averageSpeed: Math.round((tracked.reduce((a, d) => a + (d.release_speed_kph || 0), 0) / tracked.filter((d) => d.release_speed_kph).length) * 10) / 10 || null,
          inZonePercent: Math.round((inZone / tracked.length) * 1000) / 10,
        }
        : null,
      fitness: filter('fitness_records', (f) => f.player_id === id && f.kind === 'test')
        .sort((a, b) => String(b.record_date).localeCompare(String(a.record_date)))
        .slice(0, 4).map((f) => ({ metric: f.metric, label: f.label, value: f.value, unit: f.unit })),
      achievements: filter('achievements', (a) => a.player_id === id).length,
    });
  }
  if (rows.length < 2) fail(403, 'Fewer than two of those athletes are within the teams assigned to you.');

  const common = (rows[0].headline || [])
    .filter((h) => rows.every((r) => (r.headline || []).some((x) => x.key === h.key)))
    .map((h) => ({ key: h.key, label: h.label }));

  return {
    sport: { id: sport.id, code: sport.code, name: sport.name },
    columns: common,
    rows,
    note: "Every figure here is taken from the athlete's own record. Nothing is weighted or ranked — that judgement stays with the selectors.",
  };
});


/* ---- Athlete portal logins (kept apart from staff accounts) ---- */

route('GET', /^\/admin\/athlete-logins$/, () => {
  requirePermission('*');
  const logins = filter('athlete_logins', () => true).map((a) => {
    const p = playerOf(a.player_id) || {};
    return {
      id: a.id, player_id: a.player_id, email: a.email, status: a.status,
      must_change_password: a.must_change_password, last_login_at: a.last_login_at, created_at: a.created_at,
      athlete_id: p.athlete_id, first_name: p.first_name, last_name: p.last_name,
      display_name: p.display_name, photo_url: p.photo_url, player_status: p.status,
    };
  }).sort((a, b) => String(a.first_name).localeCompare(String(b.first_name)));

  const withLogin = new Set(logins.map((l) => l.player_id));
  return {
    logins,
    athletesWithoutLogin: all('players').filter((p) => !withLogin.has(p.id))
      .map((p) => ({ id: p.id, athlete_id: p.athlete_id, first_name: p.first_name, last_name: p.last_name, display_name: p.display_name, email: p.email })),
    total: logins.length,
  };
});

route('POST', /^\/admin\/athlete-logins$/, (_, body) => {
  requirePermission('*');
  const player = playerOf(body.player_id);
  if (!player) fail(404, 'That athlete record does not exist.');
  if (find('athlete_logins', (a) => a.player_id === Number(body.player_id))) {
    fail(409, `${player.first_name} ${player.last_name} already has a portal login. Reset its password instead of creating a second one.`);
  }
  if (find('athlete_logins', (a) => String(a.email).toLowerCase() === String(body.email).toLowerCase())) {
    fail(409, 'Another athlete already uses that email address.');
  }
  if (find('users', (u) => String(u.email).toLowerCase() === String(body.email).toLowerCase())) {
    fail(409, 'That address belongs to a staff account. Athlete logins are kept separate.');
  }

  const words = ['Falcon', 'Summit', 'Harbour', 'Cypress', 'Kestrel', 'Lantern', 'Meridian', 'Quarry'];
  const pick2 = () => words[Math.floor(Math.random() * words.length)];
  const password = body.password || `${pick2()}-${pick2()}-${Math.floor(1000 + Math.random() * 9000)}`;
  const mustChange = body.mustChange !== false;

  const row = {
    id: nextId('athlete_logins'), player_id: Number(body.player_id), email: body.email,
    password_hash: 'demo', status: body.status || 'active',
    must_change_password: mustChange ? 1 : 0, last_login_at: null, is_demo: 0,
    created_by: session.id, created_at: now(), updated_at: now(),
  };
  if (!db.athlete_logins) db.athlete_logins = [];
  db.athlete_logins.push(row);
  athletePasswords[row.id] = password;
  audit('create', 'athlete_logins', row.id, `Athlete portal login created for ${player.athlete_id}`);
  return { id: row.id, password, generated: !body.password, mustChange };
});

route('PUT', /^\/admin\/athlete-logins\/(\d+)$/, (m, body) => {
  requirePermission('*');
  const row = byId('athlete_logins', m[1]);
  if (!row) fail(404, 'That athlete login does not exist.');
  if (body.email) {
    if (find('athlete_logins', (a) => a.id !== row.id && String(a.email).toLowerCase() === String(body.email).toLowerCase())) {
      fail(409, 'Another athlete already uses that email address.');
    }
    if (find('users', (u) => String(u.email).toLowerCase() === String(body.email).toLowerCase())) {
      fail(409, 'That address belongs to a staff account. Athlete logins are kept separate.');
    }
  }
  Object.assign(row, body, { updated_at: now() });
  audit('update', 'athlete_logins', row.id, `Athlete login updated: ${row.email}`);
  return { ok: true };
});

route('POST', /^\/admin\/athlete-logins\/(\d+)\/password$/, (m, body) => {
  requirePermission('*');
  const row = byId('athlete_logins', m[1]);
  if (!row) fail(404, 'That athlete login does not exist.');
  if (body.password !== undefined && String(body.password).length < 8) fail(422, 'Use at least 8 characters.');
  const words = ['Falcon', 'Summit', 'Harbour', 'Cypress', 'Kestrel', 'Lantern'];
  const pick2 = () => words[Math.floor(Math.random() * words.length)];
  const password = body.password || `${pick2()}-${pick2()}-${Math.floor(1000 + Math.random() * 9000)}`;
  athletePasswords[row.id] = password;
  row.must_change_password = body.mustChange !== false ? 1 : 0;
  row.updated_at = now();
  audit('update', 'athlete_logins', row.id, `Athlete password issued for ${row.email}`);
  return { ok: true, password, generated: !body.password, mustChange: !!row.must_change_password };
});

route('DELETE', /^\/admin\/athlete-logins\/(\d+)$/, (m) => {
  requirePermission('*');
  const row = byId('athlete_logins', m[1]);
  if (!row) fail(404, 'That athlete login does not exist.');
  db.athlete_logins = db.athlete_logins.filter((a) => a.id !== row.id);
  audit('delete', 'athlete_logins', row.id, `Athlete portal login removed: ${row.email}`);
  return { ok: true };
});


/* ---- Athlete portal: separate sign-in, own record only ---- */

const athletePasswordFor = (id) => athletePasswords[id] ?? DEMO_PASSWORD;

function requireAthleteSession() {
  if (!athleteSession) fail(401, 'Sign in to continue.');
  return athleteSession;
}

const athleteProfile = (row) => {
  const p = playerOf(row.player_id) || {};
  return {
    id: row.id,
    playerId: row.player_id,
    athleteId: p.athlete_id,
    email: row.email,
    name: p.display_name || `${p.first_name} ${p.last_name}`,
    photoUrl: p.photo_url,
    mustChangePassword: !!row.must_change_password,
    capabilities: ['view own record'],
  };
};

route('POST', /^\/athlete\/login$/, (_, body) => {
  const row = find('athlete_logins', (a) => String(a.email).toLowerCase() === String(body.email || '').toLowerCase());
  if (!row || body.password !== athletePasswordFor(row.id)) fail(401, 'Email or password is incorrect.');
  if (row.status !== 'active') fail(403, 'This account is not active. Speak to the club.');
  row.last_login_at = now();
  athleteSession = row;
  audit('login', 'athlete_logins', row.id, `Athlete signed in: ${row.email}`);
  return { token: `athlete.${row.id}`, athlete: athleteProfile(row) };
});

route('GET', /^\/athlete\/me$/, () => ({ athlete: athleteProfile(requireAthleteSession()) }));

route('POST', /^\/athlete\/change-password$/, (_, body) => {
  const row = requireAthleteSession();
  if (body.currentPassword !== athletePasswordFor(row.id)) fail(400, 'Your current password is incorrect.');
  if (!body.newPassword || body.newPassword.length < 8) fail(422, 'Use at least 8 characters.');
  athletePasswords[row.id] = body.newPassword;
  row.must_change_password = 0;
  audit('update', 'athlete_logins', row.id, 'Athlete changed their password');
  return { ok: true };
});

route('GET', /^\/athlete\/record$/, () => {
  const row = requireAthleteSession();
  const playerId = row.player_id;
  const p = playerOf(playerId);
  if (!p) fail(404, 'That athlete record no longer exists.');

  return {
    athlete: {
      athleteId: p.athlete_id,
      name: p.display_name || `${p.first_name} ${p.last_name}`,
      photoUrl: p.photo_url,
      dob: p.dob,
      nationality: p.nationality,
      status: p.status,
      preferredHand: p.preferred_hand,
      preferredFoot: p.preferred_foot,
      registeredSince: p.registration_date,
    },
    summary: summaryFor(playerId),
    careers: careersFor(playerId).map((c) => ({
      sport: c.sport, matchesPlayed: c.matchesPlayed, headline: c.headline,
      rating: c.rating ? { overall: c.rating.overall } : null,
      career: { groups: c.career.groups },
    })),
    teams: filter('team_memberships', (tm) => tm.player_id === playerId).map((tm) => {
      const t = byId('teams', tm.team_id) || {};
      return {
        id: t.id, name: t.name, age_group: t.age_group, level: t.level,
        sport_name: byId('sports', t.sport_id)?.name,
        role: tm.role, jersey_number: tm.jersey_number,
        start_date: tm.start_date, end_date: tm.end_date,
      };
    }).sort((a, b) => (!!a.end_date - !!b.end_date) || String(b.start_date).localeCompare(String(a.start_date))),
    upcoming: filter('match_players', (mp) => mp.player_id === playerId)
      .map((mp) => byId('matches', mp.match_id))
      .filter((m) => m && String(m.scheduled_at) >= now())
      .map((m) => ({
        id: m.id, scheduled_at: m.scheduled_at, venue: m.venue, opponent_name: m.opponent_name,
        sport_name: byId('sports', m.sport_id)?.name, team_name: teamName(m.home_team_id),
      }))
      .sort((a, b) => String(a.scheduled_at).localeCompare(String(b.scheduled_at))).slice(0, 10),
    sessions: filter('training_attendance', (ta) => ta.player_id === playerId).map((ta) => {
      const ts = byId('training_sessions', ta.session_id) || {};
      return {
        id: ts.id, session_date: ts.session_date, start_time: ts.start_time, title: ts.title,
        training_type: ts.training_type, location: ts.location,
        sport_name: byId('sports', ts.sport_id)?.name, status: ta.status,
      };
    }).sort((a, b) => String(b.session_date).localeCompare(String(a.session_date))).slice(0, 15),
    achievements: filter('achievements', (a) => a.player_id === playerId).map((a) => ({
      title: a.title, category: a.category, level: a.level, awarded_date: a.awarded_date,
      sport_name: byId('sports', a.sport_id)?.name,
    })).sort((a, b) => String(b.awarded_date).localeCompare(String(a.awarded_date))),
    timeline: filter('player_timeline', (t) => t.player_id === playerId)
      .map((t) => ({ event_date: t.event_date, event_type: t.event_type, title: t.title, description: t.description, importance: t.importance }))
      .sort((a, b) => String(b.event_date).localeCompare(String(a.event_date))).slice(0, 40),
  };
});


/* ---- Grounds and bookings (mostly public) ---- */

const toMinute = (value) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(value || '').trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  return h > 23 || min > 59 ? null : h * 60 + min;
};
const toClock = (minute) => `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;

route('GET', /^\/booking\/sports$/, () => ({
  sports: all('sports')
    .filter((sp) => sp.is_active && filter('facility_sports', (fs) => {
      const f = byId('facilities', fs.facility_id);
      return fs.sport_id === sp.id && f && f.is_bookable && f.is_active;
    }).length)
    .map((sp) => ({ id: sp.id, code: sp.code, name: sp.name, color: sp.color }))
    .sort((a, b) => a.id - b.id),
}));

route('GET', /^\/facilities$/, (_, __, query) => ({
  facilities: filter('facilities', (f) => {
    if (!f.is_active) return false;
    if (query.bookable !== 'false' && !f.is_bookable) return false;
    if (query.sport) {
      return filter('facility_sports', (fs) => fs.facility_id === f.id && fs.sport_id === Number(query.sport)).length > 0;
    }
    return true;
  }).map((f) => ({
    ...f,
    sports: filter('facility_sports', (fs) => fs.facility_id === f.id)
      .map((fs) => byId('sports', fs.sport_id))
      .filter(Boolean)
      .map((sp) => ({ id: sp.id, code: sp.code, name: sp.name, color: sp.color })),
  })).sort((a, b) => String(a.kind).localeCompare(String(b.kind)) || a.name.localeCompare(b.name)),
}));

route('GET', /^\/booking\/coaches$/, (_, __, query) => ({
  coaches: filter('coach_specialities', (cs) => {
    if (!cs.bookable) return false;
    if (query.sport) return cs.sport_id === Number(query.sport) || cs.sport_id == null;
    return true;
  }).map((cs) => {
    const c = byId('coaches', cs.coach_id) || {};
    const sp = byId('sports', cs.sport_id);
    return {
      coachId: cs.coach_id, specialityId: cs.id, name: c.full_name, photoUrl: c.photo_url,
      speciality: cs.speciality, yearsExperience: cs.years_experience,
      sport: sp ? { id: sp.id, name: sp.name, color: sp.color } : null,
      hourlyRate: cs.hourly_rate, bio: cs.bio, isPrimary: !!cs.is_primary,
    };
  }).sort((a, b) => b.yearsExperience - a.yearsExperience || String(a.name).localeCompare(String(b.name))),
}));

/** What a ground has free, counting the club's own fixtures and training. */
route('GET', /^\/booking\/availability$/, (_, __, query) => {
  const facility = byId('facilities', Number(query.facility));
  const date = String(query.date || '');
  if (!facility || !/^\d{4}-\d{2}-\d{2}$/.test(date)) fail(422, 'Choose a ground and a date.');

  const opens = toMinute(facility.opens_at) ?? 360;
  const closes = toMinute(facility.closes_at) ?? 1320;
  const step = facility.slot_minutes || 60;

  const busy = [
    ...filter('bookings', (b) => b.facility_id === facility.id && b.booking_date === date && b.status === 'confirmed')
      .map((b) => ({ start: b.start_minute, end: b.end_minute, label: 'Booked' })),
    ...filter('matches', (m) => String(m.scheduled_at).slice(0, 10) === date && m.venue === facility.name)
      .map((m) => {
        const start = toMinute(String(m.scheduled_at).slice(11, 16)) ?? 0;
        return { start, end: start + 180, label: 'Match' };
      }),
    ...filter('training_sessions', (t) => t.session_date === date && t.location === facility.name)
      .map((t) => {
        const start = toMinute(t.start_time || '00:00') ?? 0;
        return { start, end: start + (t.duration_minutes || 90), label: 'Training' };
      }),
  ];

  const now = new Date();
  const isToday = date === now.toISOString().slice(0, 10);
  const minutesNow = now.getHours() * 60 + now.getMinutes();

  const slots = [];
  for (let start = opens; start + step <= closes; start += step) {
    const end = start + step;
    const clash = busy.find((x) => start < x.end && end > x.start);
    const past = isToday && start <= minutesNow;
    slots.push({
      start: toClock(start), end: toClock(end), startMinute: start, endMinute: end,
      available: !clash && !past,
      reason: past ? 'Already passed' : clash ? clash.label : null,
    });
  }

  return {
    facility: { id: facility.id, name: facility.name, kind: facility.kind, slotMinutes: step, hourlyRate: facility.hourly_rate, currency: facility.currency },
    date,
    slots,
    available: slots.filter((s2) => s2.available).length,
  };
});

route('POST', /^\/booking$/, (_, body) => {
  const facility = byId('facilities', body.facility_id);
  if (!facility || !facility.is_bookable || !facility.is_active) fail(404, 'That ground is not available for booking.');

  const start = toMinute(body.start_time);
  const end = toMinute(body.end_time);
  if (start === null || end === null) fail(422, 'Times must look like 17:00.');
  if (end <= start) fail(422, 'The booking has to end after it starts.');
  if (!body.contact_name || String(body.contact_name).trim().length < 2) fail(422, 'Give a name for the booking.');
  if (!body.contact_phone && !body.contact_email) fail(422, 'Leave a phone number or an email so the club can reach you.');

  const opens = toMinute(facility.opens_at) ?? 0;
  const closes = toMinute(facility.closes_at) ?? 1440;
  if (start < opens || end > closes) fail(422, `${facility.name} is open from ${facility.opens_at} to ${facility.closes_at}.`);

  const todayIso = new Date().toISOString().slice(0, 10);
  if (body.booking_date < todayIso) fail(422, 'That date has already passed.');

  const clash = find('bookings', (b) => b.facility_id === facility.id && b.booking_date === body.booking_date
    && b.status === 'confirmed' && start < b.end_minute && end > b.start_minute);
  if (clash) fail(409, 'That slot has just been taken. Please choose another.');

  let coach = null;
  if (body.coach_id) {
    coach = byId('coaches', body.coach_id);
    if (!coach) fail(404, 'That coach is not available.');
    const coachBusy = find('bookings', (b) => b.coach_id === coach.id && b.booking_date === body.booking_date
      && b.status === 'confirmed' && start < b.end_minute && end > b.start_minute);
    if (coachBusy) fail(409, `${coach.full_name} is already booked at that time.`);
  }

  const hours = (end - start) / 60;
  const amount = facility.hourly_rate ? Math.round(facility.hourly_rate * hours * 100) / 100 : null;
  const reference = `BK-${Math.random().toString(16).slice(2, 8).toUpperCase()}`;

  const row = {
    id: nextId('bookings'), reference, facility_id: facility.id,
    sport_id: body.sport_id ?? null, coach_id: body.coach_id ?? null,
    booking_date: body.booking_date, start_time: toClock(start), end_time: toClock(end),
    start_minute: start, end_minute: end,
    booked_by: session ? 'staff' : 'guest', player_id: null, created_by: session?.id ?? null,
    contact_name: body.contact_name, contact_phone: body.contact_phone || null,
    contact_email: body.contact_email || null, party_size: body.party_size ?? null,
    notes: body.notes ?? null, status: 'confirmed', cancelled_at: null, cancel_reason: null,
    amount, currency: facility.currency, is_demo: 0, created_at: now(), updated_at: now(),
  };
  if (!db.bookings) db.bookings = [];
  db.bookings.push(row);
  audit('create', 'bookings', row.id, `Booking ${reference}: ${facility.name} on ${row.booking_date} at ${row.start_time}`);

  return {
    booking: {
      reference, facility: facility.name, date: row.booking_date,
      start: row.start_time, end: row.end_time, coach: coach ? coach.full_name : null,
      amount, currency: row.currency, contactName: row.contact_name,
    },
  };
});

route('GET', /^\/booking\/([A-Za-z0-9-]+)$/, (m) => {
  const row = find('bookings', (b) => String(b.reference).toUpperCase() === String(m[1]).toUpperCase());
  if (!row) fail(404, 'No booking found with that reference.');
  const f = byId('facilities', row.facility_id) || {};
  return {
    booking: {
      reference: row.reference, facility: f.name, where: f.location_note,
      sport: byId('sports', row.sport_id)?.name, coach: byId('coaches', row.coach_id)?.full_name,
      date: row.booking_date, start: row.start_time, end: row.end_time,
      status: row.status, contactName: row.contact_name, amount: row.amount, currency: row.currency,
    },
  };
});

route('POST', /^\/booking\/([A-Za-z0-9-]+)\/cancel$/, (m, body) => {
  const row = find('bookings', (b) => String(b.reference).toUpperCase() === String(m[1]).toUpperCase());
  if (!row) fail(404, 'No booking found with that reference.');
  if (row.status === 'cancelled') fail(409, 'That booking is already cancelled.');
  const given = String(body.contact || '').toLowerCase().replace(/\s/g, '');
  const matches2 = session || [row.contact_phone, row.contact_email].filter(Boolean)
    .some((v) => String(v).toLowerCase().replace(/\s/g, '') === given);
  if (!matches2) fail(403, 'That does not match the contact the booking was made with.');
  row.status = 'cancelled';
  row.cancelled_at = now();
  row.cancel_reason = body.reason ?? null;
  audit('update', 'bookings', row.id, `Booking ${row.reference} cancelled`);
  return { ok: true };
});

route('GET', /^\/bookings$/, (_, __, query) => {
  requireAuth();
  const bookings = filter('bookings', (b) => {
    if (query.date && b.booking_date !== query.date) return false;
    if (query.from && b.booking_date < query.from) return false;
    if (query.facility && b.facility_id !== Number(query.facility)) return false;
    if (query.status && b.status !== query.status) return false;
    return true;
  }).map((b) => ({
    ...b,
    facility_name: byId('facilities', b.facility_id)?.name,
    sport_name: byId('sports', b.sport_id)?.name,
    coach_name: byId('coaches', b.coach_id)?.full_name,
  })).sort((a, b) => String(b.booking_date).localeCompare(String(a.booking_date)) || a.start_minute - b.start_minute);
  const todayIso = new Date().toISOString().slice(0, 10);
  return {
    bookings,
    total: bookings.length,
    upcoming: bookings.filter((b) => b.status === 'confirmed' && b.booking_date >= todayIso).length,
  };
});


/* ---- One module per sport ---- */

route('GET', /^\/sports\/([^/]+)\/workspace$/, (m) => {
  const user = requireAuth();
  // A module is addressed by code, not id — resolveSport handles both.
  const sport = resolveSport(m[1]);
  if (!sport) fail(404, 'That sport does not exist.');

  const teamScope = allowedTeamIds(user);
  const round1 = (n) => (Number.isFinite(n) ? Math.round(n * 10) / 10 : null);

  const teams = filter('teams', (t) => t.sport_id === sport.id && t.is_active
    && (teamScope === null || teamScope.includes(t.id)))
    .map((t) => {
      const played = filter('matches', (x) => x.home_team_id === t.id && x.status === 'completed').length;
      return {
        id: t.id, name: t.name, age_group: t.age_group, level: t.level, is_active: t.is_active,
        squad_size: filter('team_memberships', (tm) => tm.team_id === t.id && !tm.end_date).length,
        played,
        won: filter('matches', (x) => x.home_team_id === t.id && x.result === 'win').length,
      };
    }).sort((a, b) => a.name.localeCompare(b.name));

  const athletes = filter('player_sports', (ps) => ps.sport_id === sport.id)
    .map((ps) => ({ ...playerOf(ps.player_id), position: ps.position, is_primary: ps.is_primary }))
    .filter((p) => p && p.id && inScope(allowedPlayerIds(user), p.id));

  const completed = filter('matches', (x) => x.sport_id === sport.id && x.status === 'completed')
    .sort((a, b) => String(b.scheduled_at).localeCompare(String(a.scheduled_at)));

  const recent = completed.slice(0, 8).map((x) => ({
    id: x.id, scheduled_at: x.scheduled_at, venue: x.venue, opponent_name: x.opponent_name,
    result: x.result, home_score: x.home_score, away_score: x.away_score,
    result_summary: x.result_summary, team_name: teamName(x.home_team_id),
    event_count: filter('match_events', (e) => e.match_id === x.id).length,
  }));

  const upcoming = filter('matches', (x) => x.sport_id === sport.id && String(x.scheduled_at) >= now() && x.status !== 'cancelled')
    .sort((a, b) => String(a.scheduled_at).localeCompare(String(b.scheduled_at)))
    .slice(0, 6)
    .map((x) => ({
      id: x.id, scheduled_at: x.scheduled_at, venue: x.venue,
      opponent_name: x.opponent_name, team_name: teamName(x.home_team_id),
    }));

  const headlineKeys = (sport.config.headline || []).slice(0, 4);
  const careers = athletes.map((p) => {
    const c = playerCareer(p.id, sport);
    return {
      player: {
        id: p.id, athleteId: p.athlete_id, name: p.display_name || `${p.first_name} ${p.last_name}`,
        photoUrl: p.photo_url, position: p.position, status: p.status,
      },
      matches: c.matchesPlayed, values: c.career.values,
    };
  }).filter((c) => c.matches > 0);

  const leaders = headlineKeys.map((h) => {
    const key = typeof h === 'string' ? h : h.key;
    const label = typeof h === 'string' ? key : (h.label || key);
    const lowerIsBetter = /economy|conceded|error/i.test(key);
    const ranked = careers
      .filter((c) => Number.isFinite(Number(c.values[key])))
      .sort((a, b) => (lowerIsBetter
        ? Number(a.values[key]) - Number(b.values[key])
        : Number(b.values[key]) - Number(a.values[key])))
      .slice(0, 5)
      .map((c) => ({ player: c.player, value: Math.round(Number(c.values[key]) * 100) / 100, matches: c.matches }));
    return { key, label, lowerIsBetter, leaders: ranked };
  }).filter((l) => l.leaders.length);

  const scoredIds = [...new Set(filter('match_events', () => true)
    .filter((e) => (byId('matches', e.match_id) || {}).sport_id === sport.id)
    .map((e) => e.match_id))].sort((a, b) => b - a).slice(0, 6);

  const playerMap = new Map(athletes.map((p) => [p.id, p]));
  const analyses = scoredIds.map((id) => {
    const events = filter('match_events', (e) => e.match_id === id)
      .map((e) => ({ ...e, payload: parseJson(e.payload_json, {}) }))
      .sort((a, b) => a.sequence - b.sequence);
    const periods = filter('match_periods', (pp) => pp.match_id === id).sort((a, b) => a.sequence - b.sequence);
    const match = byId('matches', id) || {};
    const analysis = analyseMatch(sport, events, playerMap, periods);
    return {
      matchId: id, scheduledAt: match.scheduled_at, opponent: match.opponent_name,
      periods: analysis.periods.map((pp) => ({
        label: pp.period.label, kind: pp.kind, summary: pp.summary,
        overByOver: pp.overByOver || null, worm: pp.worm || null, phases: pp.phases || null,
        shotMap: pp.shotMap || null, momentum: pp.momentum || null, progression: pp.progression || null,
        reasons: pp.reasons || null, rallyBuckets: pp.rallyBuckets || null, wagonWheel: pp.wagonWheel || null,
      })),
      overall: analysis.overall.summary,
    };
  });

  const tracked = filter('deliveries', (d) => {
    const s2 = byId('tracking_sessions', d.session_id);
    return s2 && s2.sport_id === sport.id;
  }).slice(-900);

  const sessions = filter('training_sessions', (t) => t.sport_id === sport.id);
  const attendance = filter('training_attendance', (ta) => {
    const ts = byId('training_sessions', ta.session_id);
    return ts && ts.sport_id === sport.id;
  });
  const eventsConfig = sport.config.events || {};

  return {
    sport: {
      id: sport.id, code: sport.code, name: sport.name, color: sport.color,
      category: sport.category, description: sport.description,
    },
    presentation: {
      charts: eventsConfig.charts || [],
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
      athletes: athletes.length,
      activeAthletes: athletes.filter((p) => p.status === 'active').length,
      squads: teams.length,
      matchesPlayed: completed.length,
      wins: filter('matches', (x) => x.sport_id === sport.id && x.result === 'win').length,
      scoredBallByBall: scoredIds.length,
      trackedDeliveries: tracked.length,
      trainingSessions: sessions.length,
      attendanceRate: attendance.length
        ? Math.round((attendance.filter((a) => ['present', 'late'].includes(a.status)).length / attendance.length) * 100)
        : null,
      averageIntensity: sessions.length
        ? round1(sessions.reduce((a, t) => a + (t.intensity || 0), 0) / sessions.length)
        : null,
    },
    form: recent.slice(0, 6).map((x) => x.result).filter(Boolean),
    teams,
    leaders,
    recent,
    upcoming,
    analyses,
    tracking: tracked.length ? {
      deliveries: tracked.length,
      speed: track.speedSummary(tracked),
      pitchMap: track.pitchMap(tracked),
      stumpLine: track.stumpLine(tracked),
      consistency: track.consistency(tracked),
      sessions: filter('tracking_sessions', (s2) => s2.sport_id === sport.id).length,
    } : null,
  };
});

/* ---- Training ---- */
route('GET', /^\/training$/, (_, __, query) => {
  requireAuth();
  const scope = allowedTeamIds(session);
  return {
    sessions: filter('training_sessions', (t) => {
      if (t.team_id && !inScope(scope, t.team_id)) return false;
      if (query.sport && t.sport_id !== Number(query.sport)) return false;
      if (query.team && t.team_id !== Number(query.team)) return false;
      if (query.coach && t.coach_id !== Number(query.coach)) return false;
      if (query.type && t.training_type !== query.type) return false;
      if (query.from && t.session_date < query.from) return false;
      if (query.to && t.session_date > query.to) return false;
      return true;
    }).map(sessionRow)
      .sort((a, b) => String(b.session_date).localeCompare(String(a.session_date)))
      .slice(0, Math.min(Number(query.limit) || 100, 500)),
  };
});

route('POST', /^\/training$/, (_, body) => {
  requirePermission('training.write');
  const s = {
    id: nextId('training_sessions'), is_demo: 0, created_by: session.id, created_at: now(), updated_at: now(),
    ...body,
    exercises_json: JSON.stringify(body.exercises || []),
    skills_json: JSON.stringify(body.skills || []),
  };
  delete s.exercises; delete s.skills;
  db.training_sessions.push(s);
  if (s.team_id) {
    filter('team_memberships', (m) => m.team_id === s.team_id && !m.end_date).forEach((m) => {
      db.training_attendance.push({
        id: nextId('training_attendance'), session_id: s.id, player_id: m.player_id,
        status: 'present', arrival_time: null, performance_score: null, effort_score: null,
        coach_notes: null, areas_for_improvement: null,
      });
    });
  }
  audit('create', 'training_sessions', s.id, `Training session on ${s.session_date}`);
  return { session: s };
});

route('PUT', /^\/training\/(\d+)\/attendance$/, (m, body) => {
  requirePermission('training.write');
  const s = byId('training_sessions', m[1]);
  if (!s) fail(404, 'That training session does not exist.');
  for (const a of body.attendance || []) {
    const existing = find('training_attendance', (x) => x.session_id === s.id && x.player_id === a.player_id);
    if (existing) Object.assign(existing, a);
    else db.training_attendance.push({ id: nextId('training_attendance'), session_id: s.id, ...a });
  }
  audit('update', 'training_attendance', s.id, `Attendance recorded for session #${s.id} (${(body.attendance || []).length} athletes)`);
  return { ok: true, saved: (body.attendance || []).length };
});

route('GET', /^\/training\/player\/(\d+)\/summary$/, (m) => {
  requireAuth();
  const rows = filter('training_attendance', (a) => a.player_id === Number(m[1])).map((a) => ({
    ...a, ...(byId('training_sessions', a.session_id) || {}),
  }));
  const attended = rows.filter((r) => r.status === 'present' || r.status === 'late').length;
  const byType = {};
  rows.forEach((r) => { byType[r.training_type] = (byType[r.training_type] || 0) + 1; });
  return {
    sessions: rows.length,
    attended,
    attendanceRate: rows.length ? Math.round((attended / rows.length) * 1000) / 10 : 0,
    minutes: rows.filter((r) => r.status !== 'absent').reduce((a, r) => a + (r.duration_minutes || 0), 0),
    byType,
    trend: rows.filter((r) => r.performance_score != null)
      .sort((a, b) => String(a.session_date).localeCompare(String(b.session_date)))
      .map((r) => ({ date: r.session_date, value: r.performance_score })),
  };
});

route('PUT', /^\/training\/(\d+)$/, (m, body) => {
  requirePermission('training.write');
  const s = byId('training_sessions', m[1]);
  if (!s) fail(404, 'That training session does not exist.');
  const patch = { ...body };
  if ('exercises' in patch) { patch.exercises_json = JSON.stringify(patch.exercises); delete patch.exercises; }
  if ('skills' in patch) { patch.skills_json = JSON.stringify(patch.skills); delete patch.skills; }
  Object.assign(s, patch, { updated_at: now() });
  audit('update', 'training_sessions', s.id, `Training session updated (#${s.id})`);
  return { ok: true };
});

route('GET', /^\/training\/(\d+)$/, (m) => {
  requireAuth();
  const s = byId('training_sessions', m[1]);
  if (!s) fail(404, 'That training session does not exist.');
  return {
    session: {
      ...s,
      sport_name: byId('sports', s.sport_id)?.name,
      sport_code: byId('sports', s.sport_id)?.code,
      team_name: teamName(s.team_id),
      coach_name: coachName(s.coach_id),
      exercises: parseJson(s.exercises_json, []),
      skills: parseJson(s.skills_json, []),
    },
    attendance: filter('training_attendance', (a) => a.session_id === s.id).map((a) => {
      const p = playerOf(a.player_id) || {};
      return {
        ...a, athlete_id: p.athlete_id, first_name: p.first_name, last_name: p.last_name,
        display_name: p.display_name, photo_url: p.photo_url,
      };
    }).sort((a, b) => String(a.last_name).localeCompare(String(b.last_name))),
  };
});

/* ---- Assessments ---- */
route('GET', /^\/assessments\/criteria$/, (_, __, query) => {
  requireAuth();
  return {
    criteria: filter('assessment_criteria', (c) => {
      if (!c.is_active) return false;
      if (query.sport && c.sport_id != null && c.sport_id !== Number(query.sport)) return false;
      if (query.ageGroup && c.age_group != null && c.age_group !== query.ageGroup) return false;
      return true;
    }).map((c) => ({ ...c, sport_name: byId('sports', c.sport_id)?.name }))
      .sort((a, b) => a.category.localeCompare(b.category) || a.sort_order - b.sort_order),
  };
});

route('POST', /^\/assessments\/criteria$/, (_, body) => {
  requirePermission('assessments.write');
  if (body.scale_max <= body.scale_min) fail(422, 'The top of the scale must be above the bottom.');
  const c = { id: nextId('assessment_criteria'), is_active: 1, ...body };
  db.assessment_criteria.push(c);
  audit('create', 'assessment_criteria', c.id, `Assessment criterion added: ${c.name}`);
  return { criteria: c };
});

route('PUT', /^\/assessments\/criteria\/(\d+)$/, (m, body) => {
  requirePermission('assessments.write');
  const c = byId('assessment_criteria', m[1]);
  if (!c) fail(404, 'That criterion does not exist.');
  Object.assign(c, body);
  audit('update', 'assessment_criteria', c.id, `Criterion updated: ${c.name}`);
  return { ok: true };
});

route('GET', /^\/assessments\/player\/(\d+)\/development$/, (m, __, query) => {
  requireAuth();
  guardPlayer(m[1]);
  const assessments = filter('assessments', (a) => a.player_id === Number(m[1])
    && (!query.sport || a.sport_id === Number(query.sport)))
    .map((a) => ({ ...a, sport_name: byId('sports', a.sport_id)?.name, coach_name: coachName(a.assessed_by) }))
    .sort((a, b) => String(a.assessment_date).localeCompare(String(b.assessment_date)));

  const ids = assessments.map((a) => a.id);
  const series = {};
  filter('assessment_scores', (s) => ids.includes(s.assessment_id)).forEach((s) => {
    const criterion = byId('assessment_criteria', s.criteria_id);
    const assessment = byId('assessments', s.assessment_id);
    if (!criterion || !assessment) return;
    if (!series[criterion.key]) {
      series[criterion.key] = {
        key: criterion.key, name: criterion.name, category: criterion.category,
        unit: criterion.unit, scaleMin: criterion.scale_min, scaleMax: criterion.scale_max, points: [],
      };
    }
    series[criterion.key].points.push({ date: assessment.assessment_date, value: s.score, comment: s.comment });
  });

  const criteria = Object.values(series).map((s) => {
    s.points.sort((a, b) => String(a.date).localeCompare(String(b.date)));
    const first = s.points[0]?.value ?? null;
    const latest = s.points[s.points.length - 1]?.value ?? null;
    return { ...s, first, latest, change: first != null && latest != null ? Math.round((latest - first) * 10) / 10 : null };
  });

  return {
    assessments,
    criteria,
    byCategory: ['physical', 'technical', 'tactical', 'behavioural'].map((category) => {
      const items = criteria.filter((c) => c.category === category);
      const latest = items.filter((c) => c.latest != null);
      return {
        category,
        average: latest.length
          ? Math.round((latest.reduce((a, c) => a + (c.latest / c.scaleMax) * 10, 0) / latest.length) * 10) / 10
          : null,
        criteria: items,
      };
    }).filter((c) => c.criteria.length),
    overallTrend: assessments.filter((a) => a.overall_score != null)
      .map((a) => ({ date: a.assessment_date, value: a.overall_score })),
  };
});

route('GET', /^\/assessments$/, (_, __, query) => {
  requireAuth();
  return {
    assessments: filter('assessments', (a) => {
      if (query.player && a.player_id !== Number(query.player)) return false;
      if (query.sport && a.sport_id !== Number(query.sport)) return false;
      if (query.team && a.team_id !== Number(query.team)) return false;
      if (query.coach && a.assessed_by !== Number(query.coach)) return false;
      return true;
    }).map((a) => {
      const p = playerOf(a.player_id) || {};
      const s = byId('sports', a.sport_id);
      return {
        ...a, athlete_id: p.athlete_id, first_name: p.first_name, last_name: p.last_name,
        display_name: p.display_name, photo_url: p.photo_url,
        sport_name: s?.name, color: s?.color, coach_name: coachName(a.assessed_by), team_name: teamName(a.team_id),
      };
    }).sort((a, b) => String(b.assessment_date).localeCompare(String(a.assessment_date)))
      .slice(0, Math.min(Number(query.limit) || 100, 500)),
  };
});

route('POST', /^\/assessments$/, (_, body) => {
  requirePermission('assessments.write');
  const player = playerOf(body.player_id);
  if (!player) fail(404, 'That athlete does not exist.');
  guardPlayer(player.id);
  if (new Date(body.assessment_date) > new Date()) fail(422, 'An assessment cannot be dated in the future.');

  let weighted = 0;
  let weightTotal = 0;
  const problems = [];
  for (const s of body.scores || []) {
    const c = byId('assessment_criteria', s.criteria_id);
    if (!c) { problems.push(`Criterion #${s.criteria_id} does not exist`); continue; }
    if (s.score < c.scale_min || s.score > c.scale_max) {
      problems.push(`${c.name} must be between ${c.scale_min} and ${c.scale_max}`);
      continue;
    }
    const normalised = ((s.score - c.scale_min) / (c.scale_max - c.scale_min)) * 10;
    weighted += (c.higher_is_better ? normalised : 10 - normalised) * c.weight;
    weightTotal += c.weight;
  }
  if (problems.length) fail(422, 'Some scores are outside their scale.', problems);
  const overall = weightTotal ? Math.round((weighted / weightTotal) * 10) / 10 : null;

  const assessment = {
    id: nextId('assessments'), overall_score: overall, is_demo: 0,
    created_by: session.id, created_at: now(), ...body,
  };
  delete assessment.scores;
  db.assessments.push(assessment);
  (body.scores || []).forEach((s) => db.assessment_scores.push({
    id: nextId('assessment_scores'), assessment_id: assessment.id, ...s,
  }));

  addTimeline({
    player_id: player.id, event_date: body.assessment_date, event_type: 'assessment',
    title: `${body.cycle || 'Player'} assessment${overall != null ? ` — ${overall}/10` : ''}`,
    description: body.summary || null, sport_id: body.sport_id,
    ref_table: 'assessments', ref_id: assessment.id,
  });
  audit('create', 'assessments', assessment.id, `Assessment recorded for ${player.athlete_id}`);
  return { assessment };
});

route('GET', /^\/assessments\/(\d+)$/, (m) => {
  requireAuth();
  const a = byId('assessments', m[1]);
  if (!a) fail(404, 'That assessment does not exist.');
  const p = playerOf(a.player_id) || {};
  return {
    assessment: {
      ...a, athlete_id: p.athlete_id, first_name: p.first_name, last_name: p.last_name,
      sport_name: byId('sports', a.sport_id)?.name, coach_name: coachName(a.assessed_by),
    },
    scores: filter('assessment_scores', (s) => s.assessment_id === a.id).map((s) => {
      const c = byId('assessment_criteria', s.criteria_id) || {};
      return { ...s, name: c.name, key: c.key, category: c.category, scale_min: c.scale_min, scale_max: c.scale_max, unit: c.unit, weight: c.weight };
    }),
  };
});

/* ---- Achievements ---- */
route('GET', /^\/achievements$/, (_, __, query) => {
  requireAuth();
  return {
    achievements: filter('achievements', (a) => {
      if (query.player && a.player_id !== Number(query.player)) return false;
      if (query.sport && a.sport_id !== Number(query.sport)) return false;
      if (query.category && a.category !== query.category) return false;
      if (query.tournament && a.tournament_id !== Number(query.tournament)) return false;
      if (query.from && a.awarded_date < query.from) return false;
      return true;
    }).map((a) => {
      const p = playerOf(a.player_id) || {};
      const s = byId('sports', a.sport_id);
      return {
        ...a, athlete_id: p.athlete_id, first_name: p.first_name, last_name: p.last_name,
        display_name: p.display_name, photo_url: p.photo_url,
        sport_name: s?.name, color: s?.color, tournament_name: tournamentName(a.tournament_id), team_name: teamName(a.team_id),
      };
    }).sort((a, b) => String(b.awarded_date).localeCompare(String(a.awarded_date)))
      .slice(0, Math.min(Number(query.limit) || 100, 500)),
  };
});

route('POST', /^\/achievements$/, (_, body) => {
  requirePermission('achievements.write');
  const player = playerOf(body.player_id);
  if (!player) fail(404, 'That athlete does not exist.');
  guardPlayer(player.id);
  if (new Date(body.awarded_date) > new Date()) fail(422, 'An award cannot be dated in the future.');
  const a = { id: nextId('achievements'), is_demo: 0, created_by: session.id, created_at: now(), ...body };
  db.achievements.push(a);
  addTimeline({
    player_id: player.id, event_date: a.awarded_date, event_type: 'achievement',
    title: a.title, description: a.description || null, sport_id: a.sport_id ?? null,
    ref_table: 'achievements', ref_id: a.id, importance: 3,
  });
  audit('create', 'achievements', a.id, `Award recorded for ${player.athlete_id}: ${a.title}`);
  return { achievement: a };
});

route('DELETE', /^\/achievements\/(\d+)$/, (m) => {
  requirePermission('achievements.write');
  const a = byId('achievements', m[1]);
  if (!a) fail(404, 'That award does not exist.');
  db.achievements = db.achievements.filter((x) => x.id !== a.id);
  db.player_timeline = db.player_timeline.filter((t) => !(t.ref_table === 'achievements' && t.ref_id === a.id && t.is_system));
  audit('delete', 'achievements', a.id, `Award removed: ${a.title}`);
  return { ok: true };
});

/* ---- Rankings ---- */
route('GET', /^\/rankings$/, (_, __, query) => {
  requirePermission('rankings.read');
  if (!query.sport) fail(422, 'Choose a sport — statistics from different sports are not comparable.');
  const sport = resolveSport(query.sport);
  if (!sport) fail(404, 'That sport does not exist.');

  const rows = filter('match_performances', (p) => {
    if (p.sport_id !== sport.id) return false;
    const match = byId('matches', p.match_id) || {};
    if (query.season && match.season_id !== Number(query.season)) return false;
    if (query.tournament && match.tournament_id !== Number(query.tournament)) return false;
    if (query.team && p.team_id !== Number(query.team)) return false;
    if (query.ageGroup && !find('team_memberships', (tm) => tm.player_id === p.player_id
      && byId('teams', tm.team_id)?.age_group === query.ageGroup)) return false;
    return true;
  });

  return {
    sport: { id: sport.id, name: sport.name, code: sport.code, color: sport.color },
    boards: leaderboards(sport, rows, Number(query.limit) || 10),
  };
});

/* ---- Reports ---- */
route('GET', /^\/reports\/player\/(\d+)$/, (m) => {
  requirePermission('reports.read');
  guardPlayer(m[1]);
  const id = Number(m[1]);
  const player = playerOf(id);
  if (!player) fail(404, 'That athlete record does not exist.');
  return {
    player,
    summary: summaryFor(id),
    careers: careersFor(id),
    teams: filter('team_memberships', (tm) => tm.player_id === id).map((tm) => {
      const t = byId('teams', tm.team_id) || {};
      return { ...tm, team_name: t.name, age_group: t.age_group, sport_name: byId('sports', t.sport_id)?.name };
    }).sort((a, b) => String(b.start_date).localeCompare(String(a.start_date))),
    achievements: filter('achievements', (a) => a.player_id === id)
      .map((a) => ({ ...a, sport_name: byId('sports', a.sport_id)?.name }))
      .sort((a, b) => String(b.awarded_date).localeCompare(String(a.awarded_date))),
    assessments: filter('assessments', (a) => a.player_id === id)
      .sort((a, b) => String(b.assessment_date).localeCompare(String(a.assessment_date))),
    timeline: filter('player_timeline', (t) => t.player_id === id)
      .sort((a, b) => String(b.event_date).localeCompare(String(a.event_date))),
  };
});

route('GET', /^\/reports\/team\/(\d+)$/, (m) => {
  requirePermission('reports.read');
  const team = byId('teams', m[1]);
  if (!team) fail(404, 'That team does not exist.');
  const sport = sportOf(team.sport_id);
  const matches = filter('matches', (x) => x.home_team_id === team.id || x.away_team_id === team.id).map(matchRow);
  const completed = matches.filter((x) => x.status === 'completed');
  const record = {
    played: completed.length,
    won: completed.filter((x) => x.winner_team_id === team.id).length,
    lost: completed.filter((x) => x.winner_team_id && x.winner_team_id !== team.id).length,
  };
  record.drawn = record.played - record.won - record.lost;
  record.winRate = record.played ? Math.round((record.won / record.played) * 1000) / 10 : 0;

  const sessionIds = filter('training_sessions', (t) => t.team_id === team.id).map((t) => t.id);
  const attendance = filter('training_attendance', (a) => sessionIds.includes(a.session_id));
  const attended = attendance.filter((a) => a.status === 'present' || a.status === 'late').length;

  return {
    team: { ...team, sport_name: sport?.name },
    record,
    players: filter('team_memberships', (tm) => tm.team_id === team.id).map((tm) => {
      const p = playerOf(tm.player_id) || {};
      const career = playerCareer(tm.player_id, sport);
      return {
        playerId: tm.player_id, athleteId: p.athlete_id, name: `${p.first_name} ${p.last_name}`,
        role: tm.role, jersey: tm.jersey_number, active: !tm.end_date,
        matches: career.matchesPlayed, rating: career.rating ? career.rating.overall : null,
        headline: career.headline,
      };
    }),
    matches,
    attendanceRate: attendance.length ? Math.round((attended / attendance.length) * 1000) / 10 : 0,
  };
});

route('GET', /^\/reports\/tournament\/(\d+)$/, (m) => {
  requirePermission('reports.read');
  const t = byId('tournaments', m[1]);
  if (!t) fail(404, 'That tournament does not exist.');
  const sport = sportOf(t.sport_id);
  const matchIds = filter('matches', (x) => x.tournament_id === t.id).map((x) => x.id);
  const grouped = new Map();
  filter('match_performances', (p) => matchIds.includes(p.match_id)).forEach((p) => {
    if (!grouped.has(p.player_id)) grouped.set(p.player_id, []);
    grouped.get(p.player_id).push(parseJson(p.stats_json, {}));
  });

  return {
    tournament: { ...t, sport_name: sport?.name },
    matches: filter('matches', (x) => x.tournament_id === t.id).map(matchRow),
    players: [...grouped.entries()].map(([playerId, stats]) => {
      const p = playerOf(playerId) || {};
      const career = aggregateCareer(sport.config, stats);
      return {
        playerId, athleteId: p.athlete_id, name: `${p.first_name} ${p.last_name}`, matches: stats.length,
        stats: (sport.config.headline || []).map((k) => career.entries.find((e) => e.key === k)).filter(Boolean),
      };
    }),
    awards: filter('achievements', (a) => a.tournament_id === t.id).map((a) => {
      const p = playerOf(a.player_id) || {};
      return { ...a, first_name: p.first_name, last_name: p.last_name, athlete_id: p.athlete_id };
    }),
  };
});

route('GET', /^\/reports\/sport\/(\d+)$/, (m) => {
  requirePermission('reports.read');
  const sport = sportOf(m[1]);
  if (!sport) fail(404, 'That sport does not exist.');
  const positions = {};
  filter('player_sports', (ps) => ps.sport_id === sport.id).forEach((ps) => {
    if (ps.position) positions[ps.position] = (positions[ps.position] || 0) + 1;
  });
  return {
    sport: { ...sport, config_json: undefined },
    teams: filter('teams', (t) => t.sport_id === sport.id).map((t) => ({
      ...t, squad_size: filter('team_memberships', (x) => x.team_id === t.id && !x.end_date).length,
    })),
    players: filter('player_sports', (ps) => ps.sport_id === sport.id).map((ps) => {
      const p = playerOf(ps.player_id) || {};
      return {
        id: p.id, athlete_id: p.athlete_id, first_name: p.first_name, last_name: p.last_name,
        position: ps.position, playing_level: ps.playing_level, status: p.status,
      };
    }).sort((a, b) => String(a.last_name).localeCompare(String(b.last_name))),
    matches: filter('matches', (x) => x.sport_id === sport.id).length,
    tournaments: filter('tournaments', (x) => x.sport_id === sport.id).length,
    positionSplit: Object.entries(positions).map(([position, count]) => ({ position, count })).sort((a, b) => b.count - a.count),
  };
});

route('GET', /^\/reports\/coach\/(\d+)$/, (m) => {
  requirePermission('reports.read');
  const coach = byId('coaches', m[1]);
  if (!coach) fail(404, 'That coach does not exist.');
  const teams = filter('teams', (t) => t.head_coach_id === coach.id);
  const sessions = filter('training_sessions', (t) => t.coach_id === coach.id)
    .sort((a, b) => String(b.session_date).localeCompare(String(a.session_date)));
  const sessionIds = sessions.map((s) => s.id);
  const attendance = filter('training_attendance', (a) => sessionIds.includes(a.session_id));
  const attended = attendance.filter((a) => a.status === 'present' || a.status === 'late').length;
  const players = new Set();
  teams.forEach((t) => filter('team_memberships', (x) => x.team_id === t.id && !x.end_date).forEach((x) => players.add(x.player_id)));
  const assessments = filter('assessments', (a) => a.assessed_by === coach.id).map((a) => {
    const p = playerOf(a.player_id) || {};
    return { ...a, athlete_id: p.athlete_id, first_name: p.first_name, last_name: p.last_name };
  }).sort((a, b) => String(b.assessment_date).localeCompare(String(a.assessment_date)));

  return {
    coach,
    teams,
    players: [...players].map((id) => {
      const p = playerOf(id) || {};
      return { id: p.id, athlete_id: p.athlete_id, first_name: p.first_name, last_name: p.last_name, status: p.status };
    }),
    sessions: sessions.slice(0, 30),
    sessionCount: sessions.length,
    assessments: assessments.slice(0, 30),
    assessmentCount: assessments.length,
    attendanceRate: attendance.length ? Math.round((attended / attendance.length) * 1000) / 10 : 0,
  };
});

/* ---- Media ---- */
route('GET', /^\/media$/, (_, __, query) => {
  requireAuth();
  return {
    media: filter('media', (x) => {
      if (query.player && x.player_id !== Number(query.player)) return false;
      if (query.ownerType && x.owner_type !== query.ownerType) return false;
      if (query.ownerId && x.owner_id !== Number(query.ownerId)) return false;
      if (query.kind && x.kind !== query.kind) return false;
      return true;
    }),
  };
});
route('GET', /^\/media\/documents\/(\d+)$/, (m) => {
  requirePermission('documents.read');
  return { documents: filter('documents', (d) => d.player_id === Number(m[1])) };
});
route('POST', /^\/media$/, () => fail(403, 'File uploads need a server to store the file. Run PlayerArc locally to use media and documents.'));
route('POST', /^\/media\/documents$/, () => fail(403, 'File uploads need a server to store the file. Run PlayerArc locally to use media and documents.'));

/* ---- Administration ---- */
route('GET', /^\/admin\/users$/, () => {
  requirePermission('*');
  return {
    users: all('users').map((u) => {
      const h = hydrateUser(u);
      return {
        id: u.id, email: u.email, full_name: u.full_name, status: u.status, phone: u.phone,
        last_login_at: u.last_login_at, is_demo: u.is_demo, created_at: u.created_at,
        role: h.role, role_name: h.role_name,
        sportIds: h.sportIds, teamIds: h.teamIds, playerIds: h.linkedPlayerIds,
        players: h.linkedPlayerIds.map((id) => {
          const p = playerOf(id) || {};
          return { id: p.id, athlete_id: p.athlete_id, first_name: p.first_name, last_name: p.last_name };
        }),
        coach: find('coaches', (c) => c.user_id === u.id) || null,
      };
    }).sort((a, b) => a.full_name.localeCompare(b.full_name)),
    roles: ROLES.map((r) => ({ ...r, permissions: permissionsFor(r.key) })),
  };
});

route('POST', /^\/admin\/users$/, (_, body) => {
  requirePermission('*');
  const role = find('roles', (r) => r.key === body.role);
  if (!role) fail(422, 'That role does not exist.');
  if (find('users', (u) => u.email.toLowerCase() === String(body.email).toLowerCase())) {
    fail(409, 'A user with that email already exists.');
  }
  const user = {
    id: nextId('users'), email: body.email, full_name: body.full_name, role_id: role.id,
    phone: body.phone ?? null, status: body.status || 'active', avatar_url: null,
    must_change_password: 0, last_login_at: null, is_demo: 0, created_at: now(), updated_at: now(),
  };
  db.users.push(user);
  (body.sportIds || []).forEach((sport_id) => db.user_sport_scopes.push({ user_id: user.id, sport_id }));
  (body.teamIds || []).forEach((team_id) => db.user_team_scopes.push({ user_id: user.id, team_id }));
  (body.playerIds || []).forEach((player_id) => db.user_player_links.push({
    id: nextId('user_player_links'), user_id: user.id, player_id,
    relationship: body.role === 'guardian' ? 'guardian' : 'self', created_at: now(),
  }));
  audit('create', 'users', user.id, `User created: ${user.email} (${body.role})`);
  return { ok: true, id: user.id };
});

route('PUT', /^\/admin\/users\/(\d+)$/, (m, body) => {
  requirePermission('*');
  const user = byId('users', m[1]);
  if (!user) fail(404, 'That user does not exist.');

  // The administrator account keeps its role and stays active, so the club can
  // never lock itself out. Its password and details change as normal.
  const currentRole = byId('roles', user.role_id)?.key;
  if (currentRole === 'super_admin' && body.role && body.role !== 'super_admin') {
    fail(409, 'The administrator role cannot be changed. Promote another account to administrator first, then change this one.');
  }
  if (currentRole === 'super_admin' && body.status && body.status !== 'active') {
    const others = filter('users', (u) => u.id !== user.id && u.status === 'active'
      && byId('roles', u.role_id)?.key === 'super_admin').length;
    if (others === 0) fail(409, 'This is the last active administrator, so it cannot be suspended.');
  }
  if (body.role) {
    const role = find('roles', (r) => r.key === body.role);
    if (!role) fail(422, 'That role does not exist.');
    user.role_id = role.id;
  }
  ['email', 'full_name', 'phone', 'status'].forEach((k) => { if (k in body) user[k] = body[k]; });
  if (body.sportIds) {
    db.user_sport_scopes = db.user_sport_scopes.filter((s) => s.user_id !== user.id);
    body.sportIds.forEach((sport_id) => db.user_sport_scopes.push({ user_id: user.id, sport_id }));
  }
  if (body.teamIds) {
    db.user_team_scopes = db.user_team_scopes.filter((s) => s.user_id !== user.id);
    body.teamIds.forEach((team_id) => db.user_team_scopes.push({ user_id: user.id, team_id }));
  }
  if ('coachId' in body) {
    filter('coaches', (c) => c.user_id === user.id).forEach((c) => { c.user_id = null; });
    if (body.coachId) {
      const coach = byId('coaches', body.coachId);
      if (coach) coach.user_id = user.id;
    }
  }
  user.updated_at = now();
  audit('update', 'users', user.id, `User updated: ${user.email}`);
  return { ok: true };
});

/** Delete a user, with the same two refusals the server applies. */
route('DELETE', /^\/admin\/users\/(\d+)$/, (m) => {
  requirePermission('*');
  const user = byId('users', m[1]);
  if (!user) fail(404, 'That user does not exist.');
  if (user.id === session.id) fail(409, 'You cannot delete the account you are signed in with.');
  const role = byId('roles', user.role_id);
  if (role?.key === 'super_admin') {
    const remaining = filter('users', (u) => u.id !== user.id && u.status === 'active'
      && byId('roles', u.role_id)?.key === 'super_admin').length;
    if (remaining === 0) fail(409, 'This is the last active super admin. Promote another account first.');
  }
  db.users = db.users.filter((u) => u.id !== user.id);
  db.user_sport_scopes = db.user_sport_scopes.filter((x) => x.user_id !== user.id);
  db.user_team_scopes = db.user_team_scopes.filter((x) => x.user_id !== user.id);
  db.user_player_links = db.user_player_links.filter((x) => x.user_id !== user.id);
  audit('delete', 'users', user.id, `User deleted: ${user.email}`);
  return { ok: true };
});

/** Set or generate a password. Returned once, exactly as the server does. */
route('POST', /^\/admin\/users\/(\d+)\/password$/, (m, body) => {
  requirePermission('*');
  const user = byId('users', m[1]);
  if (!user) fail(404, 'That user does not exist.');
  if (body.password !== undefined && String(body.password).length < 8) {
    fail(422, 'Use at least 8 characters.');
  }
  const words = ['Falcon', 'Summit', 'Harbour', 'Cypress', 'Kestrel', 'Lantern', 'Meridian', 'Quarry', 'Thistle', 'Vantage'];
  const pick = () => words[Math.floor(Math.random() * words.length)];
  const password = body.password || `${pick()}-${pick()}-${Math.floor(1000 + Math.random() * 9000)}`;
  const mustChange = body.mustChange !== false;

  passwords[user.id] = password;
  user.must_change_password = mustChange ? 1 : 0;
  audit('update', 'users', user.id, `Password ${body.password ? 'set' : 'generated'} for ${user.email}`);
  return { ok: true, password, mustChange, generated: !body.password };
});

route('GET', /^\/admin\/audit$/, (_, __, query) => {
  requirePermission('audit.read');
  const logs = filter('audit_logs', (l) => {
    if (query.entity && l.entity !== query.entity) return false;
    if (query.action && l.action !== query.action) return false;
    if (query.user && l.user_id !== Number(query.user)) return false;
    if (query.from && l.created_at < query.from) return false;
    return true;
  }).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)) || b.id - a.id);
  return { logs: logs.slice(0, Math.min(Number(query.limit) || 100, 500)), total: logs.length };
});

route('GET', /^\/admin\/settings$/, () => {
  requireAuth();
  const settings = {};
  all('settings').forEach((s) => { settings[s.key] = parseJson(s.value_json, null); });
  return { settings };
});

route('PUT', /^\/admin\/settings\/([^/]+)$/, (m, body) => {
  requirePermission('*');
  const existing = find('settings', (s) => s.key === m[1]);
  if (existing) existing.value_json = JSON.stringify(body.value ?? null);
  else db.settings.push({ key: m[1], value_json: JSON.stringify(body.value ?? null), updated_by: session.id, updated_at: now() });
  audit('update', 'settings', null, `Setting changed: ${m[1]}`);
  return { ok: true };
});

route('POST', /^\/admin\/demo-data\/clear$/, () => {
  requirePermission('*');
  fail(403, 'This build is the demonstration itself — clearing its data would leave nothing to show. Run PlayerArc locally to manage real and demo records separately.');
});

route('GET', /^\/health$/, () => ({ ok: true, platform: 'PlayerArc', mode: 'browser-demo', time: new Date().toISOString() }));

/* ------------------------------------------------------------------ */
/* Dispatch                                                            */
/* ------------------------------------------------------------------ */

/**
 * Answers a request the way the real API would.
 * Resolves to the parsed body, or rejects with { status, message, details }.
 */
export async function demoRequest(method, fullPath, body) {
  const [path, search = ''] = fullPath.split('?');
  const query = Object.fromEntries(new URLSearchParams(search));

  // A little latency keeps loading states visible and honest.
  await new Promise((r) => setTimeout(r, 40));

  for (const r of ROUTES) {
    if (r.method !== method) continue;
    const match = path.match(r.pattern);
    if (match) {
      try {
        return r.handler(match, body || {}, query);
      } catch (err) {
        if (err instanceof DemoError) throw err;
        console.error('[demo]', err);
        throw new DemoError(500, 'Something went wrong in the demo.');
      }
    }
  }
  throw new DemoError(404, `No route matches ${method} ${path}`);
}

/** CSV export, generated in the browser. */
export function demoPlayersCsv() {
  requirePermission('reports.export');
  const columns = [
    ['athlete_id', 'Athlete ID'], ['first_name', 'First name'], ['last_name', 'Last name'],
    ['dob', 'Date of birth'], ['gender', 'Gender'], ['nationality', 'Nationality'],
    ['status', 'Status'], ['registration_date', 'Registered'], ['primary_sport', 'Primary sport'],
    ['current_teams', 'Current teams'], ['matches', 'Matches'], ['awards', 'Awards'],
    ['height_cm', 'Height (cm)'], ['weight_kg', 'Weight (kg)'],
  ];
  const scope = allowedPlayerIds(session);
  const rows = filter('players', (p) => inScope(scope, p.id)).map((p) => {
    const primary = filter('player_sports', (ps) => ps.player_id === p.id).sort((a, b) => b.is_primary - a.is_primary)[0];
    return {
      ...p,
      primary_sport: byId('sports', primary?.sport_id)?.name ?? '',
      current_teams: filter('team_memberships', (m) => m.player_id === p.id && !m.end_date)
        .map((m) => teamName(m.team_id)).join(' | '),
      matches: filter('match_performances', (x) => x.player_id === p.id).length,
      awards: filter('achievements', (x) => x.player_id === p.id).length,
    };
  });
  const esc = (v) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  audit('export', 'players', null, `Exported ${rows.length} athlete records to CSV`);
  return [columns.map(([, l]) => esc(l)).join(','), ...rows.map((r) => columns.map(([k]) => esc(r[k])).join(','))].join('\n');
}

export const resetDemo = reset;
