'use strict';
/**
 * Seed data.
 *
 * Creates the system roles, assessment criteria and sport definitions that the
 * platform needs to run, then — unless SEED_DEMO=false — a demonstration club:
 * athletes across several sports, teams with real history, tournaments,
 * matches with per-player statistics, training attendance, assessments and
 * awards. Every demo record carries is_demo = 1, so Settings → Clear demo data
 * removes the sample club and leaves genuine records untouched.
 *
 * Run:  npm run db:reset   (migrate --fresh, then seed)
 */
const bcrypt = require('bcryptjs');
const { db, tx } = require('./index');
const config = require('../config');
const { ROLES } = require('../lib/permissions');
const { SPORTS } = require('../lib/sport-configs');
const { computeMatchRating } = require('../lib/stats-engine');
const timeline = require('../lib/timeline');

const DEMO = config.seedDemo;
const today = new Date();
const iso = (d) => d.toISOString().slice(0, 10);
const daysAgo = (n) => iso(new Date(today.getTime() - n * 86400000));
const daysAhead = (n) => iso(new Date(today.getTime() + n * 86400000));

// Deterministic pseudo-random so reseeding gives the same demo club.
let seedState = 20260828;
function rnd() {
  seedState = (seedState * 1664525 + 1013904223) % 4294967296;
  return seedState / 4294967296;
}
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const int = (min, max) => Math.floor(rnd() * (max - min + 1)) + min;
const chance = (p) => rnd() < p;

async function main() {
  console.log('[seed] starting');

  /* ---- Roles ------------------------------------------------------- */
  const roleStmt = db.prepare('INSERT OR IGNORE INTO roles (key, name, description, rank) VALUES (?,?,?,?)');
  tx(() => ROLES.forEach((r) => roleStmt.run(r.key, r.name, r.description, r.rank)));
  const roleId = (key) => db.prepare('SELECT id FROM roles WHERE key = ?').get(key).id;

  /* ---- Sports ------------------------------------------------------ */
  const sportStmt = db.prepare(`
    INSERT INTO sports (code, name, category, color, icon, sort_order, config_json)
    VALUES (@code, @name, @category, @color, @icon, @sort_order, @config_json)
    ON CONFLICT(code) DO UPDATE SET config_json = excluded.config_json, updated_at = datetime('now')
  `);
  tx(() => SPORTS.forEach((s) => sportStmt.run({
    code: s.code,
    name: s.name,
    category: s.config.category,
    color: s.config.color,
    icon: s.icon,
    sort_order: s.sort_order,
    config_json: JSON.stringify(s.config),
  })));
  const sportId = (code) => db.prepare('SELECT id FROM sports WHERE code = ?').get(code).id;
  console.log(`[seed] ${SPORTS.length} sports configured`);

  /* ---- Assessment criteria ----------------------------------------- */
  const criteria = [
    // Applies to every sport
    ['speed', 'Speed', 'physical', null, 'Sprint and acceleration over short distances'],
    ['strength', 'Strength', 'physical', null, 'Functional strength for the demands of the sport'],
    ['endurance', 'Endurance', 'physical', null, 'Ability to sustain output across a full match'],
    ['agility', 'Agility', 'physical', null, 'Change of direction and body control'],
    ['fitness', 'General fitness', 'physical', null, 'Overall conditioning against age-group benchmarks'],
    ['tactical_awareness', 'Tactical awareness', 'tactical', null, 'Reading the game and positioning'],
    ['decision_making', 'Decision making', 'tactical', null, 'Choosing the right option under pressure'],
    ['game_awareness', 'Game awareness', 'tactical', null, 'Understanding match situation and tempo'],
    ['discipline', 'Discipline', 'behavioural', null, 'Punctuality, conduct and following instructions'],
    ['teamwork', 'Teamwork', 'behavioural', null, 'Contribution to the group'],
    ['attitude', 'Attitude', 'behavioural', null, 'Response to coaching and setbacks'],
    ['commitment', 'Commitment', 'behavioural', null, 'Attendance and effort in training'],
    // Sport specific technical criteria
    ['batting_technique', 'Batting technique', 'technical', 'cricket', 'Stance, footwork and shot selection'],
    ['bowling_action', 'Bowling action', 'technical', 'cricket', 'Repeatability, rhythm and control'],
    ['fielding_skill', 'Fielding', 'technical', 'cricket', 'Catching, ground fielding and throwing'],
    ['ball_control', 'Ball control', 'technical', 'football', 'First touch and close control'],
    ['passing_range', 'Passing range', 'technical', 'football', 'Accuracy over short and long distances'],
    ['finishing', 'Finishing', 'technical', 'football', 'Composure and technique in front of goal'],
    ['shooting_form', 'Shooting form', 'technical', 'basketball', 'Mechanics and consistency of release'],
    ['ball_handling', 'Ball handling', 'technical', 'basketball', 'Dribbling under pressure'],
    ['defensive_stance', 'Defensive stance', 'technical', 'basketball', 'Footwork and positioning on defence'],
    ['smash_technique', 'Smash technique', 'technical', 'badminton', 'Power and placement of the smash'],
    ['footwork_court', 'Court footwork', 'technical', 'badminton', 'Movement to and recovery from all corners'],
    ['serve_technique', 'Serve', 'technical', 'table_tennis', 'Variation, spin and placement'],
    ['rally_consistency', 'Rally consistency', 'technical', 'table_tennis', 'Error rate in extended rallies'],
  ];
  const critStmt = db.prepare(`
    INSERT OR IGNORE INTO assessment_criteria (key, name, category, sport_id, description, scale_min, scale_max, weight, sort_order)
    VALUES (?,?,?,?,?,0,10,1,?)
  `);
  tx(() => criteria.forEach(([key, name, category, sportCode, description], i) => {
    critStmt.run(key, name, category, sportCode ? sportId(sportCode) : null, description, i * 10);
  }));
  console.log(`[seed] ${criteria.length} assessment criteria configured`);

  /* ---- Seasons ----------------------------------------------------- */
  const seasonStmt = db.prepare('INSERT OR IGNORE INTO seasons (name, sport_id, start_date, end_date, is_current) VALUES (?,?,?,?,?)');
  tx(() => {
    seasonStmt.run('2023–24', null, '2023-09-01', '2024-06-30', 0);
    seasonStmt.run('2024–25', null, '2024-09-01', '2025-06-30', 0);
    seasonStmt.run('2025–26', null, '2025-09-01', '2026-06-30', 1);
  });
  const currentSeason = db.prepare('SELECT id FROM seasons WHERE is_current = 1').get().id;
  const lastSeason = db.prepare(`SELECT id FROM seasons WHERE name = '2024–25'`).get().id;

  /* ---- Settings ---------------------------------------------------- */
  const setting = db.prepare(`INSERT OR REPLACE INTO settings (key, value_json) VALUES (?,?)`);
  tx(() => {
    setting.run('club', JSON.stringify({
      name: config.club.name,
      shortName: config.club.shortName,
      athleteIdPrefix: config.club.athleteIdPrefix,
      established: '1953',
      location: 'Karwan, Hyderabad',
    }));
    setting.run('platform', JSON.stringify({ name: 'PlayerArc', tagline: 'One athlete. Every sport. The whole journey.' }));
  });

  if (!DEMO) {
    await seedAdminOnly();
    console.log('[seed] complete (core data only — SEED_DEMO=false)');
    return;
  }

  /* ================================================================== */
  /* Demonstration club                                                 */
  /* ================================================================== */
  const hash = await bcrypt.hash('Karwan@2026', 10);
  const userStmt = db.prepare(`
    INSERT OR IGNORE INTO users (email, password_hash, full_name, role_id, phone, status, is_demo)
    VALUES (?,?,?,?,?,'active',?)
  `);

  const accounts = [
    ['admin@playerarc.local', 'Bobby Sharon', 'super_admin', 0],
    ['director@karwansportsclub.com', 'Nadia Farooqui', 'sports_director', 1],
    ['cricket.admin@karwansportsclub.com', 'Imran Qureshi', 'sport_admin', 1],
    ['coach.cricket@karwansportsclub.com', 'Yusuf Baig', 'coach', 1],
    ['coach.football@karwansportsclub.com', 'Daniel Okafor', 'coach', 1],
    ['coach.academy@karwansportsclub.com', 'Priya Menon', 'coach', 1],
    ['stats@karwansportsclub.com', 'Sana Iqbal', 'statistician', 1],
    ['player@karwansportsclub.com', 'Arun Prasad', 'player', 1],
    ['parent@karwansportsclub.com', 'Meera Prasad', 'guardian', 1],
  ];
  tx(() => accounts.forEach(([email, name, role, demo]) => userStmt.run(email, hash, name, roleId(role), '+971 50 000 0000', demo)));
  const userId = (email) => db.prepare('SELECT id FROM users WHERE email = ?').get(email).id;

  /* ---- Coaches ----------------------------------------------------- */
  const coachRows = [
    ['Yusuf Baig', 'cricket', 'head_coach', 'ECB Level 3 · 14 years coaching', 'coach.cricket@karwansportsclub.com'],
    ['Imran Qureshi', 'cricket', 'assistant_coach', 'ECB Level 2 · Spin specialist', null],
    ['Daniel Okafor', 'football', 'head_coach', 'UEFA B Licence', 'coach.football@karwansportsclub.com'],
    ['Priya Menon', 'football', 'academy_coach', 'AFC C Licence · Youth development', 'coach.academy@karwansportsclub.com'],
    ['Marcus Fernandes', 'basketball', 'head_coach', 'FIBA Level 2', null],
    ['Lakshmi Rao', 'badminton', 'head_coach', 'BWF Level 2', null],
    ['Wei Chen', 'table_tennis', 'head_coach', 'ITTF Level 2', null],
    ['Omar Haddad', null, 'fitness_trainer', 'NSCA CSCS · Strength & conditioning', null],
  ];
  const coachStmt = db.prepare(`
    INSERT INTO coaches (full_name, sport_id, role, qualification, user_id, joined_date, phone, email, is_demo)
    VALUES (?,?,?,?,?,?,?,?,1)
  `);
  tx(() => coachRows.forEach(([name, sport, role, qual, email]) => {
    coachStmt.run(name, sport ? sportId(sport) : null, role, qual, email ? userId(email) : null,
      daysAgo(int(400, 2000)), '+971 50 000 0000', email || `${name.split(' ')[0].toLowerCase()}@karwansportsclub.com`);
  }));
  const coachId = (name) => db.prepare('SELECT id FROM coaches WHERE full_name = ?').get(name).id;

  /* ---- Teams (with history across seasons) -------------------------- */
  const teamRows = [
    ['Karwan Cricket Senior XI', 'KCS', 'cricket', 'Senior', 'senior', currentSeason, 'Yusuf Baig'],
    ['Karwan Cricket U18', 'KCU18', 'cricket', 'U18', 'development', currentSeason, 'Imran Qureshi'],
    ['Karwan Cricket U16', 'KCU16', 'cricket', 'U16', 'academy', currentSeason, 'Imran Qureshi'],
    ['Karwan Cricket U18 (2024–25)', 'KCU18-24', 'cricket', 'U18', 'development', lastSeason, 'Imran Qureshi'],
    ['Karwan FC Senior', 'KFC', 'football', 'Senior', 'senior', currentSeason, 'Daniel Okafor'],
    ['Karwan FC U18', 'KFCU18', 'football', 'U18', 'development', currentSeason, 'Priya Menon'],
    ['Karwan FC U16', 'KFCU16', 'football', 'U16', 'academy', currentSeason, 'Priya Menon'],
    ['Karwan Hoops Senior', 'KHS', 'basketball', 'Senior', 'senior', currentSeason, 'Marcus Fernandes'],
    ['Karwan Hoops U18', 'KHU18', 'basketball', 'U18', 'academy', currentSeason, 'Marcus Fernandes'],
    ['Karwan Badminton Squad', 'KBS', 'badminton', 'Senior', 'senior', currentSeason, 'Lakshmi Rao'],
    ['Karwan Table Tennis Squad', 'KTT', 'table_tennis', 'Senior', 'senior', currentSeason, 'Wei Chen'],
  ];
  const teamStmt = db.prepare(`
    INSERT INTO teams (name, code, sport_id, age_group, level, season_id, head_coach_id, home_venue, is_demo)
    VALUES (?,?,?,?,?,?,?,?,1)
  `);
  tx(() => teamRows.forEach(([name, code, sport, age, level, season, coach]) => {
    teamStmt.run(name, code, sportId(sport), age, level, season, coachId(coach), 'Karwan Sports Complex');
  }));
  const teamId = (name) => db.prepare('SELECT id FROM teams WHERE name = ?').get(name).id;

  tx(() => coachRows.forEach(([name]) => {
    db.prepare('INSERT OR IGNORE INTO team_coaches (team_id, coach_id, role) SELECT id, ?, ? FROM teams WHERE head_coach_id = ?')
      .run(coachId(name), 'head_coach', coachId(name));
  }));

  /* ---- Athletes ----------------------------------------------------- */
  const FIRST = ['Arun', 'Zaid', 'Rehan', 'Kabir', 'Aditya', 'Farhan', 'Nikhil', 'Sameer', 'Vikram', 'Hamza',
    'Rohan', 'Yash', 'Ibrahim', 'Karan', 'Tariq', 'Anish', 'Dev', 'Owais', 'Siddharth', 'Junaid',
    'Aisha', 'Fatima', 'Priya', 'Zara', 'Meher', 'Ananya', 'Noor', 'Divya', 'Sana', 'Ishita'];
  const LAST = ['Prasad', 'Khan', 'Sharma', 'Ahmed', 'Reddy', 'Iqbal', 'Nair', 'Siddiqui', 'Verma', 'Patel',
    'Rahman', 'Menon', 'Chopra', 'Ansari', 'Rao', 'Baig', 'Kulkarni', 'Hussain', 'Joshi', 'Mirza'];
  const NATIONALITIES = ['India', 'India', 'India', 'United Arab Emirates', 'Pakistan', 'Bangladesh', 'Sri Lanka'];

  const playerStmt = db.prepare(`
    INSERT INTO players (athlete_id, first_name, last_name, display_name, dob, gender, nationality, registration_date,
                         status, phone, email, city, country, emergency_name, emergency_phone, emergency_relation,
                         guardian_name, guardian_phone, height_cm, weight_kg, preferred_hand, preferred_foot,
                         visibility, bio, is_demo, created_by)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?)
  `);

  const adminId = userId('admin@playerarc.local');
  const players = [];
  const usedNames = new Set();

  // Squads are allocated first, then athletes are generated to fill them, so
  // every team ends up with a viable roster and an age range that matches its
  // age group. Building it the other way round — generating athletes and
  // sorting them by age afterwards — leaves the narrow bands almost empty.
  const SQUAD_PLAN = [
    { team: 'Karwan Cricket Senior XI', sport: 'cricket', size: 13, ageRange: [19, 33] },
    { team: 'Karwan Cricket U18', sport: 'cricket', size: 12, ageRange: [16, 17] },
    { team: 'Karwan Cricket U16', sport: 'cricket', size: 11, ageRange: [14, 15] },
    { team: 'Karwan FC Senior', sport: 'football', size: 14, ageRange: [19, 32] },
    { team: 'Karwan FC U18', sport: 'football', size: 13, ageRange: [16, 17] },
    { team: 'Karwan FC U16', sport: 'football', size: 12, ageRange: [14, 15] },
    { team: 'Karwan Hoops Senior', sport: 'basketball', size: 9, ageRange: [19, 30] },
    { team: 'Karwan Hoops U18', sport: 'basketball', size: 8, ageRange: [16, 17] },
    { team: 'Karwan Badminton Squad', sport: 'badminton', size: 6, ageRange: [15, 28] },
    { team: 'Karwan Table Tennis Squad', sport: 'table_tennis', size: 5, ageRange: [15, 27] },
  ];

  tx(() => {
    let index = 0;
    for (const plan of SQUAD_PLAN) {
      for (let n = 0; n < plan.size; n += 1) {
        let first;
        let last;
        let key;
        do {
          first = pick(FIRST);
          last = pick(LAST);
          key = `${first} ${last}`;
        } while (usedNames.has(key));
        usedNames.add(key);

        const female = FIRST.indexOf(first) >= 20;
        const age = int(plan.ageRange[0], plan.ageRange[1]);
        const dob = iso(new Date(today.getFullYear() - age, int(0, 11), int(1, 28)));
        const isMinor = age < 18;
        index += 1;
        const athleteId = `${config.club.athleteIdPrefix}-${String(index).padStart(6, '0')}`;
        const status = chance(0.84) ? 'active' : pick(['injured', 'inactive', 'trial', 'alumni']);

        const info = playerStmt.run(
          athleteId, first, last, `${first} ${last}`, dob, female ? 'female' : 'male', pick(NATIONALITIES),
          daysAgo(int(60, 1400)), status,
          `+971 5${int(0, 9)} ${int(100, 999)} ${int(1000, 9999)}`,
          `${first.toLowerCase()}.${last.toLowerCase()}@example.com`,
          'Sharjah', 'United Arab Emirates',
          `${pick(FIRST)} ${last}`, `+971 5${int(0, 9)} ${int(100, 999)} ${int(1000, 9999)}`, isMinor ? 'Parent' : 'Sibling',
          isMinor ? `${pick(FIRST)} ${last}` : null, isMinor ? `+971 5${int(0, 9)} ${int(100, 999)} ${int(1000, 9999)}` : null,
          int(158, 192), int(52, 88), chance(0.85) ? 'right' : 'left', chance(0.78) ? 'right' : 'left',
          chance(0.3) ? 'public' : 'club',
          'Joined the Karwan academy pathway and has progressed through the age groups.',
          adminId,
        );
        players.push({
          id: info.lastInsertRowid, athleteId, first, last, dob, age, female, status,
          team: plan.team, sport: plan.sport,
        });
      }
    }
  });

  console.log(`[seed] ${players.length} athletes registered`);

  // Link the demo player and guardian accounts to a real athlete record.
  const arun = players.find((p) => p.first === 'Arun') || players[0];
  tx(() => {
    db.prepare('INSERT OR IGNORE INTO user_player_links (user_id, player_id, relationship) VALUES (?,?,?)')
      .run(userId('player@karwansportsclub.com'), arun.id, 'self');
    db.prepare('INSERT OR IGNORE INTO user_player_links (user_id, player_id, relationship) VALUES (?,?,?)')
      .run(userId('parent@karwansportsclub.com'), arun.id, 'guardian');
    db.prepare('INSERT OR IGNORE INTO user_sport_scopes (user_id, sport_id) VALUES (?,?)')
      .run(userId('cricket.admin@karwansportsclub.com'), sportId('cricket'));
    for (const t of ['Karwan Cricket Senior XI', 'Karwan Cricket U18']) {
      db.prepare('INSERT OR IGNORE INTO user_team_scopes (user_id, team_id) VALUES (?,?)').run(userId('coach.cricket@karwansportsclub.com'), teamId(t));
    }
    for (const t of ['Karwan FC Senior', 'Karwan FC U18', 'Karwan FC U16']) {
      db.prepare('INSERT OR IGNORE INTO user_team_scopes (user_id, team_id) VALUES (?,?)').run(userId('coach.football@karwansportsclub.com'), teamId(t));
    }
    for (const t of ['Karwan FC U18', 'Karwan FC U16']) {
      db.prepare('INSERT OR IGNORE INTO user_team_scopes (user_id, team_id) VALUES (?,?)').run(userId('coach.academy@karwansportsclub.com'), teamId(t));
    }
  });

  /* ---- Sport registration + team history ---------------------------- */
  const cricketPositions = SPORTS.find((s) => s.code === 'cricket').config.positions.map((p) => p.key);
  const footballPositions = SPORTS.find((s) => s.code === 'football').config.positions.map((p) => p.key);
  const basketPositions = SPORTS.find((s) => s.code === 'basketball').config.positions.map((p) => p.key);
  const racketPositions = ['singles', 'doubles'];

  const psStmt = db.prepare(`
    INSERT OR IGNORE INTO player_sports (player_id, sport_id, is_primary, position, playing_role, playing_level, jersey_number, joined_date)
    VALUES (?,?,?,?,?,?,?,?)
  `);
  const membershipStmt = db.prepare(`
    INSERT INTO team_memberships (team_id, player_id, role, jersey_number, start_date, end_date, status, notes)
    VALUES (?,?,?,?,?,?,?,?)
  `);

  const assign = (player, sportCode, teamName, opts = {}) => {
    const sid = sportId(sportCode);
    const positions = { cricket: cricketPositions, football: footballPositions, basketball: basketPositions }[sportCode] || racketPositions;
    const position = opts.position || pick(positions);
    const jersey = opts.jersey ?? int(1, 99);
    const level = teamName.includes('U16') ? 'academy' : teamName.includes('U18') ? 'development' : 'senior';
    psStmt.run(player.id, sid, opts.primary ? 1 : 0, position, opts.role || null, level, jersey, opts.start || daysAgo(int(200, 900)));

    const start = opts.start || daysAgo(int(200, 900));
    const info = membershipStmt.run(
      teamId(teamName), player.id,
      opts.teamRole || (chance(0.1) ? 'captain' : 'player'),
      jersey, start, opts.end || null, opts.end ? (opts.status || 'promoted') : 'active', null,
    );
    timeline.addEvent({
      playerId: player.id, date: start, type: 'team_joined', title: `Joined ${teamName}`,
      sportId: sid, refTable: 'team_memberships', refId: info.lastInsertRowid, importance: 3,
    });
    if (opts.end) {
      timeline.addEvent({
        playerId: player.id, date: opts.end, type: opts.status === 'promoted' ? 'promotion' : 'team_left',
        title: opts.status === 'promoted' ? `Promoted from ${teamName}` : `Left ${teamName}`,
        sportId: sid, refTable: 'team_memberships_end', refId: info.lastInsertRowid, importance: 2,
      });
    }
    return position;
  };

  tx(() => {
    players.forEach((p, i) => {
      timeline.addEvent({
        playerId: p.id, date: daysAgo(int(60, 1400)), type: 'registration',
        title: 'Registered with Karwan Sports Club',
        description: `Athlete ID ${p.athleteId} issued.`, importance: 3, refTable: 'players', refId: p.id,
      });
      db.prepare('INSERT INTO player_status_history (player_id, status, effective_from, reason) VALUES (?,?,?,?)')
        .run(p.id, 'active', daysAgo(int(60, 1400)), 'Initial registration');

      assign(p, p.sport, p.team, { primary: true });

      // A genuine progression: some of the current U18s came up from the
      // squad that ran last season.
      if (p.team === 'Karwan Cricket U18' && chance(0.45)) {
        const start = daysAgo(720);
        const end = daysAgo(360);
        const info = membershipStmt.run(teamId('Karwan Cricket U18 (2024–25)'), p.id, 'player', int(1, 99), start, end, 'promoted', null);
        timeline.addEvent({
          playerId: p.id, date: end, type: 'promotion',
          title: 'Promoted to the current U18 squad', sportId: sportId('cricket'),
          refTable: 'tm_promo', refId: info.lastInsertRowid, importance: 3,
        });
      }

      // Multi-sport athletes: the point of the whole platform, so a real slice
      // of the club plays two.
      if (i % 9 === 0 && p.sport !== 'badminton') {
        assign(p, 'badminton', 'Karwan Badminton Squad', { primary: false });
      }
      if (i % 13 === 0 && p.sport === 'cricket' && p.age >= 19) {
        assign(p, 'football', 'Karwan FC Senior', { primary: false });
      }
    });
  });

  /* ---- Tournaments -------------------------------------------------- */
  const tournamentRows = [
    ['Karwan Premier Cricket League 2026', 'cricket', 'League', 'club', daysAgo(120), daysAgo(20), 'completed', 'Karwan Sports Complex'],
    ['Emirates Club Cricket Cup', 'cricket', 'Knockout', 'district', daysAgo(240), daysAgo(190), 'completed', 'Sharjah Cricket Stadium'],
    ['Karwan Cricket Championship 2026–27', 'cricket', 'League', 'club', daysAhead(20), daysAhead(120), 'upcoming', 'Karwan Sports Complex'],
    ['Karwan Football Championship', 'football', 'League', 'club', daysAgo(150), daysAgo(15), 'completed', 'Karwan Ground A'],
    ['Sharjah Youth Football Cup', 'football', 'Knockout', 'district', daysAgo(80), daysAgo(40), 'completed', 'Sharjah Sports Club'],
    ['Karwan Basketball Invitational', 'basketball', 'Round robin', 'club', daysAgo(95), daysAgo(30), 'completed', 'Karwan Indoor Arena'],
    ['Emirates Badminton Open', 'badminton', 'Knockout', 'district', daysAgo(70), daysAgo(66), 'completed', 'Sharjah Indoor Hall'],
    ['Karwan Table Tennis Classic', 'table_tennis', 'Knockout', 'club', daysAgo(55), daysAgo(53), 'completed', 'Karwan Indoor Arena'],
  ];
  const tourStmt = db.prepare(`
    INSERT INTO tournaments (name, sport_id, season_id, format, level, start_date, end_date, status, venue, host, description, is_demo)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,1)
  `);
  tx(() => tournamentRows.forEach(([name, sport, format, level, start, end, status, venue]) => {
    tourStmt.run(name, sportId(sport), currentSeason, format, level, start, end, status, venue, config.club.name,
      `${format} competition contested at ${venue}.`);
  }));
  const tourId = (name) => db.prepare('SELECT id FROM tournaments WHERE name = ?').get(name).id;

  tx(() => {
    const link = db.prepare('INSERT OR IGNORE INTO tournament_teams (tournament_id, team_id, external_name, group_name) VALUES (?,?,?,?)');
    link.run(tourId('Karwan Premier Cricket League 2026'), teamId('Karwan Cricket Senior XI'), null, 'Group A');
    link.run(tourId('Karwan Premier Cricket League 2026'), teamId('Karwan Cricket U18'), null, 'Group B');
    link.run(tourId('Karwan Football Championship'), teamId('Karwan FC Senior'), null, 'Group A');
    link.run(tourId('Karwan Football Championship'), teamId('Karwan FC U18'), null, 'Group A');
    link.run(tourId('Karwan Basketball Invitational'), teamId('Karwan Hoops Senior'), null, null);
  });

  /* ---- Matches, lineups and performances ---------------------------- */
  const OPPONENTS = {
    cricket: ['Al Nasr CC', 'Sharjah Tigers', 'Dubai Eagles', 'Ajman United CC', 'Desert Falcons'],
    football: ['Al Wasl Youth', 'Sharjah FC Academy', 'Dubai City FC', 'Ajman Rovers', 'Emirates United'],
    basketball: ['Sharjah Slammers', 'Dubai Dunkers', 'Ajman Storm', 'Falcon BC'],
    badminton: ['Sharjah Shuttlers', 'Dubai Smash Club', 'Emirates Racket Academy'],
    table_tennis: ['Sharjah Paddles', 'Dubai TT Centre', 'Ajman Spin Club'],
  };
  const VENUES = ['Karwan Sports Complex', 'Sharjah Cricket Stadium', 'Karwan Ground A', 'Karwan Indoor Arena', 'Sharjah Sports Club'];

  const matchStmt = db.prepare(`
    INSERT INTO matches (sport_id, tournament_id, season_id, match_no, stage, match_type, format, scheduled_at,
                         venue, home_team_id, opponent_name, is_home, status, result, home_score, away_score,
                         winner_team_id, result_summary, notes, is_demo, created_by)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?)
  `);
  const lineupStmt = db.prepare(`
    INSERT OR IGNORE INTO match_players (match_id, player_id, team_id, is_starting, is_substitute, is_captain, is_keeper, position, jersey_number, batting_order, minutes_played)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)
  `);
  const perfStmt = db.prepare(`
    INSERT OR IGNORE INTO match_performances (match_id, player_id, sport_id, team_id, stats_json, rating, notes, created_by)
    VALUES (?,?,?,?,?,?,?,?)
  `);

  const statsUserId = userId('stats@karwansportsclub.com');

  function rosterOf(teamName) {
    return db
      .prepare(`SELECT tm.player_id, tm.jersey_number, tm.role, ps.position
                FROM team_memberships tm
                JOIN teams t ON t.id = tm.team_id
                LEFT JOIN player_sports ps ON ps.player_id = tm.player_id AND ps.sport_id = t.sport_id
                WHERE tm.team_id = ? AND tm.end_date IS NULL`)
      .all(teamId(teamName));
  }

  function cricketStats(position) {
    const isBowler = ['fast_bowler', 'medium_pacer', 'spinner', 'all_rounder'].includes(position);
    const isBatter = !['fast_bowler', 'spinner'].includes(position) || chance(0.4);
    const stats = { catches: chance(0.35) ? int(1, 2) : 0, run_outs: chance(0.1) ? 1 : 0, drops: chance(0.12) ? 1 : 0 };
    if (position === 'wicket_keeper') stats.stumpings = chance(0.3) ? int(1, 2) : 0;
    if (isBatter && chance(0.9)) {
      const balls = int(4, 62);
      const runs = Math.min(Math.round(balls * (0.6 + rnd() * 1.4)), balls * 6);
      stats.batted = 1;
      stats.runs = runs;
      stats.balls_faced = balls;
      stats.fours = Math.min(Math.floor(runs / 9), 14);
      stats.sixes = runs > 30 ? int(0, 4) : chance(0.2) ? 1 : 0;
      stats.not_out = chance(0.18) ? 1 : 0;
      stats.dismissal = stats.not_out ? 'not out' : pick(['bowled', 'caught', 'lbw', 'run out', 'stumped']);
    }
    if (isBowler && chance(0.85)) {
      const balls = int(12, 24);
      stats.bowled_spell = 1;
      stats.balls_bowled = balls;
      stats.runs_conceded = Math.round(balls * (0.7 + rnd() * 1.1));
      stats.wickets = chance(0.55) ? int(1, 4) : 0;
      stats.maidens = chance(0.25) ? 1 : 0;
    }
    return stats;
  }

  function footballStats(position) {
    const gk = position === 'GK';
    const attacker = ['ST', 'LW', 'RW', 'AM'].includes(position);
    const defender = ['CB', 'LB', 'RB', 'DM'].includes(position);
    const started = chance(0.75) ? 1 : 0;
    const minutes = started ? int(60, 90) : int(8, 35);
    const passes = int(gk ? 12 : 25, gk ? 40 : 85);
    const stats = {
      started, minutes,
      passes,
      passes_completed: Math.round(passes * (0.62 + rnd() * 0.3)),
      key_passes: attacker ? int(0, 4) : int(0, 2),
      tackles: defender ? int(1, 7) : int(0, 4),
      interceptions: defender ? int(1, 6) : int(0, 3),
      clearances: defender ? int(1, 9) : int(0, 2),
      duels_won: int(2, 14),
      fouls: int(0, 4),
      yellow_cards: chance(0.14) ? 1 : 0,
      red_cards: chance(0.02) ? 1 : 0,
      coach_rating: Math.round((5.2 + rnd() * 4.2) * 10) / 10,
    };
    if (gk) {
      stats.saves = int(1, 8);
      stats.goals_conceded = int(0, 3);
      stats.clean_sheet = stats.goals_conceded === 0 ? 1 : 0;
      stats.shots = 0;
      stats.shots_on_target = 0;
      stats.goals = 0;
      stats.assists = 0;
    } else {
      const shots = attacker ? int(1, 7) : int(0, 3);
      stats.shots = shots;
      stats.shots_on_target = shots ? int(0, shots) : 0;
      stats.goals = stats.shots_on_target ? (chance(attacker ? 0.45 : 0.12) ? int(1, Math.min(3, stats.shots_on_target)) : 0) : 0;
      stats.assists = chance(attacker ? 0.3 : 0.12) ? int(1, 2) : 0;
      if (defender) stats.clean_sheet = chance(0.35) ? 1 : 0;
    }
    return stats;
  }

  function basketballStats() {
    const fga = int(4, 20);
    const fgm = int(1, fga);
    const tpa = int(0, Math.min(9, fga));
    const tpm = int(0, Math.min(tpa, fgm));
    const fta = int(0, 9);
    const ftm = int(0, fta);
    return {
      started: chance(0.6) ? 1 : 0,
      minutes: int(12, 38),
      fga, fgm, tpa, tpm, fta, ftm,
      oreb: int(0, 5), dreb: int(1, 9),
      assists: int(0, 9), turnovers: int(0, 5),
      steals: int(0, 4), blocks: int(0, 3),
      fouls: int(0, 5), plus_minus: int(-14, 18),
    };
  }

  function racketStats() {
    const won = chance(0.55) ? 1 : 0;
    const setsWon = won ? 2 : int(0, 1);
    const setsLost = won ? int(0, 1) : 2;
    const totalSets = setsWon + setsLost;
    return {
      won, sets_won: setsWon, sets_lost: setsLost,
      points_scored: totalSets * int(14, 21),
      points_conceded: totalSets * int(12, 21),
      winners: int(8, 30), unforced_errors: int(4, 22),
      duration: int(28, 78),
      round_reached: pick(['Group', 'Round of 16', 'Quarter-final', 'Semi-final', 'Final']),
      ranking_points: won ? int(40, 220) : int(5, 60),
      coach_rating: Math.round((5 + rnd() * 4.5) * 10) / 10,
    };
  }

  const fixtures = [
    { sport: 'cricket', team: 'Karwan Cricket Senior XI', tournament: 'Karwan Premier Cricket League 2026', count: 6, format: 'T20', squad: 11 },
    { sport: 'cricket', team: 'Karwan Cricket U18', tournament: 'Karwan Premier Cricket League 2026', count: 5, format: 'T20', squad: 11 },
    { sport: 'cricket', team: 'Karwan Cricket Senior XI', tournament: 'Emirates Club Cricket Cup', count: 3, format: '40-over', squad: 11 },
    { sport: 'football', team: 'Karwan FC Senior', tournament: 'Karwan Football Championship', count: 6, format: '90 minutes', squad: 11 },
    { sport: 'football', team: 'Karwan FC U18', tournament: 'Sharjah Youth Football Cup', count: 4, format: '90 minutes', squad: 11 },
    { sport: 'basketball', team: 'Karwan Hoops Senior', tournament: 'Karwan Basketball Invitational', count: 5, format: '4x10 minutes', squad: 8 },
    { sport: 'badminton', team: 'Karwan Badminton Squad', tournament: 'Emirates Badminton Open', count: 4, format: 'Best of 3 (21 points)', squad: 4 },
    { sport: 'table_tennis', team: 'Karwan Table Tennis Squad', tournament: 'Karwan Table Tennis Classic', count: 4, format: 'Best of 5 (11 points)', squad: 3 },
  ];

  let matchCount = 0;
  let perfCount = 0;

  for (const fixture of fixtures) {
    const roster = rosterOf(fixture.team);
    if (!roster.length) continue;
    const sid = sportId(fixture.sport);
    const sportConfig = SPORTS.find((s) => s.code === fixture.sport).config;
    const isRacket = ['badminton', 'table_tennis'].includes(fixture.sport);

    for (let n = 0; n < fixture.count; n += 1) {
      const daysBack = int(15, 220);
      const date = `${daysAgo(daysBack)}T${String(int(9, 19)).padStart(2, '0')}:00:00`;
      const opponent = pick(OPPONENTS[fixture.sport]);
      const won = chance(0.55);
      const result = won ? 'win' : chance(0.85) ? 'loss' : 'draw';
      const scores = {
        cricket: () => [`${int(120, 210)}/${int(3, 9)}`, `${int(110, 205)}/${int(4, 10)}`],
        football: () => [String(int(0, 4)), String(int(0, 4))],
        basketball: () => [String(int(58, 96)), String(int(55, 94))],
        badminton: () => ['2', String(int(0, 1))],
        table_tennis: () => ['3', String(int(0, 2))],
      }[fixture.sport]();

      let matchId;
      try {
        const info = matchStmt.run(
          sid, tourId(fixture.tournament), currentSeason, `M${n + 1}`,
          pick(['Group', 'League', 'Quarter-final', 'Semi-final']),
          isRacket ? 'singles' : 'team', fixture.format, date,
          pick(VENUES), teamId(fixture.team), opponent, chance(0.6) ? 1 : 0,
          'completed', result, scores[0], scores[1],
          won ? teamId(fixture.team) : null,
          `${won ? 'Karwan' : opponent} won${fixture.sport === 'cricket' ? ` by ${int(2, 7)} wickets` : ''}.`,
          null, statsUserId,
        );
        matchId = info.lastInsertRowid;
      } catch {
        continue; // duplicate fixture guard fired
      }
      matchCount += 1;

      const selected = [...roster].sort(() => rnd() - 0.5).slice(0, fixture.squad);
      selected.forEach((r, idx) => {
        lineupStmt.run(
          matchId, r.player_id, teamId(fixture.team), 1, 0,
          r.role === 'captain' ? 1 : 0, r.position === 'wicket_keeper' ? 1 : 0,
          r.position || null, r.jersey_number || null,
          fixture.sport === 'cricket' ? idx + 1 : null,
          fixture.sport === 'football' ? int(45, 90) : null,
        );

        const stats = {
          cricket: () => cricketStats(r.position),
          football: () => footballStats(r.position || 'CM'),
          basketball: () => basketballStats(),
          badminton: () => racketStats(),
          table_tennis: () => racketStats(),
        }[fixture.sport]();

        perfStmt.run(matchId, r.player_id, sid, teamId(fixture.team), JSON.stringify(stats),
          computeMatchRating(sportConfig, stats), null, statsUserId);
        perfCount += 1;

        timeline.addEvent({
          playerId: r.player_id, date: date.slice(0, 10), type: 'match',
          title: `Played ${SPORTS.find((s) => s.code === fixture.sport).name} vs ${opponent}`,
          description: `${fixture.tournament}`, sportId: sid,
          refTable: 'matches', refId: matchId, importance: 1,
        });
        timeline.checkMilestones({
          playerId: r.player_id, sportId: sid, sportCode: fixture.sport,
          sportName: SPORTS.find((s) => s.code === fixture.sport).name,
          stats, matchId, date: date.slice(0, 10),
        });
      });

      // Player of the match, with the matching award and timeline entry.
      if (won && selected.length) {
        const star = pick(selected);
        db.prepare('UPDATE matches SET player_of_match_id = ? WHERE id = ?').run(star.player_id, matchId);
        db.prepare('UPDATE match_performances SET is_motm = 1 WHERE match_id = ? AND player_id = ?').run(matchId, star.player_id);
        db.prepare(`INSERT INTO achievements (player_id, title, category, level, sport_id, tournament_id, match_id, team_id, awarded_date, description, is_demo, created_by)
                    VALUES (?,?,?,?,?,?,?,?,?,?,1,?)`)
          .run(star.player_id, 'Player of the Match', 'match', 'club', sid, tourId(fixture.tournament), matchId,
               teamId(fixture.team), date.slice(0, 10), `Against ${opponent}.`, statsUserId);
        timeline.addEvent({
          playerId: star.player_id, date: date.slice(0, 10), type: 'achievement',
          title: 'Player of the Match', description: `Against ${opponent}.`, sportId: sid,
          refTable: 'matches_motm', refId: matchId, importance: 3,
        });
      }
    }
  }

  // Upcoming fixtures so the dashboard has something ahead of it.
  tx(() => {
    for (const [team, sport, tournament] of [
      ['Karwan Cricket Senior XI', 'cricket', 'Karwan Cricket Championship 2026–27'],
      ['Karwan FC Senior', 'football', null],
      ['Karwan Hoops Senior', 'basketball', null],
    ]) {
      try {
        matchStmt.run(sportId(sport), tournament ? tourId(tournament) : null, currentSeason, 'M1', 'League',
          'team', null, `${daysAhead(int(3, 25))}T16:00:00`, pick(VENUES), teamId(team),
          pick(OPPONENTS[sport]), 1, 'scheduled', null, null, null, null, null, null, statsUserId);
      } catch { /* duplicate fixture */ }
    }
  });
  console.log(`[seed] ${matchCount} matches with ${perfCount} performance records`);

  /* ---- Training and attendance -------------------------------------- */
  const sessionStmt = db.prepare(`
    INSERT INTO training_sessions (sport_id, team_id, coach_id, title, session_date, start_time, duration_minutes,
                                   training_type, location, objectives, exercises_json, skills_json, coach_notes,
                                   areas_for_improvement, intensity, is_demo, created_by)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?)
  `);
  const attendStmt = db.prepare(`
    INSERT OR IGNORE INTO training_attendance (session_id, player_id, status, performance_score, effort_score, coach_notes)
    VALUES (?,?,?,?,?,?)
  `);

  const EXERCISES = {
    cricket: ['Throwdowns — front foot drives', 'Slip catching ladder', 'Yorker target bowling', 'Middle practice', 'Running between wickets'],
    football: ['Rondo 5v2', 'Pressing triggers', 'Crossing and finishing', 'Small-sided 4v4', 'Set-piece routines'],
    basketball: ['Shooting circuit', 'Pick and roll reads', 'Transition defence', 'Free-throw pressure sets'],
    badminton: ['Shadow footwork', 'Multi-shuttle drives', 'Net kill drill', 'Match simulation'],
    table_tennis: ['Multiball forehand', 'Serve and third ball', 'Backhand block drill', 'Match play'],
  };
  const SKILLS = {
    cricket: ['Shot selection', 'Line and length', 'Ground fielding'],
    football: ['First touch', 'Defensive shape', 'Finishing'],
    basketball: ['Shooting form', 'Help defence', 'Ball handling'],
    badminton: ['Court coverage', 'Smash placement'],
    table_tennis: ['Spin variation', 'Rally consistency'],
  };

  let sessionCount = 0;
  tx(() => {
    for (const [teamName, sport, coach] of [
      ['Karwan Cricket Senior XI', 'cricket', 'Yusuf Baig'],
      ['Karwan Cricket U18', 'cricket', 'Imran Qureshi'],
      ['Karwan Cricket U16', 'cricket', 'Imran Qureshi'],
      ['Karwan FC Senior', 'football', 'Daniel Okafor'],
      ['Karwan FC U18', 'football', 'Priya Menon'],
      ['Karwan FC U16', 'football', 'Priya Menon'],
      ['Karwan Hoops Senior', 'basketball', 'Marcus Fernandes'],
      ['Karwan Badminton Squad', 'badminton', 'Lakshmi Rao'],
      ['Karwan Table Tennis Squad', 'table_tennis', 'Wei Chen'],
    ]) {
      const roster = rosterOf(teamName);
      if (!roster.length) continue;
      for (let n = 0; n < 8; n += 1) {
        const type = pick(['technical', 'tactical', 'fitness', 'skills', 'match_practice', 'strength']);
        const info = sessionStmt.run(
          sportId(sport), teamId(teamName), coachId(coach),
          `${type.replace('_', ' ')} session`, daysAgo(int(2, 120)),
          `${String(int(6, 19)).padStart(2, '0')}:00`, pick([60, 75, 90, 120]),
          type, pick(['Main Ground', 'Practice Nets', 'Indoor Arena', 'Gymnasium', 'Ground B']),
          `Improve ${pick(SKILLS[sport]).toLowerCase()} under match pressure.`,
          JSON.stringify([...EXERCISES[sport]].sort(() => rnd() - 0.5).slice(0, 3)),
          JSON.stringify(SKILLS[sport]),
          'Good intensity throughout. Standards held in the final block.',
          `Continue work on ${pick(SKILLS[sport]).toLowerCase()}.`,
          int(4, 9), userId('admin@playerarc.local'),
        );
        sessionCount += 1;
        roster.forEach((r) => {
          const status = chance(0.86) ? 'present' : pick(['absent', 'late', 'excused', 'injured']);
          attendStmt.run(info.lastInsertRowid, r.player_id, status,
            status === 'absent' ? null : Math.round((5.5 + rnd() * 4) * 10) / 10,
            status === 'absent' ? null : Math.round((6 + rnd() * 4) * 10) / 10,
            chance(0.25) ? pick(['Sharp in the drills.', 'Needs to lift work rate.', 'Led the group well.', 'Good attitude after a tough week.']) : null);
        });
      }
    }
  });
  console.log(`[seed] ${sessionCount} training sessions with attendance`);

  /* ---- Assessments over time (development trend) --------------------- */
  const assessStmt = db.prepare(`
    INSERT INTO assessments (player_id, sport_id, team_id, assessed_by, assessment_date, cycle, age_group,
                             overall_score, summary, recommendation, next_review_date, is_demo, created_by)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,1,?)
  `);
  const scoreStmt = db.prepare('INSERT OR IGNORE INTO assessment_scores (assessment_id, criteria_id, score, comment) VALUES (?,?,?,?)');

  let assessmentCount = 0;
  tx(() => {
    for (const p of players.slice(0, 30)) {
      const ps = db.prepare('SELECT * FROM player_sports WHERE player_id = ? ORDER BY is_primary DESC LIMIT 1').get(p.id);
      if (!ps) continue;
      const relevant = db
        .prepare('SELECT * FROM assessment_criteria WHERE sport_id IS NULL OR sport_id = ? ORDER BY category, sort_order')
        .all(ps.sport_id);
      const membership = db.prepare('SELECT team_id FROM team_memberships WHERE player_id = ? AND end_date IS NULL LIMIT 1').get(p.id);
      const coach = db.prepare('SELECT head_coach_id FROM teams WHERE id = ?').get(membership ? membership.team_id : null);

      // Four quarterly reviews, each improving a little on the last — this is
      // what the development chart plots.
      const base = {};
      relevant.forEach((c) => { base[c.id] = 4 + rnd() * 3; });

      for (let cycle = 0; cycle < 4; cycle += 1) {
        const date = daysAgo(300 - cycle * 90);
        let weighted = 0;
        let weightTotal = 0;
        const rows = relevant.map((c) => {
          const drift = cycle * (0.25 + rnd() * 0.55);
          const score = Math.max(1, Math.min(10, Math.round((base[c.id] + drift + (rnd() - 0.5)) * 10) / 10));
          weighted += score * c.weight;
          weightTotal += c.weight;
          return { criteriaId: c.id, score };
        });
        const overall = Math.round((weighted / weightTotal) * 10) / 10;
        const info = assessStmt.run(
          p.id, ps.sport_id, membership ? membership.team_id : null,
          coach ? coach.head_coach_id : null, date,
          ['Q1 review', 'Q2 review', 'Q3 review', 'Q4 review'][cycle],
          p.age < 16 ? 'U16' : p.age < 18 ? 'U18' : 'Senior',
          overall,
          cycle === 3 ? 'Clear progression across the year, strongest in the technical block.' : 'Steady development against the age-group benchmark.',
          pick(['Continue in the current squad with added strength work.',
                'Ready for consideration in the age group above.',
                'Focus block on tactical decision making next quarter.']),
          daysAgo(300 - cycle * 90 - 90),
          userId('admin@playerarc.local'),
        );
        rows.forEach((r) => scoreStmt.run(info.lastInsertRowid, r.criteriaId, r.score, null));
        timeline.addEvent({
          playerId: p.id, date, type: 'assessment',
          title: `${['Q1', 'Q2', 'Q3', 'Q4'][cycle]} assessment — ${overall}/10`,
          sportId: ps.sport_id, refTable: 'assessments', refId: info.lastInsertRowid, importance: 2,
        });
        assessmentCount += 1;
      }
    }
  });
  console.log(`[seed] ${assessmentCount} assessments recorded`);

  /* ---- Season and academy awards ------------------------------------ */
  const awardStmt = db.prepare(`
    INSERT INTO achievements (player_id, title, category, level, sport_id, tournament_id, team_id, awarded_date, description, is_demo, created_by)
    VALUES (?,?,?,?,?,?,?,?,?,1,?)
  `);
  const awards = [
    ['Player of the Tournament', 'tournament', 'Karwan Premier Cricket League 2026', 'cricket'],
    ['Best Batter', 'tournament', 'Karwan Premier Cricket League 2026', 'cricket'],
    ['Best Bowler', 'tournament', 'Karwan Premier Cricket League 2026', 'cricket'],
    ['Golden Boot', 'tournament', 'Karwan Football Championship', 'football'],
    ['Most Valuable Player', 'tournament', 'Karwan Basketball Invitational', 'basketball'],
    ['Academy Player of the Year', 'academy', null, 'cricket'],
    ["Coach's Award", 'coach_award', null, 'football'],
    ['Selected for District Squad', 'representative', null, 'cricket'],
  ];
  tx(() => awards.forEach(([title, category, tournament, sport]) => {
    const candidates = db
      .prepare(`SELECT ps.player_id FROM player_sports ps WHERE ps.sport_id = ? ORDER BY random() LIMIT 1`)
      .get(sportId(sport));
    if (!candidates) return;
    const date = daysAgo(int(20, 150));
    const info = awardStmt.run(candidates.player_id, title, category,
      category === 'representative' ? 'district' : 'club',
      sportId(sport), tournament ? tourId(tournament) : null, null, date,
      `Awarded at ${tournament || config.club.name}.`, userId('admin@playerarc.local'));
    timeline.addEvent({
      playerId: candidates.player_id, date, type: 'achievement', title,
      sportId: sportId(sport), refTable: 'achievements', refId: info.lastInsertRowid, importance: 3,
    });
  }));


  /* ---- Ball-by-ball capture for a sample of matches ----------------- */
  //
  // A handful of completed matches are scored delivery by delivery so the
  // analysis screen has something real to work with. Their scorecards are then
  // rebuilt from those events, exactly as they would be if a scorer had worked
  // through the match live — which also proves the derivation path end to end.

  const periodStmt = db.prepare(`
    INSERT INTO match_periods (match_id, sequence, label, team_id, team_label, opponent_label,
                               planned_length, target, status)
    VALUES (?,?,?,?,?,?,?,?,?)
  `);
  const eventStmt = db.prepare(`
    INSERT INTO match_events (match_id, period_id, sequence, event_type, over_number, ball_in_over,
      minute, clock, team_id, primary_player_id, secondary_player_id, tertiary_player_id,
      x, y, outcome, payload_json, created_by)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `);

  const SHOTS = ['drive', 'cut', 'pull', 'sweep', 'flick', 'glance', 'defence', 'loft'];
  const LENGTHS = ['yorker', 'full', 'good', 'back of a length', 'short'];
  const LINES = ['outside off', 'off stump', 'middle', 'leg stump', 'down leg'];
  const DELIVERIES = ['seam', 'swing away', 'swing in', 'cutter', 'slower ball', 'off break', 'leg break'];

  let eventCount = 0;
  let scoredMatches = 0;

  function scoreCricketMatch(matchId) {
    const match = db.prepare('SELECT * FROM matches WHERE id = ?').get(matchId);
    const squad = db
      .prepare(`SELECT mp.player_id, ps.position FROM match_players mp
                LEFT JOIN player_sports ps ON ps.player_id = mp.player_id AND ps.sport_id = ?
                WHERE mp.match_id = ? ORDER BY mp.batting_order`)
      .all(match.sport_id, matchId);
    if (squad.length < 8) return false;

    const ours = squad.map((s2) => s2.player_id);
    const ourBowlers = squad
      .filter((s2) => ['fast_bowler', 'medium_pacer', 'spinner', 'all_rounder'].includes(s2.position))
      .map((s2) => s2.player_id);
    const attack = (ourBowlers.length >= 3 ? ourBowlers : ours.slice(-5)).slice(0, 5);
    const oppositionNames = ['R Fernandes', 'A Haddad', 'M Silva', 'T Nakamura', 'D Osei', 'K Rahman'];

    let sequence = 0;

    /**
     * One innings. `weBat` decides which side owns the athlete records:
     * when Karwan bats, the striker is one of ours and the bowler is an
     * opposition name; when Karwan bowls, it is the other way round. That is
     * what keeps batting and bowling statistics on the right athletes — and
     * stops anyone bowling to themselves.
     */
    function playInnings(sequenceNo, weBat) {
      const info = periodStmt.run(
        matchId, sequenceNo,
        `${sequenceNo === 1 ? '1st' : '2nd'} innings`,
        weBat ? match.home_team_id : null,
        weBat ? null : match.opponent_name,
        weBat ? match.opponent_name : null,
        12, null, 'complete',
      );
      const periodId = info.lastInsertRowid;

      const batters = weBat ? ours.slice(0, 7) : oppositionNames.slice(0, 5).map(() => null);
      const batterLabels = weBat ? [] : [...oppositionNames];
      let strikerIndex = 0;
      let nextBatterIndex = weBat ? 2 : 2;
      let wickets = 0;

      for (let over = 0; over < 12 && wickets < 6; over += 1) {
        const bowlerId = weBat ? null : attack[over % attack.length];
        const bowlerLabel = weBat ? oppositionNames[over % oppositionNames.length] : null;

        sequence += 1;
        eventStmt.run(matchId, periodId, sequence, 'over_start', over, null, null, null,
          match.home_team_id, bowlerId, null, null, null, null, null,
          JSON.stringify({ over_number: over + 1, opposition_role: weBat ? 'bowler' : null }), statsUserId);
        eventCount += 1;

        let ball = 1;
        while (ball <= 6 && wickets < 6) {
          const strikerId = weBat ? batters[strikerIndex] : null;
          const strikerLabel = weBat ? null : batterLabels[strikerIndex % batterLabels.length];

          const payload = {
            shot: pick(SHOTS),
            length: pick(LENGTHS),
            line: pick(LINES),
            delivery_type: pick(DELIVERIES),
            speed_kph: int(112, 148),
            control: chance(0.78) ? 1 : 0,
          };
          if (weBat) payload.opposition_role = 'bowler';

          let outcome;
          const roll = rnd();
          if (roll < 0.04) {
            payload.extras = 1;
            payload.extra_type = chance(0.6) ? 'wide' : 'no ball';
            payload.runs_batter = 0;
            outcome = payload.extra_type === 'wide' ? 'wide' : 'noball';
          } else if (roll < 0.10 && wickets < 5) {
            payload.runs_batter = 0;
            payload.wicket = 1;
            payload.dismissal = pick(['bowled', 'caught', 'lbw', 'caught behind', 'stumped', 'run out']);
            if (strikerId) payload.dismissed_player_id = strikerId;
            outcome = 'wicket';
          } else if (roll < 0.42) {
            payload.runs_batter = 0;
            payload.beaten = chance(0.25) ? 1 : 0;
            outcome = 'dot';
          } else if (roll < 0.72) {
            payload.runs_batter = chance(0.75) ? 1 : 2;
            outcome = payload.runs_batter === 1 ? 'single' : 'two';
          } else if (roll < 0.78) {
            payload.runs_batter = 3;
            outcome = 'three';
          } else if (roll < 0.93) {
            payload.runs_batter = 4;
            outcome = 'four';
          } else {
            payload.runs_batter = 6;
            outcome = 'six';
          }

          // A catch or run out is taken by a fielder, so it only credits one of
          // ours when we are the fielding side.
          const fielderId = !weBat && payload.dismissal
            && !['bowled', 'lbw'].includes(payload.dismissal)
            ? pick(ours.filter((f) => f !== bowlerId))
            : null;

          sequence += 1;
          eventStmt.run(
            matchId, periodId, sequence, 'ball', over, ball, null, null,
            match.home_team_id, strikerId, bowlerId, fielderId,
            payload.runs_batter > 0 ? int(5, 95) : null,
            payload.runs_batter > 0 ? int(5, 95) : null,
            outcome, JSON.stringify(payload),
            statsUserId,
          );
          // Record who the opposition actor was, for readable commentary.
          if (weBat || strikerLabel) {
            db.prepare('UPDATE match_events SET opponent_name = ? WHERE match_id = ? AND sequence = ?')
              .run(weBat ? bowlerLabel : strikerLabel, matchId, sequence);
          }
          eventCount += 1;

          if (payload.wicket) {
            wickets += 1;
            if (weBat) {
              if (nextBatterIndex < batters.length) {
                batters[strikerIndex] = batters[nextBatterIndex];
                nextBatterIndex += 1;
              } else break;
            } else {
              strikerIndex = (strikerIndex + 1) % batterLabels.length;
            }
          } else if ([1, 3].includes(payload.runs_batter)) {
            strikerIndex = weBat ? (strikerIndex === 0 ? 1 : 0) : strikerIndex;
          }

          const extra = payload.extra_type;
          if (extra !== 'wide' && extra !== 'no ball') ball += 1;
        }
        if (weBat) strikerIndex = strikerIndex === 0 ? 1 : 0;
      }
    }

    playInnings(1, true);    // Karwan batting
    playInnings(2, false);   // Karwan bowling
    scoredMatches += 1;
    return true;
  }

  function scoreFootballMatch(matchId) {
    const match = db.prepare('SELECT * FROM matches WHERE id = ?').get(matchId);
    const squad = db
      .prepare(`SELECT mp.player_id, ps.position FROM match_players mp
                LEFT JOIN player_sports ps ON ps.player_id = mp.player_id AND ps.sport_id = ?
                WHERE mp.match_id = ?`)
      .all(match.sport_id, matchId);
    if (squad.length < 7) return false;

    const keeper = squad.find((s) => s.position === 'GK')?.player_id || squad[0].player_id;
    const outfield = squad.filter((s) => s.player_id !== keeper).map((s) => s.player_id);
    const attackers = squad.filter((s) => ['ST', 'LW', 'RW', 'AM'].includes(s.position)).map((s) => s.player_id);
    const defenders = squad.filter((s) => ['CB', 'LB', 'RB', 'DM'].includes(s.position)).map((s) => s.player_id);
    const shooters = attackers.length ? attackers : outfield;

    let sequence = 0;
    for (const half of [1, 2]) {
      const info = periodStmt.run(matchId, half, `${half === 1 ? '1st' : '2nd'} half`,
        match.home_team_id, null, match.opponent_name, 45, null, 'complete');
      const periodId = info.lastInsertRowid;
      const base = half === 1 ? 0 : 45;

      for (let n = 0; n < int(9, 15); n += 1) {
        const minute = base + int(1, 44);
        const roll = rnd();
        sequence += 1;

        if (roll < 0.3) {
          const shooter = pick(shooters);
          const onTarget = chance(0.45);
          const goal = onTarget && chance(0.3);
          eventStmt.run(matchId, periodId, sequence, 'shot', null, null, minute, `${minute}:00`,
            match.home_team_id, shooter, goal ? pick(outfield.filter((p) => p !== shooter)) : null,
            onTarget && !goal ? keeper : null,
            int(60, 96), int(20, 80),
            goal ? 'goal' : onTarget ? 'saved' : 'off_target',
            JSON.stringify({
              on_target: onTarget ? 1 : 0, goal: goal ? 1 : 0,
              saved: onTarget && !goal ? 1 : 0,
              body_part: pick(['right foot', 'left foot', 'head']),
              situation: pick(['open play', 'counter', 'corner', 'free kick']),
              big_chance: chance(0.2) ? 1 : 0,
            }), statsUserId);
        } else if (roll < 0.55) {
          eventStmt.run(matchId, periodId, sequence, 'pass', null, null, minute, null,
            match.home_team_id, pick(outfield), pick(outfield), null,
            int(30, 80), int(10, 90), 'completed',
            JSON.stringify({ completed: chance(0.75) ? 1 : 0, pass_type: pick(['through ball', 'cross', 'long ball', 'cut-back']) }), statsUserId);
        } else if (roll < 0.78) {
          eventStmt.run(matchId, periodId, sequence, 'defensive', null, null, minute, null,
            match.home_team_id, pick(defenders.length ? defenders : outfield), null, null,
            int(5, 55), int(10, 90), null,
            JSON.stringify({ action: pick(['tackle', 'interception', 'clearance', 'duel won', 'recovery']), successful: chance(0.8) ? 1 : 0 }), statsUserId);
        } else if (roll < 0.88) {
          eventStmt.run(matchId, periodId, sequence, 'save', null, null, minute, null,
            match.home_team_id, keeper, null, null, int(2, 14), int(35, 65), 'save',
            JSON.stringify({ save_type: pick(['catch', 'parry', 'tip over', 'one on one']) }), statsUserId);
        } else if (roll < 0.96) {
          eventStmt.run(matchId, periodId, sequence, 'foul', null, null, minute, null,
            match.home_team_id, pick(outfield), null, null, int(10, 90), int(10, 90), 'foul',
            JSON.stringify({ won_free_kick: 1 }), statsUserId);
        } else {
          eventStmt.run(matchId, periodId, sequence, 'card', null, null, minute, null,
            match.home_team_id, pick(outfield), null, null, null, null, 'yellow',
            JSON.stringify({ card: 'yellow', reason: pick(['dissent', 'late tackle', 'time wasting']) }), statsUserId);
        }
        eventCount += 1;
      }
    }
    scoredMatches += 1;
    return true;
  }

  function scoreBasketballMatch(matchId) {
    const match = db.prepare('SELECT * FROM matches WHERE id = ?').get(matchId);
    const squad = db.prepare('SELECT player_id FROM match_players WHERE match_id = ?').all(matchId).map((r) => r.player_id);
    if (squad.length < 5) return false;

    let sequence = 0;
    for (let q = 1; q <= 4; q += 1) {
      const info = periodStmt.run(matchId, q, `Q${q}`, match.home_team_id, null, match.opponent_name, 10, null, 'complete');
      const periodId = info.lastInsertRowid;
      const base = (q - 1) * 10;

      for (let n = 0; n < int(10, 16); n += 1) {
        const minute = base + rnd() * 10;
        const roll = rnd();
        sequence += 1;

        if (roll < 0.55) {
          const shooter = pick(squad);
          const three = chance(0.35);
          const made = chance(three ? 0.36 : 0.5);
          eventStmt.run(matchId, periodId, sequence, 'shot', null, null, round1(minute), null,
            match.home_team_id, shooter, made ? pick(squad.filter((p) => p !== shooter)) : null,
            !made && chance(0.15) ? pick(squad.filter((p) => p !== shooter)) : null,
            three ? int(5, 95) : int(30, 70), three ? int(5, 60) : int(55, 95),
            made ? (three ? 'made3' : 'made2') : (three ? 'miss3' : 'miss2'),
            JSON.stringify({
              points: three ? '3' : '2', made: made ? 1 : 0,
              shot_type: three ? 'jump shot' : pick(['layup', 'dunk', 'jump shot', 'floater']),
              fastbreak: chance(0.2) ? 1 : 0,
            }), statsUserId);
        } else if (roll < 0.8) {
          eventStmt.run(matchId, periodId, sequence, 'rebound', null, null, round1(minute), null,
            match.home_team_id, pick(squad), null, null, null, null, null,
            JSON.stringify({ kind: chance(0.7) ? 'defensive' : 'offensive' }), statsUserId);
        } else if (roll < 0.92) {
          const loser = pick(squad);
          eventStmt.run(matchId, periodId, sequence, 'turnover', null, null, round1(minute), null,
            match.home_team_id, loser, chance(0.5) ? pick(squad.filter((p) => p !== loser)) : null, null,
            null, null, null,
            JSON.stringify({ kind: pick(['bad pass', 'lost ball', 'travel', 'shot clock']) }), statsUserId);
        } else {
          eventStmt.run(matchId, periodId, sequence, 'foul', null, null, round1(minute), null,
            match.home_team_id, pick(squad), null, null, null, null, null,
            JSON.stringify({ kind: pick(['personal', 'shooting', 'offensive']) }), statsUserId);
        }
        eventCount += 1;
      }
    }
    scoredMatches += 1;
    return true;
  }

  function scoreRacketMatch(matchId, pointsPerSet) {
    const match = db.prepare('SELECT * FROM matches WHERE id = ?').get(matchId);
    const squad = db.prepare('SELECT player_id FROM match_players WHERE match_id = ?').all(matchId).map((r) => r.player_id);
    if (!squad.length) return false;
    const player = squad[0];

    let sequence = 0;
    for (let set = 1; set <= int(2, 3); set += 1) {
      const info = periodStmt.run(matchId, set, `Set ${set}`, match.home_team_id, null,
        match.opponent_name, pointsPerSet, null, 'complete');
      const periodId = info.lastInsertRowid;

      let us = 0;
      let them = 0;
      while (us < pointsPerSet && them < pointsPerSet) {
        const won = chance(0.53);
        if (won) us += 1; else them += 1;
        sequence += 1;
        eventStmt.run(matchId, periodId, sequence, 'point', null, null, null, null,
          match.home_team_id, player, null, null, int(5, 95), int(5, 95),
          won ? 'won' : 'lost',
          JSON.stringify({
            won_by_us: won ? 1 : 0,
            reason: won
              ? pick(['winner', 'smash', 'drop', 'service ace', 'forced error'])
              : pick(['unforced error', 'service fault', 'forced error']),
            rally_length: int(1, 28),
            serving: chance(0.5) ? 1 : 0,
            duration_seconds: int(4, 45),
          }), statsUserId);
        eventCount += 1;
      }
    }
    scoredMatches += 1;
    return true;
  }

  const round1 = (n) => Math.round(n * 10) / 10;

  tx(() => {
    const cricketMatches = db
      .prepare(`SELECT id FROM matches WHERE sport_id = ? AND status = 'completed' ORDER BY scheduled_at DESC LIMIT 4`)
      .all(sportId('cricket'));
    cricketMatches.forEach((m) => scoreCricketMatch(m.id));

    const footballMatches = db
      .prepare(`SELECT id FROM matches WHERE sport_id = ? AND status = 'completed' ORDER BY scheduled_at DESC LIMIT 3`)
      .all(sportId('football'));
    footballMatches.forEach((m) => scoreFootballMatch(m.id));

    const basketballMatches = db
      .prepare(`SELECT id FROM matches WHERE sport_id = ? AND status = 'completed' ORDER BY scheduled_at DESC LIMIT 2`)
      .all(sportId('basketball'));
    basketballMatches.forEach((m) => scoreBasketballMatch(m.id));

    const badmintonMatches = db
      .prepare(`SELECT id FROM matches WHERE sport_id = ? AND status = 'completed' ORDER BY scheduled_at DESC LIMIT 2`)
      .all(sportId('badminton'));
    badmintonMatches.forEach((m) => scoreRacketMatch(m.id, 21));

    const ttMatches = db
      .prepare(`SELECT id FROM matches WHERE sport_id = ? AND status = 'completed' ORDER BY scheduled_at DESC LIMIT 1`)
      .all(sportId('table_tennis'));
    ttMatches.forEach((m) => scoreRacketMatch(m.id, 11));
  });

  // Rebuild the scorecards of every ball-by-ball match from its events, so the
  // derived statistics replace the summary figures generated earlier.
  const { refreshPerformances } = require('../routes/match-events');
  const scored = db.prepare('SELECT DISTINCT match_id FROM match_events').all();
  let rebuilt = 0;
  for (const row of scored) {
    const m = db.prepare('SELECT * FROM matches WHERE id = ?').get(row.match_id);
    const sp = db.prepare('SELECT * FROM sports WHERE id = ?').get(m.sport_id);
    const result = refreshPerformances(m, { ...sp, config: JSON.parse(sp.config_json) }, adminId);
    rebuilt += result.updated;
  }
  console.log(`[seed] ${eventCount} events across ${scoredMatches} matches; ${rebuilt} scorecards rebuilt from them`);

  const counts = {
    users: db.prepare('SELECT COUNT(*) AS c FROM users').get().c,
    players: db.prepare('SELECT COUNT(*) AS c FROM players').get().c,
    teams: db.prepare('SELECT COUNT(*) AS c FROM teams').get().c,
    matches: db.prepare('SELECT COUNT(*) AS c FROM matches').get().c,
    performances: db.prepare('SELECT COUNT(*) AS c FROM match_performances').get().c,
    training: db.prepare('SELECT COUNT(*) AS c FROM training_sessions').get().c,
    assessments: db.prepare('SELECT COUNT(*) AS c FROM assessments').get().c,
    achievements: db.prepare('SELECT COUNT(*) AS c FROM achievements').get().c,
    timeline: db.prepare('SELECT COUNT(*) AS c FROM player_timeline').get().c,
    events: db.prepare('SELECT COUNT(*) AS c FROM match_events').get().c,
    periods: db.prepare('SELECT COUNT(*) AS c FROM match_periods').get().c,
  };

  console.log('\n[seed] demo club ready');
  console.table(counts);
  console.log('\n  Sign in with any of these (password: Karwan@2026)');
  console.log('  admin@playerarc.local            Super Admin');
  console.log('  director@karwansportsclub.com         Sports Director');
  console.log('  cricket.admin@karwansportsclub.com    Sport Administrator (cricket only)');
  console.log('  coach.cricket@karwansportsclub.com    Coach (cricket teams only)');
  console.log('  stats@karwansportsclub.com            Statistician');
  console.log('  player@karwansportsclub.com           Player (own record only)');
  console.log('  parent@karwansportsclub.com           Parent / Guardian\n');
}

async function seedAdminOnly() {
  const hash = await bcrypt.hash('Karwan@2026', 10);
  const role = db.prepare(`SELECT id FROM roles WHERE key = 'super_admin'`).get();
  db.prepare(`INSERT OR IGNORE INTO users (email, password_hash, full_name, role_id, status) VALUES (?,?,?,?, 'active')`)
    .run('admin@playerarc.local', hash, 'Bobby Sharon', role.id);
  console.log('[seed] administrator account created: admin@playerarc.local / Karwan@2026');
}

main().catch((err) => {
  console.error('[seed] failed:', err);
  process.exit(1);
});
