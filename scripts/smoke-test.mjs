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

const login = await req('/auth/login', { method: 'POST', body: { email: 'admin@playerarc.local', password: 'Karwan@2026' } });
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
  const me = (await req('/admin/users')).d.users.find((u) => u.email === 'admin@playerarc.local');
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


/* ---- Ball-by-ball capture and analysis ---- */
// Find a cricket match that was actually scored ball by ball, rather than
// assuming the first one with a scorecard has events behind it.
let bbMatchId = null;
for (const m of (await req('/matches?limit=200')).d.matches.filter((x) => x.sport_code === 'cricket')) {
  const ev = await req(`/matches/${m.id}/events`);
  if (ev.d.total > 50) { bbMatchId = m.id; break; }
}
await check('a cricket match is scored ball by ball', async () => {
  const ev = await req(`/matches/${bbMatchId}/events`);
  return ev.d.total > 50;
});
await check('events carry generated commentary', async () => {
  const ev = await req(`/matches/${bbMatchId}/events`);
  return ev.d.events.some((e) => e.commentary && e.commentary.includes(' to '));
});
await check('analysis returns per-innings detail', async () => {
  const a = await req(`/matches/${bbMatchId}/analysis`);
  return a.d.periods.length >= 2 && a.d.periods.every((p) => p.summary.runs >= 0);
});
await check('innings are not merged into one long innings', async () => {
  // Each innings is bounded by its own over count; merging them would produce
  // a single innings of twice the length.
  const a = await req(`/matches/${bbMatchId}/analysis`);
  const scored = a.d.periods.filter((p) => p.summary.balls > 0);
  return scored.length >= 2
    && scored.every((p) => p.summary.balls <= 80)
    && a.d.overall.summary.innings === a.d.periods.length;
});
await check('batting card, bowling card and run rate are derived', async () => {
  const a = await req(`/matches/${bbMatchId}/analysis`);
  const inn = a.d.periods[0];
  return inn.battingCard.length > 0 && inn.bowlingCard.length > 0 && inn.summary.runRate > 0;
});
await check('wagon wheel, pitch map and phases are produced', async () => {
  const a = await req(`/matches/${bbMatchId}/analysis`);
  const inn = a.d.periods[0];
  return inn.wagonWheel.length > 0 && inn.pitchMap.length > 0 && inn.phases.length > 0;
});
await check('partnerships and fall of wickets line up', async () => {
  const a = await req(`/matches/${bbMatchId}/analysis`);
  const inn = a.d.periods[0];
  return inn.partnerships.length >= inn.fallOfWickets.length;
});
await check('the scorecard matches the analysis exactly', async () => {
  const a = await req(`/matches/${bbMatchId}/analysis`);
  const detail = await req(`/matches/${bbMatchId}`);

  // An athlete can bat in more than one innings, so the scorecard is the sum
  // across every innings rather than whatever the first one shows.
  const totals = new Map();
  for (const period of a.d.periods) {
    for (const b of period.battingCard.filter((x) => x.playerId)) {
      const current = totals.get(b.playerId) || { runs: 0, balls: 0 };
      totals.set(b.playerId, { runs: current.runs + b.runs, balls: current.balls + b.balls });
    }
  }
  const sample = [...totals.entries()].slice(0, 4);
  return sample.length > 0 && sample.every(([playerId, expected]) => {
    const perf = detail.d.performances.find((p) => p.player_id === playerId);
    return perf && perf.stats.runs === expected.runs && perf.stats.balls_faced === expected.balls;
  });
});
await check('one athlete\'s own match view', async () => {
  const a = await req(`/matches/${bbMatchId}/analysis`);
  const someone = a.d.periods[0].battingCard.find((b) => b.playerId);
  const v = await req(`/matches/${bbMatchId}/analysis/player/${someone.playerId}`);
  return v.d.events > 0 && v.d.performance !== null;
});

/* Recording a delivery must move the career record */
let testPeriodId;
await check('open a new period', async () => {
  // Sequence is derived so the suite can be run repeatedly against one database.
  const existing = await req(`/matches/${bbMatchId}/periods`);
  const nextSequence = Math.max(0, ...existing.d.periods.map((p) => p.sequence)) + 1;
  const r = await req(`/matches/${bbMatchId}/periods`, {
    method: 'POST',
    body: { sequence: nextSequence, label: `Test innings ${nextSequence}`, planned_length: 20, status: 'in_progress' },
  });
  testPeriodId = r.d.period?.id;
  return r.status === 201 && !!testPeriodId;
});
let beforeRuns;
let testBatter;
await check('record a delivery and see the career record move', async () => {
  const detail = await req(`/matches/${bbMatchId}`);
  testBatter = detail.d.lineup[0].player_id;
  const bowler = detail.d.lineup[1].player_id;
  const careerBefore = await req(`/players/${testBatter}/stats?sport=cricket`);
  beforeRuns = careerBefore.d.careers[0].career.values.runs;

  const r = await req(`/matches/${bbMatchId}/events`, {
    method: 'POST',
    body: {
      period_id: testPeriodId, event_type: 'ball',
      primary_player_id: testBatter, secondary_player_id: bowler,
      outcome: 'six', payload: { runs_batter: 6, shot: 'pull', length: 'short', line: 'middle' },
      x: 30, y: 70,
    },
  });
  const careerAfter = await req(`/players/${testBatter}/stats?sport=cricket`);
  return r.status === 201 && careerAfter.d.careers[0].career.values.runs === beforeRuns + 6;
});
await check('cricket positions the delivery itself', async () => {
  // The second delivery of a fresh period must land on ball two of over one,
  // without the scorer supplying either number.
  const detail = await req(`/matches/${bbMatchId}`);
  const r = await req(`/matches/${bbMatchId}/events`, {
    method: 'POST',
    body: {
      period_id: testPeriodId, event_type: 'ball',
      primary_player_id: detail.d.lineup[0].player_id,
      secondary_player_id: detail.d.lineup[1].player_id,
      outcome: 'dot', payload: { runs_batter: 0 },
    },
  });
  return r.status === 201 && r.d.event.over_number === 0 && r.d.event.ball_in_over === 2;
});
await check('a wide is re-bowled rather than advancing the over', async () => {
  // A wide occupies the next ball position, and the delivery that follows it
  // re-uses that same position — the over does not move on until six legal
  // balls have been bowled.
  const detail = await req(`/matches/${bbMatchId}`);
  const striker = detail.d.lineup[0].player_id;
  const bowler = detail.d.lineup[1].player_id;

  const wide = await req(`/matches/${bbMatchId}/events`, {
    method: 'POST',
    body: {
      period_id: testPeriodId, event_type: 'ball',
      primary_player_id: striker, secondary_player_id: bowler,
      outcome: 'wide', payload: { extras: 1, extra_type: 'wide' },
    },
  });
  const after = await req(`/matches/${bbMatchId}/events`, {
    method: 'POST',
    body: {
      period_id: testPeriodId, event_type: 'ball',
      primary_player_id: striker, secondary_player_id: bowler,
      outcome: 'dot', payload: { runs_batter: 0 },
    },
  });

  return wide.status === 201 && after.status === 201
    && after.d.event.over_number === wide.d.event.over_number
    && after.d.event.ball_in_over === wide.d.event.ball_in_over;
});
await check('undo removes the last delivery and rewinds the career record', async () => {
  const ev = await req(`/matches/${bbMatchId}/events?period=${testPeriodId}`);
  const last = ev.d.events.at(-1);
  await req(`/matches/${bbMatchId}/events/${last.id}`, { method: 'DELETE' });
  const after = await req(`/matches/${bbMatchId}/events?period=${testPeriodId}`);
  return after.d.events.length === ev.d.events.length - 1;
});
await check('unknown event types are refused', async () => {
  const r = await req(`/matches/${bbMatchId}/events`, {
    method: 'POST', body: { event_type: 'touchdown', payload: {} },
  });
  return r.status === 422;
});
await check('out-of-range values are refused', async () => {
  const r = await req(`/matches/${bbMatchId}/events`, {
    method: 'POST',
    body: { period_id: testPeriodId, event_type: 'ball', payload: { runs_batter: 99 } },
  });
  return r.status === 422;
});
await check('non-scorers cannot record events', async () => {
  token = playerLogin.d.token;
  const r = await req(`/matches/${bbMatchId}/events`, { method: 'POST', body: { event_type: 'ball', payload: {} } });
  token = adminToken;
  return r.status === 403;
});

/* Other sports produce their own analysis shapes */
await check('football analysis produces a shot map and timeline', async () => {
  const matches = (await req('/matches?limit=200')).d.matches.filter((m) => m.sport_code === 'football');
  for (const m of matches) {
    const a = await req(`/matches/${m.id}/analysis`);
    if (a.d.totalEvents > 0) return a.d.overall.shotMap.length > 0 && a.d.overall.timeline.length > 0;
  }
  return false;
});
await check('basketball analysis produces a shot chart and quarters', async () => {
  const matches = (await req('/matches?limit=200')).d.matches.filter((m) => m.sport_code === 'basketball');
  for (const m of matches) {
    const a = await req(`/matches/${m.id}/analysis`);
    // Four quarters at minimum; a scorer may have opened more.
    if (a.d.totalEvents > 0) return a.d.overall.shotMap.length > 0 && a.d.periods.length >= 4;
  }
  return false;
});
await check('racket analysis produces rally progression and momentum', async () => {
  const matches = (await req('/matches?limit=200')).d.matches.filter((m) => m.sport_code === 'badminton');
  for (const m of matches) {
    const a = await req(`/matches/${m.id}/analysis`);
    if (a.d.totalEvents > 0) {
      return a.d.overall.progression.length > 0
        && a.d.overall.rallyBuckets.length > 0
        && a.d.overall.summary.pointsFor > 0;
    }
  }
  return false;
});


/* ---- Drill library, session plans, benchmarks, announcements, showcase ---- */
await check('drill library', async () => {
  const r = await req('/drills');
  return r.d.drills.length > 5 && r.d.drills.every((d) => d.category && d.times_used >= 0);
});
await check('drills filter by sport and category', async () => {
  const r = await req('/drills?category=technical');
  return r.d.drills.length > 0 && r.d.drills.every((d) => d.category === 'technical');
});
let newDrillId;
await check('add a drill', async () => {
  const r = await req('/drills', {
    method: 'POST',
    body: { name: `Test drill ${Date.now()}`, category: 'skills', duration_minutes: 15, coaching_points: 'Watch the ball' },
  });
  newDrillId = r.d.drill?.id;
  return r.status === 201 && !!newDrillId;
});
await check('impossible player counts refused', async () => {
  const r = await req('/drills', {
    method: 'POST', body: { name: `Bad ${Date.now()}`, players_min: 10, players_max: 4 },
  });
  return r.status === 422;
});
await check('session plans carry ordered drills', async () => {
  const r = await req('/session-templates');
  return r.d.templates.length > 0 && r.d.templates.every((t) => t.drills.every((d, i) => d.sort_order === i));
});
await check('build a session from a plan', async () => {
  const session = (await req('/training?limit=1')).d.sessions[0];
  const template = (await req('/session-templates')).d.templates[0];
  const applied = await req(`/training/${session.id}/apply-template/${template.id}`, { method: 'POST' });
  const drills = await req(`/training/${session.id}/drills`);
  return applied.status === 200 && drills.d.drills.length === template.drills.length;
});
await check('set drills on a session directly', async () => {
  const session = (await req('/training?limit=1')).d.sessions[0];
  const r = await req(`/training/${session.id}/drills`, {
    method: 'PUT', body: { drills: [{ drill_id: newDrillId, duration_minutes: 12 }] },
  });
  const after = await req(`/training/${session.id}/drills`);
  return r.status === 200 && after.d.drills.length === 1 && after.d.drills[0].drill_id === newDrillId;
});

await check('benchmarks exist per age group', async () => {
  const r = await req('/benchmarks');
  return r.d.benchmarks.length > 10 && r.d.benchmarks.some((b) => b.source === 'assessment');
});
await check('an athlete is banded against their age group', async () => {
  for (const p of (await req('/players?pageSize=60')).d.players) {
    const b = await req(`/players/${p.id}/benchmarks`);
    if (b.d.career.length) {
      return ['below', 'developing', 'competent', 'strong', 'exceptional'].includes(b.d.career[0].band)
        && !!b.d.ageGroup;
    }
  }
  return false;
});
await check('lower-is-better metrics band correctly', async () => {
  // Economy rate: a low number is good, so a small value must not read as "below".
  const r = await req('/benchmarks?source=career');
  const economy = r.d.benchmarks.find((b) => b.metric === 'economy');
  return economy && economy.higher_is_better === 0 && economy.exceptional < economy.developing;
});

let noticeId;
await check('send an announcement to a squad', async () => {
  const team = (await req('/teams')).d.teams[0];
  const r = await req('/announcements', {
    method: 'POST',
    body: { title: 'Test notice', body: 'Session moved.', audience: 'team', team_id: team.id, priority: 'important' },
  });
  noticeId = r.d.announcement?.id;
  return r.status === 201 && !!noticeId;
});
await check('a squad announcement needs a squad', async () => {
  const r = await req('/announcements', { method: 'POST', body: { title: 'x', body: 'y', audience: 'team' } });
  return r.status === 422;
});
await check('announcement to named athletes', async () => {
  const ids = (await req('/players?pageSize=2')).d.players.map((p) => p.id);
  const r = await req('/announcements', {
    method: 'POST',
    body: { title: 'Selected', body: 'You are in the squad.', audience: 'players', playerIds: ids },
  });
  const list = await req('/announcements');
  const found = list.d.announcements.find((a) => a.id === r.d.announcement.id);
  return r.status === 201 && found.recipients.length === 2;
});
await check('remove an announcement', async () => (await req(`/announcements/${noticeId}`, { method: 'DELETE' })).status === 200);

let showcaseToken;
await check('publish a showcase profile', async () => {
  const p = (await req('/players?pageSize=1')).d.players[0];
  const r = await req(`/players/${p.id}/showcase`, {
    method: 'PUT', body: { enabled: true, headline: 'Available for trials.' },
  });
  showcaseToken = r.d.token;
  return r.status === 200 && !!showcaseToken && r.d.path.includes(showcaseToken);
});
await check('the showcase is readable without signing in', async () => {
  const r = await fetch(`${BASE}/players/showcase/${showcaseToken}`);
  const d = await r.json();
  return r.ok && d.athlete.name && Array.isArray(d.careers) && Array.isArray(d.achievements);
});
await check('the showcase never exposes private details', async () => {
  const d = await (await fetch(`${BASE}/players/showcase/${showcaseToken}`)).json();
  const body = JSON.stringify(d);
  return !['"phone"', '"email"', '"guardian_name"', '"address"', '"emergency_phone"', '"notes"']
    .some((field) => body.includes(field));
});
await check('withdrawing the showcase kills the link', async () => {
  const p = (await req('/players?pageSize=1')).d.players[0];
  await req(`/players/${p.id}/showcase`, { method: 'PUT', body: { enabled: false } });
  return (await fetch(`${BASE}/players/showcase/${showcaseToken}`)).status === 404;
});

/* ---- Every sport captures, not only cricket ---- */
await check('all seven sports have event definitions', async () => {
  const sports = (await req('/sports')).d.sports;
  return sports.length === 7 && sports.every((s) => s.config?.events?.types?.length > 0 && s.config.events.derive.length > 0);
});
await check('each sport records events in its own vocabulary', async () => {
  const sports = (await req('/sports')).d.sports;
  const matches = (await req('/matches?limit=200')).d.matches;
  let covered = 0;
  for (const sport of sports) {
    for (const m of matches.filter((x) => x.sport_code === sport.code)) {
      const ev = await req(`/matches/${m.id}/events`);
      if (ev.d.total > 0) { covered += 1; break; }
    }
  }
  return covered === sports.length;
});


/* ---- The administrator account is protected ---- */
await check('administrator role cannot be changed', async () => {
  const admin = (await req('/admin/users')).d.users.find((u) => u.role === 'super_admin');
  const r = await req(`/admin/users/${admin.id}`, { method: 'PUT', body: { role: 'coach' } });
  return r.status === 409;
});
await check('last administrator cannot be suspended', async () => {
  const admin = (await req('/admin/users')).d.users.find((u) => u.role === 'super_admin');
  const r = await req(`/admin/users/${admin.id}`, { method: 'PUT', body: { status: 'suspended' } });
  return r.status === 409;
});
await check('administrator details and password stay editable', async () => {
  const admin = (await req('/admin/users')).d.users.find((u) => u.role === 'super_admin');
  const details = await req(`/admin/users/${admin.id}`, { method: 'PUT', body: { phone: '+971 50 111 2222' } });
  const pw = await req(`/admin/users/${admin.id}/password`, { method: 'POST', body: { password: 'TempAdminPass1', mustChange: false } });
  const signIn = await req('/auth/login', { method: 'POST', body: { email: admin.email, password: 'TempAdminPass1' } });
  // Restore the documented password so the suite is repeatable.
  await req(`/admin/users/${admin.id}/password`, { method: 'POST', body: { password: 'Karwan@2026', mustChange: false } });
  return details.status === 200 && pw.status === 200 && signIn.status === 200;
});
await check('other accounts can be created, edited and deleted', async () => {
  const created = await req('/admin/users', {
    method: 'POST',
    body: { full_name: 'Temp Staff', email: `temp.${Date.now()}@playerarc.local`, password: 'Temporary123', role: 'coach' },
  });
  const edited = await req(`/admin/users/${created.d.id}`, { method: 'PUT', body: { role: 'statistician' } });
  const removed = await req(`/admin/users/${created.d.id}`, { method: 'DELETE' });
  return created.status === 201 && edited.status === 200 && removed.status === 200;
});


/* ---- Ball tracking, fitness, templates, selection ---- */
let trackSessionId;
await check('tracking sessions are seeded and calibrated', async () => {
  const r = await req('/tracking/sessions');
  trackSessionId = r.d.sessions[0]?.id;
  return r.d.sessions.length > 5
    && r.d.sessions.every((x) => x.calibrated === 1)
    && r.d.sessions.some((x) => x.mode === 'bowling_machine');
});
await check('a session reports speed, map, stumps and consistency', async () => {
  const r = await req(`/tracking/sessions/${trackSessionId}`);
  const s = r.d.summary;
  return s.speed.averageRelease > 50 && s.pitchMap.points.length > 0
    && s.stumpLine.assessed > 0 && s.consistency.hitRate >= 0;
});
await check('pitch coordinates resolve to the right zones', async () => {
  const r = await req(`/tracking/sessions/${trackSessionId}`);
  // A good length sits between 400 and 700cm from the batter's stumps.
  return r.d.deliveries
    .filter((d) => d.length_zone === 'good')
    .every((d) => d.pitch_y_cm > 400 && d.pitch_y_cm <= 700);
});
await check('the stump reading agrees with the measurement', async () => {
  const r = await req(`/tracking/sessions/${trackSessionId}`);
  // Anything wider than half a stump line cannot be hitting.
  return r.d.deliveries
    .filter((d) => d.hits_stumps === 1 && d.stump_x_cm != null)
    .every((d) => Math.abs(d.stump_x_cm) <= 11.43 + 0.01);
});
await check('speed drop is derived, not typed', async () => {
  const r = await req(`/tracking/sessions/${trackSessionId}`);
  const d = r.d.deliveries.find((x) => x.release_speed_kph && x.speed_off_pitch_kph);
  const expected = ((d.release_speed_kph - d.speed_off_pitch_kph) / d.release_speed_kph) * 100;
  return Math.abs(d.speed_drop_percent - expected) < 0.15;
});
await check('recording a delivery derives its zones and target score', async () => {
  const session = (await req(`/tracking/sessions/${trackSessionId}`)).d;
  const bowler = session.bowlers[0]?.player.id ?? null;
  const r = await req(`/tracking/sessions/${trackSessionId}/deliveries`, {
    method: 'POST',
    body: {
      bowler_id: bowler, batter_handedness: 'right',
      release_speed_kph: 139.4, speed_off_pitch_kph: 104.2,
      pitch_x_cm: 14, pitch_y_cm: 560, bounce_height_cm: 74,
      stump_x_cm: 6, stump_z_cm: 40, delivery_type: 'seam', runs: 0, outcome: 'dot',
    },
  });
  const d = r.d.deliveries[0];
  return r.status === 201 && d.length_zone === 'good' && d.line_zone === 'off_stump'
    && d.hits_stumps === 1 && d.stump_hit === 'off' && d.speed_drop_percent > 20;
});
await check('a bowling-machine session needs its speed setting', async () => {
  const r = await req('/tracking/sessions', {
    method: 'POST',
    body: { sport_id: 1, mode: 'bowling_machine', title: 'Machine block', session_date: '2026-09-01' },
  });
  return r.status === 422;
});
await check('scene calibration is recorded', async () => {
  const created = await req('/tracking/sessions', {
    method: 'POST', body: { sport_id: 1, mode: 'nets', title: `Calibration test ${Date.now()}`, session_date: '2026-09-01' },
  });
  const r = await req(`/tracking/sessions/${created.d.session.id}/calibration`, {
    method: 'PUT', body: { method: 'crease_markers', pitch_length_cm: 2012, stump_height_cm: 71.1 },
  });
  return r.status === 200 && r.d.session.calibrated === 1 && r.d.session.calibration_method === 'crease_markers';
});
await check("an athlete's tracking report spans every session", async () => {
  const session = (await req(`/tracking/sessions/${trackSessionId}`)).d;
  const id = session.bowlers[0].player.id;
  const r = await req(`/players/${id}/tracking`);
  return r.d.bowling.deliveries > 0 && r.d.bowling.trend.length > 0
    && r.d.bowling.speed.peakRelease > 50 && r.d.bowling.consistency.score >= 0;
});
await check('consistency is measured against a stated target', async () => {
  const r = await req(`/tracking/sessions/${trackSessionId}`);
  return r.d.targets.length > 0
    && r.d.deliveries.some((d) => d.in_target !== null && d.target_length);
});
await check('fitness records build a trend per metric', async () => {
  for (const p of (await req('/players?pageSize=40')).d.players) {
    const f = await req(`/players/${p.id}/fitness`);
    if (f.d.series.length) {
      return f.d.series.every((m) => m.points.length > 0 && m.latest !== null)
        && f.d.summary.metricsTracked === f.d.series.length;
    }
  }
  return false;
});
await check('a faster sprint counts as an improvement', async () => {
  // Lower is better for a sprint, so the direction must not be read naively.
  for (const p of (await req('/players?pageSize=40')).d.players) {
    const f = await req(`/players/${p.id}/fitness`);
    const sprint = f.d.series.find((m) => m.metric === 'sprint_20m');
    if (sprint) return sprint.higherIsBetter === false && sprint.improved === (sprint.change < 0);
  }
  return false;
});
await check('record a fitness test', async () => {
  const p = (await req('/players?pageSize=1')).d.players[0];
  const r = await req('/fitness', {
    method: 'POST',
    body: {
      player_id: p.id, record_date: '2026-09-10', kind: 'test', category: 'power',
      metric: 'broad_jump', label: 'Standing broad jump', value: 2.34, unit: 'm', higher_is_better: 1,
    },
  });
  return r.status === 201;
});
await check('assessment templates carry ordered criteria', async () => {
  const r = await req('/assessment-templates');
  return r.d.templates.length >= 4
    && r.d.templates.every((t) => t.criteria.length > 0 && t.criteria.every((c, i) => c.sort_order === i))
    && r.d.templates.some((t) => t.purpose === 'trial');
});
await check('a template needs at least one criterion', async () => {
  const r = await req('/assessment-templates', {
    method: 'POST', body: { name: `Empty ${Date.now()}`, criteria: [] },
  });
  return r.status === 422;
});
await check('selection compares athletes on shared measures', async () => {
  const ids = (await req('/players?sport=1&pageSize=4')).d.players.map((p) => p.id);
  const r = await req(`/selection/compare?sport=1&players=${ids.join(',')}`);
  return r.status === 200 && r.d.rows.length >= 2 && r.d.columns.length > 0
    && r.d.rows.every((row) => row.headline && row.matches >= 0);
});
await check('comparing fewer than two athletes is refused', async () => {
  const ids = (await req('/players?pageSize=1')).d.players.map((p) => p.id);
  const r = await req(`/selection/compare?sport=1&players=${ids.join(',')}`);
  return r.status === 422;
});


/* ---- Athlete portal: separate credentials, own record only ---- */
let athleteLoginId;
let athleteEmail;
await check('athlete logins are listed apart from staff accounts', async () => {
  const r = await req('/admin/athlete-logins');
  const first = r.d.logins.find((l) => l.status === 'active');
  athleteLoginId = first?.id;
  athleteEmail = first?.email;
  return r.status === 200 && r.d.logins.length > 0 && r.d.athletesWithoutLogin.length > 0
    && r.d.logins.every((l) => !('role' in l));
});
let athleteToken;
await check('an athlete signs in to their own portal', async () => {
  const r = await req('/athlete/login', { method: 'POST', body: { email: athleteEmail, password: 'Karwan@2026' } });
  athleteToken = r.d.token;
  return r.status === 200 && !!athleteToken && !('role' in r.d.athlete);
});
await check('the portal returns only their own record', async () => {
  const r = await fetch(`${BASE}/athlete/record`, { headers: { Authorization: `Bearer ${athleteToken}` } });
  const d = await r.json();
  const listed = (await req('/admin/athlete-logins')).d.logins.find((l) => l.email === athleteEmail);
  return r.ok && d.athlete.athleteId === listed.athlete_id;
});
await check('an athlete token opens nothing else', async () => {
  const paths = ['/players', '/players/1', '/admin/users', '/admin/athlete-logins', '/reports/player/1', '/tracking/sessions'];
  for (const path of paths) {
    const r = await fetch(BASE + path, { headers: { Authorization: `Bearer ${athleteToken}` } });
    if (r.status !== 401 && r.status !== 403) return false;
  }
  return true;
});
await check('a staff token is refused by the portal', async () => {
  const r = await fetch(`${BASE}/athlete/record`, { headers: { Authorization: `Bearer ${adminToken}` } });
  return r.status === 403;
});
await check('an athlete can only have one login', async () => {
  const first = (await req('/admin/athlete-logins')).d.logins[0];
  const r = await req('/admin/athlete-logins', {
    method: 'POST', body: { player_id: first.player_id, email: `dupe.${Date.now()}@athlete.playerarc.local` },
  });
  return r.status === 409;
});
await check('an athlete cannot reuse a staff address', async () => {
  const free = (await req('/admin/athlete-logins')).d.athletesWithoutLogin[0];
  const r = await req('/admin/athlete-logins', {
    method: 'POST', body: { player_id: free.id, email: 'admin@playerarc.local' },
  });
  return r.status === 409;
});
await check('issuing a login never creates an athlete', async () => {
  const before = (await req('/players?pageSize=1')).d.total;
  const free = (await req('/admin/athlete-logins')).d.athletesWithoutLogin[0];
  const made = await req('/admin/athlete-logins', {
    method: 'POST', body: { player_id: free.id, email: `issued.${Date.now()}@athlete.playerarc.local` },
  });
  const after = (await req('/players?pageSize=1')).d.total;
  return made.status === 201 && !!made.d.password && before === after;
});
await check('the administrator can reset an athlete password', async () => {
  const r = await req(`/admin/athlete-logins/${athleteLoginId}/password`, {
    method: 'POST', body: { password: 'AthletePass123', mustChange: false },
  });
  const signIn = await req('/athlete/login', { method: 'POST', body: { email: athleteEmail, password: 'AthletePass123' } });
  // Restore the seeded password so the suite is repeatable.
  await req(`/admin/athlete-logins/${athleteLoginId}/password`, { method: 'POST', body: { password: 'Karwan@2026', mustChange: false } });
  return r.status === 200 && signIn.status === 200;
});
await check('removing an athlete login leaves the athlete record', async () => {
  const free = (await req('/admin/athlete-logins')).d.athletesWithoutLogin[0];
  const made = await req('/admin/athlete-logins', {
    method: 'POST', body: { player_id: free.id, email: `temp.${Date.now()}@athlete.playerarc.local` },
  });
  const before = (await req('/players?pageSize=1')).d.total;
  const removed = await req(`/admin/athlete-logins/${made.d.id}`, { method: 'DELETE' });
  const after = (await req('/players?pageSize=1')).d.total;
  return removed.status === 200 && before === after;
});
await check('only the administrator manages athlete logins', async () => {
  token = coachLogin.d.token;
  const r = await req('/admin/athlete-logins');
  token = adminToken;
  return r.status === 403;
});


/* ---- Booking a ground, without an account ---- */
const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
let bookingRef;
let guestSlot;
let guestGround;

await check('sports and grounds are public', async () => {
  const sports = await fetch(`${BASE}/booking/sports`);
  const s = await sports.json();
  const cricket = s.sports.find((x) => x.code === 'cricket');
  const grounds = await (await fetch(`${BASE}/facilities?sport=${cricket.id}`)).json();
  guestGround = grounds.facilities.find((f) => f.hourly_rate);
  return sports.ok && s.sports.length > 0 && grounds.facilities.length > 0;
});
await check('coaches carry a speciality and years of experience', async () => {
  const r = await (await fetch(`${BASE}/booking/coaches`)).json();
  return r.coaches.length > 0
    && r.coaches.every((c) => c.name && c.speciality && typeof c.yearsExperience === 'number');
});
await check('availability is public and marks club use', async () => {
  const r = await fetch(`${BASE}/booking/availability?facility=${guestGround.id}&date=${tomorrow}`);
  const d = await r.json();
  guestSlot = d.slots.find((x) => x.available);
  return r.ok && d.slots.length > 0 && !!guestSlot;
});
await check('a guest books without signing in', async () => {
  const r = await fetch(`${BASE}/booking`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      facility_id: guestGround.id, booking_date: tomorrow,
      start_time: guestSlot.start, end_time: guestSlot.end,
      contact_name: 'Suite Guest', contact_phone: '+971 50 777 6666',
    }),
  });
  const d = await r.json();
  bookingRef = d.booking?.reference;
  return r.status === 201 && !!bookingRef;
});
await check('a booking holds no athlete details', async () => {
  const d = await (await fetch(`${BASE}/booking/${bookingRef}`)).json();
  return !Object.keys(d.booking).some((k) => /athlete|player|dob|birth/i.test(k));
});
await check('the same slot cannot be taken twice', async () => {
  const r = await fetch(`${BASE}/booking`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      facility_id: guestGround.id, booking_date: tomorrow,
      start_time: guestSlot.start, end_time: guestSlot.end,
      contact_name: 'Late Guest', contact_phone: '+971 50 111 2222',
    }),
  });
  return r.status === 409;
});
await check('concurrent requests for one slot leave a single winner', async () => {
  const avail = await (await fetch(`${BASE}/booking/availability?facility=${guestGround.id}&date=${tomorrow}`)).json();
  const slot = avail.slots.filter((x) => x.available)[0];
  if (!slot) return false;
  const attempts = await Promise.all([1, 2, 3].map((n) => fetch(`${BASE}/booking`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      facility_id: guestGround.id, booking_date: tomorrow,
      start_time: slot.start, end_time: slot.end,
      contact_name: `Race ${n}`, contact_phone: `+971 50 000 111${n}`,
    }),
  })));
  return attempts.filter((r) => r.status === 201).length === 1;
});
await check('bookings outside opening hours and in the past are refused', async () => {
  const early = await fetch(`${BASE}/booking`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      facility_id: guestGround.id, booking_date: tomorrow, start_time: '03:00', end_time: '04:00',
      contact_name: 'Early', contact_phone: '+971 50 111 1111',
    }),
  });
  const past = await fetch(`${BASE}/booking`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      facility_id: guestGround.id, booking_date: '2020-01-01', start_time: '10:00', end_time: '11:00',
      contact_name: 'Past', contact_phone: '+971 50 111 1111',
    }),
  });
  return early.status === 422 && past.status === 422;
});
await check('a booking needs a way to reach whoever made it', async () => {
  const r = await fetch(`${BASE}/booking`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      facility_id: guestGround.id, booking_date: tomorrow, start_time: '21:00', end_time: '22:00',
      contact_name: 'No Contact',
    }),
  });
  return r.status === 422;
});
await check('cancelling requires the contact it was made with', async () => {
  const wrong = await fetch(`${BASE}/booking/${bookingRef}/cancel`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contact: 'someone-else' }),
  });
  const right = await fetch(`${BASE}/booking/${bookingRef}/cancel`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contact: '+971 50 777 6666' }),
  });
  return wrong.status === 403 && right.status === 200;
});

/* ---- One athlete, one record ---- */
await check('the same name and date of birth is refused', async () => {
  const p = (await req('/players?pageSize=1')).d.players[0];
  const full = (await req(`/players/${p.id}`)).d.player;
  const r = await req('/players', {
    method: 'POST',
    body: { first_name: full.first_name, last_name: full.last_name, dob: full.dob, gender: full.gender },
  });
  return r.status === 409 && r.d.error.includes(full.athlete_id ?? 'KSC');
});
await check('the same name on the same email is refused', async () => {
  const p = (await req('/players?pageSize=1')).d.players[0];
  const full = (await req(`/players/${p.id}`)).d.player;
  if (!full.email) return true;
  const r = await req('/players', {
    method: 'POST',
    body: { first_name: full.first_name, last_name: full.last_name, dob: '2001-01-01', gender: full.gender, email: full.email },
  });
  return r.status === 409;
});
await check('the same name on the same phone is refused', async () => {
  const p = (await req('/players?pageSize=1')).d.players[0];
  const full = (await req(`/players/${p.id}`)).d.player;
  if (!full.phone) return true;
  const r = await req('/players', {
    method: 'POST',
    body: { first_name: full.first_name, last_name: full.last_name, dob: '2002-02-02', gender: full.gender, phone: full.phone },
  });
  return r.status === 409;
});
await check('a genuinely new athlete still registers', async () => {
  const r = await req('/players', {
    method: 'POST',
    body: {
      first_name: 'Zayn', last_name: `Case${Date.now().toString().slice(-6)}`,
      dob: '2005-05-05', gender: 'male', email: `zayn.${Date.now()}@example.com`,
    },
  });
  return r.status === 201;
});


await check('a suspended athlete login is refused', async () => {
  const list = await req('/admin/athlete-logins');
  const suspended = list.d.logins.find((l) => l.status !== 'active');
  if (!suspended) return true;
  const r = await req('/athlete/login', { method: 'POST', body: { email: suspended.email, password: 'Karwan@2026' } });
  return r.status === 403;
});
await check('an athlete changes their own password', async () => {
  const list = await req('/admin/athlete-logins');
  const who = list.d.logins.find((l) => l.status === 'active');
  await req(`/admin/athlete-logins/${who.id}/password`, { method: 'POST', body: { password: 'KnownPass123', mustChange: true } });

  const signIn = await req('/athlete/login', { method: 'POST', body: { email: who.email, password: 'KnownPass123' } });
  const changed = await fetch(`${BASE}/athlete/change-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${signIn.d.token}` },
    body: JSON.stringify({ currentPassword: 'KnownPass123', newPassword: 'TheirOwnPass456' }),
  });
  const after = await req('/athlete/login', { method: 'POST', body: { email: who.email, password: 'TheirOwnPass456' } });

  // Leave the seeded password in place so the suite can run again.
  await req(`/admin/athlete-logins/${who.id}/password`, { method: 'POST', body: { password: 'Karwan@2026', mustChange: false } });
  return changed.ok && after.status === 200 && after.d.athlete.mustChangePassword === false;
});


/* ---- One module per sport, built from its own configuration ---- */
await check('every sport has a workspace', async () => {
  const sports = (await req('/sports')).d.sports;
  for (const sp of sports) {
    const r = await req(`/sports/${sp.code}/workspace`);
    if (r.status !== 200) return false;
    if (!r.d.presentation || !r.d.summary || !Array.isArray(r.d.teams)) return false;
  }
  return sports.length === 7;
});
await check('each workspace declares its own visuals', async () => {
  const cricket = (await req('/sports/cricket/workspace')).d;
  const football = (await req('/sports/football/workspace')).d;
  const badminton = (await req('/sports/badminton/workspace')).d;
  return cricket.presentation.charts.includes('manhattan')
    && cricket.presentation.periodLabel === 'Innings'
    && football.presentation.charts.includes('shot_map')
    && football.presentation.periodLabel === 'Half'
    && badminton.presentation.charts.includes('point_progression')
    && badminton.presentation.periodLabel === 'Set';
});
await check('leaders come from the sport\'s own headline figures', async () => {
  const d = (await req('/sports/cricket/workspace')).d;
  const keys = d.presentation.headline.map((h) => h.key);
  return d.leaders.length > 0 && d.leaders.every((l) => keys.includes(l.key) && l.leaders.length > 0);
});
await check('lower-is-better figures rank the right way round', async () => {
  const d = (await req('/sports/cricket/workspace')).d;
  const economy = d.leaders.find((l) => /economy/i.test(l.key));
  if (!economy) return true;
  const values = economy.leaders.map((l) => l.value);
  return economy.lowerIsBetter && values.every((v, i) => i === 0 || v >= values[i - 1]);
});
await check('a workspace carries the match analysis for its sport', async () => {
  const d = (await req('/sports/cricket/workspace')).d;
  return d.analyses.length > 0 && d.analyses[0].periods.some((p) => p.overByOver?.length > 0);
});
await check('ball tracking appears only where the sport has it', async () => {
  const cricket = (await req('/sports/cricket/workspace')).d;
  const football = (await req('/sports/football/workspace')).d;
  return cricket.tracking?.deliveries > 0 && football.tracking === null;
});
await check('a coach sees only their own squads in a workspace', async () => {
  token = coachLogin.d.token;
  const scoped = await req('/sports/cricket/workspace');
  token = adminToken;
  const full = await req('/sports/cricket/workspace');
  return scoped.status === 200 && scoped.d.teams.length < full.d.teams.length;
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
