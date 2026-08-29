/**
 * End-to-end API check.
 * Start the server (npm start) and run: node scripts/smoke-test.mjs
 * Exits non-zero if any check fails.
 */
const BASE = process.env.API || 'http://localhost:4000/api';
let token;

async function req(path, opts = {}) {
  const headers = { ...(opts.headers || {}) };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (opts.body) headers['Content-Type'] = 'application/json';
  const res = await fetch(BASE + path, {
    ...opts,
    headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const ct = res.headers.get('content-type') || '';
  const data = ct.includes('json') ? await res.json() : await res.arrayBuffer();
  return { status: res.status, d: data };
}

const results = [];
const check = async (name, fn) => {
  try {
    results.push([(await fn()) ? 'PASS' : 'FAIL', name]);
  } catch (err) {
    results.push(['ERR ', `${name} → ${err.message}`]);
  }
};

const login = await req('/auth/login', { method: 'POST', body: { email: 'admin@karwansportsclub.com', password: 'Karwan@2026' } });
token = login.d.token;

await check('sign in returns a token', () => !!token);
await check('dashboard totals', async () => (await req('/dashboard')).d.totals.athletes > 0);
await check('sports list', async () => (await req('/sports')).d.sports.length >= 7);
await check('athlete list', async () => (await req('/players?pageSize=5')).d.players.length === 5);
await check('athlete filter options', async () => Array.isArray((await req('/players/filters/options')).d.statuses));

const pid = (await req('/players?pageSize=1')).d.players[0].id;
await check('athlete profile', async () => !!(await req(`/players/${pid}`)).d.player.athlete_id);
await check('athlete career statistics', async () => Array.isArray((await req(`/players/${pid}/stats`)).d.careers));
await check('athlete timeline', async () => (await req(`/players/${pid}/timeline`)).d.events.length > 0);
await check('athlete recent activity', async () => !!(await req(`/players/${pid}/activity`)).d.matches);
await check('athlete development history', async () => (await req(`/assessments/player/${pid}/development`)).status === 200);

const teamId = (await req('/teams')).d.teams[0].id;
await check('team roster', async () => (await req(`/teams/${teamId}`)).d.roster.length > 0);

const tourId = (await req('/tournaments')).d.tournaments[0].id;
await check('tournament detail with leaders', async () => {
  const r = await req(`/tournaments/${tourId}`);
  return r.status === 200 && Array.isArray(r.d.leaders);
});

const matchId = (await req('/matches?status=completed&limit=1')).d.matches[0].id;
await check('match with lineup, scorecard and sport config', async () => {
  const r = await req(`/matches/${matchId}`);
  return r.d.lineup.length > 0 && r.d.performances.length > 0 && !!r.d.sport.config;
});

const sessionId = (await req('/training?limit=1')).d.sessions[0].id;
await check('training session attendance', async () => (await req(`/training/${sessionId}`)).d.attendance.length > 0);
await check('athlete training summary', async () => (await req(`/training/player/${pid}/summary`)).status === 200);
await check('assessments list', async () => (await req('/assessments')).d.assessments.length > 0);
await check('assessment criteria', async () => (await req('/assessments/criteria')).d.criteria.length > 0);
await check('achievements list', async () => (await req('/achievements')).d.achievements.length > 0);

const coachId = (await req('/coaches')).d.coaches[0].id;
await check('coaches list', async () => (await req('/coaches')).d.coaches.length > 0);
await check('coach detail', async () => (await req(`/coaches/${coachId}`)).status === 200);

await check('cricket leaderboards', async () => (await req('/rankings?sport=cricket')).d.boards.length > 0);
await check('rankings refuse cross-sport comparison', async () => (await req('/rankings')).status === 422);
await check('global search', async () => (await req('/search?q=Kar')).status === 200);

await check('player report', async () => (await req(`/reports/player/${pid}`)).d.summary !== undefined);
await check('team report', async () => (await req(`/reports/team/${teamId}`)).d.record !== undefined);
await check('tournament report', async () => (await req(`/reports/tournament/${tourId}`)).status === 200);
await check('sport report', async () => (await req('/reports/sport/1')).status === 200);
await check('coach report', async () => (await req(`/reports/coach/${coachId}`)).status === 200);

await check('user administration', async () => (await req('/admin/users')).d.users.length > 0);
await check('audit log', async () => (await req('/admin/audit')).d.logs.length > 0);
await check('role matrix', async () => (await req('/auth/roles')).d.roles.length === 8);
await check('settings', async () => (await req('/admin/settings')).status === 200);

await check('CSV export', async () => {
  const r = await fetch(`${BASE}/export/players.csv`, { headers: { Authorization: `Bearer ${token}` } });
  return r.ok && (await r.text()).includes('Athlete ID');
});
await check('Excel export', async () => {
  const r = await fetch(`${BASE}/export/players.xlsx`, { headers: { Authorization: `Bearer ${token}` } });
  return r.ok && (await r.arrayBuffer()).byteLength > 5000;
});
await check('PDF career report', async () => {
  const r = await fetch(`${BASE}/export/player/${pid}.pdf`, { headers: { Authorization: `Bearer ${token}` } });
  return r.ok && (await r.arrayBuffer()).byteLength > 1000;
});

/* ---- Permission and scope enforcement ---- */
const adminToken = token;
const coachLogin = await req('/auth/login', { method: 'POST', body: { email: 'coach.cricket@karwansportsclub.com', password: 'Karwan@2026' } });
token = coachLogin.d.token;
const coachPlayers = await req('/players?pageSize=100');
const allPlayers = (() => { token = adminToken; return req('/players?pageSize=100'); })();
token = coachLogin.d.token;

await check('coach sees only assigned athletes', async () => {
  const all = await allPlayers;
  return coachPlayers.d.total > 0 && coachPlayers.d.total < all.d.total;
});
await check('coach cannot register athletes', async () => {
  const r = await req('/players', { method: 'POST', body: { first_name: 'Should', last_name: 'Fail' } });
  return r.status === 403;
});
await check('contact details redacted for coach', () => coachPlayers.d.players[0]._redacted === true);

const playerLogin = await req('/auth/login', { method: 'POST', body: { email: 'player@karwansportsclub.com', password: 'Karwan@2026' } });
token = playerLogin.d.token;
await check('player sees only their own record', async () => (await req('/players?pageSize=50')).d.total === 1);

token = adminToken;

/* ---- Data integrity rules ---- */
await check('duplicate athlete registration rejected', async () => {
  const existing = (await req('/players?pageSize=1')).d.players[0];
  const r = await req('/players', {
    method: 'POST',
    body: { first_name: existing.first_name, last_name: existing.last_name, dob: existing.dob },
  });
  return r.status === 409;
});
await check('impossible statistics rejected', async () => {
  const r = await req(`/matches/${matchId}/performances`, {
    method: 'PUT',
    body: { performances: [{ player_id: pid, stats: { runs: 500, balls_faced: 1 } }] },
  });
  return r.status === 422 || r.status === 403;
});
await check('unauthenticated request refused', async () => {
  const r = await fetch(`${BASE}/players`);
  return r.status === 401;
});

/* ---- User management ---- */
let newUserId;
await check('create a user', async () => {
  const r = await req('/admin/users', {
    method: 'POST',
    body: { full_name: 'Test Coach', email: 'test.coach@karwansportsclub.com', password: 'Temporary123', role: 'coach', teamIds: [teamId] },
  });
  newUserId = r.d.id;
  return r.status === 201 && !!newUserId;
});
await check('new user can sign in', async () => {
  const r = await req('/auth/login', { method: 'POST', body: { email: 'test.coach@karwansportsclub.com', password: 'Temporary123' } });
  return r.status === 200 && r.d.user.role === 'coach';
});
await check('generate a password, returned once', async () => {
  const r = await req(`/admin/users/${newUserId}/password`, { method: 'POST', body: { mustChange: true } });
  return r.status === 200 && r.d.generated === true && r.d.password.length > 8 && r.d.mustChange === true;
});
await check('generated password works and forces a change', async () => {
  const gen = await req(`/admin/users/${newUserId}/password`, { method: 'POST', body: { mustChange: true } });
  const login = await req('/auth/login', { method: 'POST', body: { email: 'test.coach@karwansportsclub.com', password: gen.d.password } });
  return login.status === 200 && login.d.user.mustChangePassword === true;
});
await check('set a chosen password', async () => {
  const r = await req(`/admin/users/${newUserId}/password`, { method: 'POST', body: { password: 'ChosenPass123', mustChange: false } });
  const login = await req('/auth/login', { method: 'POST', body: { email: 'test.coach@karwansportsclub.com', password: 'ChosenPass123' } });
  return r.d.generated === false && login.status === 200 && login.d.user.mustChangePassword === false;
});
await check('short passwords refused', async () => {
  const r = await req(`/admin/users/${newUserId}/password`, { method: 'POST', body: { password: 'short' } });
  return r.status === 422;
});
await check('no endpoint ever returns a stored password', async () => {
  const list = await req('/admin/users');
  return !JSON.stringify(list.d).includes('password_hash') && !JSON.stringify(list.d).match(/"password"/);
});
await check('cannot delete your own account', async () => {
  const me = (await req('/admin/users')).d.users.find((u) => u.email === 'admin@karwansportsclub.com');
  const r = await req(`/admin/users/${me.id}`, { method: 'DELETE' });
  return r.status === 409;
});
await check('delete a user', async () => (await req(`/admin/users/${newUserId}`, { method: 'DELETE' })).status === 200);
await check('non-admin cannot manage users', async () => {
  token = coachLogin.d.token;
  const r = await req('/admin/users');
  token = adminToken;
  return r.status === 403;
});

/* ---- Athlete assignments ---- */
await check('assign a coach to an athlete', async () => {
  const r = await req(`/players/${pid}/staff`, { method: 'POST', body: { coach_id: coachId, role: 'personal_trainer' } });
  return r.status === 201;
});
await check('duplicate staff assignment refused', async () => {
  const r = await req(`/players/${pid}/staff`, { method: 'POST', body: { coach_id: coachId, role: 'personal_trainer' } });
  return r.status === 409;
});
await check('staff appears on the athlete profile', async () => {
  const r = await req(`/players/${pid}`);
  return Array.isArray(r.d.staff) && r.d.staff.some((x) => x.role === 'personal_trainer');
});
await check('end a staff assignment without deleting it', async () => {
  const profile = await req(`/players/${pid}`);
  const assignment = profile.d.staff.find((x) => !x.end_date);
  const r = await req(`/players/${pid}/staff/${assignment.id}`, { method: 'PUT', body: { end_date: new Date().toISOString().slice(0, 10) } });
  const after = await req(`/players/${pid}`);
  return r.status === 200 && after.d.staff.some((x) => x.id === assignment.id && x.end_date);
});

/* ---- Single page app is served ---- */
const origin = BASE.replace('/api', '');
await check('web app served at /', async () => {
  const r = await fetch(origin);
  return r.ok && (await r.text()).includes('PlayerArc');
});
await check('deep links served', async () => (await fetch(`${origin}/players/1`)).ok);

console.log(results.map(([s, n]) => `${s}  ${n}`).join('\n'));
const passed = results.filter((r) => r[0] === 'PASS').length;
console.log(`\n${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
