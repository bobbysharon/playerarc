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

export const DEMO_PASSWORD = 'Karwan@2026';

/* ------------------------------------------------------------------ */
/* Store                                                               */
/* ------------------------------------------------------------------ */

let db = null;
let session = null;

function reset() {
  db = JSON.parse(JSON.stringify(dataset));
  if (!db.audit_logs) db.audit_logs = [];
  session = null;
}
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
  if (!row || body.password !== DEMO_PASSWORD) {
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
  requireAuth();
  if (body.currentPassword !== DEMO_PASSWORD) fail(400, 'Current password is incorrect.');
  fail(403, 'Passwords cannot be changed in the browser demo — this build has no server to store them. Run PlayerArc locally to use this.');
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
  user.updated_at = now();
  audit('update', 'users', user.id, `User updated: ${user.email}`);
  return { ok: true };
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
