-- =====================================================================
-- PlayerArc — Athlete Records & Performance Management Platform
-- Karwan Sports Club
-- Schema: SQLite (portable to PostgreSQL — see docs/ARCHITECTURE.md)
--
-- Design rules:
--   * The Player is the central entity. One master identity, forever.
--   * Common concepts are shared tables; sport-specific data is driven by
--     sports.config_json, so a new sport is a row, not a rebuild.
--   * History is never overwritten — memberships, statuses, attributes
--     and assessments are append-only with effective dating.
-- =====================================================================

PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------------
-- 1. IDENTITY & ACCESS
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS roles (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  key           TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  description   TEXT,
  rank          INTEGER NOT NULL DEFAULT 100,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  full_name     TEXT NOT NULL,
  role_id       INTEGER NOT NULL REFERENCES roles(id),
  phone         TEXT,
  avatar_url    TEXT,
  status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','invited')),
  must_change_password INTEGER NOT NULL DEFAULT 0,
  last_login_at TEXT,
  is_demo       INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role_id);

-- Sport administrators are scoped to one or more sports
CREATE TABLE IF NOT EXISTS user_sport_scopes (
  user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sport_id  INTEGER NOT NULL REFERENCES sports(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, sport_id)
);

-- Coaches are scoped to one or more teams
CREATE TABLE IF NOT EXISTS user_team_scopes (
  user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  team_id   INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, team_id)
);

-- Player self-service and parent/guardian portal links
CREATE TABLE IF NOT EXISTS user_player_links (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  player_id    INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  relationship TEXT NOT NULL DEFAULT 'self' CHECK (relationship IN ('self','parent','guardian')),
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_id, player_id)
);

-- ---------------------------------------------------------------------
-- 2. SPORT CONFIGURATION (the multi-sport engine)
--    config_json holds: positions, statFields, derived formulas,
--    rating model, match formats. Adding a sport requires no code change.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sports (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  code         TEXT NOT NULL UNIQUE,
  name         TEXT NOT NULL,
  category     TEXT NOT NULL DEFAULT 'team' CHECK (category IN ('team','individual','racket','indoor')),
  description  TEXT,
  color        TEXT,
  icon         TEXT,
  config_json  TEXT NOT NULL DEFAULT '{}',
  is_active    INTEGER NOT NULL DEFAULT 1,
  sort_order   INTEGER NOT NULL DEFAULT 100,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS seasons (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  sport_id    INTEGER REFERENCES sports(id) ON DELETE CASCADE,  -- NULL = club-wide
  start_date  TEXT NOT NULL,
  end_date    TEXT NOT NULL,
  is_current  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (name, sport_id)
);

-- ---------------------------------------------------------------------
-- 3. PLAYERS — the master identity
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS players (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  athlete_id         TEXT NOT NULL UNIQUE,          -- KSC-PLY-000001
  first_name         TEXT NOT NULL,
  last_name          TEXT NOT NULL,
  display_name       TEXT,
  dob                TEXT,
  gender             TEXT CHECK (gender IN ('male','female','other')),
  nationality        TEXT,
  photo_url          TEXT,
  registration_date  TEXT NOT NULL DEFAULT (date('now')),
  status             TEXT NOT NULL DEFAULT 'active'
                     CHECK (status IN ('active','inactive','injured','on_loan','suspended','retired','alumni','trial')),
  -- contact (restricted fields)
  phone              TEXT,
  email              TEXT,
  address            TEXT,
  city               TEXT,
  country            TEXT,
  emergency_name     TEXT,
  emergency_phone    TEXT,
  emergency_relation TEXT,
  guardian_name      TEXT,
  guardian_phone     TEXT,
  guardian_email     TEXT,
  -- physical
  height_cm          REAL,
  weight_kg          REAL,
  preferred_hand     TEXT CHECK (preferred_hand IN ('right','left','both')),
  preferred_foot     TEXT CHECK (preferred_foot IN ('right','left','both')),
  blood_group        TEXT,
  -- meta
  bio                TEXT,
  notes              TEXT,
  visibility         TEXT NOT NULL DEFAULT 'club' CHECK (visibility IN ('public','club','staff','private')),
  is_demo            INTEGER NOT NULL DEFAULT 0,
  created_by         INTEGER REFERENCES users(id),
  created_at         TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at         TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_players_status ON players(status);
CREATE INDEX IF NOT EXISTS idx_players_name ON players(last_name, first_name);
-- Duplicate-identity guard (same name + same DOB cannot be registered twice)
CREATE UNIQUE INDEX IF NOT EXISTS uq_players_identity
  ON players(lower(first_name), lower(last_name), ifnull(dob,''));

-- A player may play many sports. Never duplicate the player row.
CREATE TABLE IF NOT EXISTS player_sports (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  player_id      INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  sport_id       INTEGER NOT NULL REFERENCES sports(id) ON DELETE CASCADE,
  is_primary     INTEGER NOT NULL DEFAULT 0,
  position       TEXT,
  playing_role   TEXT,
  playing_level  TEXT CHECK (playing_level IN ('academy','development','senior','representative','recreational')),
  jersey_number  INTEGER,
  joined_date    TEXT,
  status         TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive','retired')),
  notes          TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (player_id, sport_id)
);
CREATE INDEX IF NOT EXISTS idx_player_sports_sport ON player_sports(sport_id);

-- Append-only status history
CREATE TABLE IF NOT EXISTS player_status_history (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  player_id      INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  status         TEXT NOT NULL,
  effective_from TEXT NOT NULL DEFAULT (date('now')),
  effective_to   TEXT,
  reason         TEXT,
  changed_by     INTEGER REFERENCES users(id),
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_status_hist_player ON player_status_history(player_id);

-- Append-only change log for position / jersey / level / sport changes
CREATE TABLE IF NOT EXISTS player_attribute_history (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  player_id      INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  sport_id       INTEGER REFERENCES sports(id) ON DELETE SET NULL,
  attribute      TEXT NOT NULL,
  old_value      TEXT,
  new_value      TEXT,
  effective_date TEXT NOT NULL DEFAULT (date('now')),
  changed_by     INTEGER REFERENCES users(id),
  note           TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_attr_hist_player ON player_attribute_history(player_id);

-- ---------------------------------------------------------------------
-- 4. COACHES & TEAMS
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS coaches (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER REFERENCES users(id) ON DELETE SET NULL,
  full_name     TEXT NOT NULL,
  sport_id      INTEGER REFERENCES sports(id) ON DELETE SET NULL,
  role          TEXT NOT NULL DEFAULT 'head_coach'
                CHECK (role IN ('head_coach','assistant_coach','specialist','fitness_trainer','physio','academy_coach')),
  qualification TEXT,
  phone         TEXT,
  email         TEXT,
  photo_url     TEXT,
  bio           TEXT,
  joined_date   TEXT,
  is_active     INTEGER NOT NULL DEFAULT 1,
  is_demo       INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS teams (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,
  code          TEXT,
  sport_id      INTEGER NOT NULL REFERENCES sports(id) ON DELETE CASCADE,
  age_group     TEXT,                    -- U14, U16, U18, Senior
  gender        TEXT DEFAULT 'male' CHECK (gender IN ('male','female','mixed')),
  level         TEXT DEFAULT 'academy'
                CHECK (level IN ('academy','development','senior','representative','recreational')),
  season_id     INTEGER REFERENCES seasons(id) ON DELETE SET NULL,
  head_coach_id INTEGER REFERENCES coaches(id) ON DELETE SET NULL,
  home_venue    TEXT,
  description   TEXT,
  is_active     INTEGER NOT NULL DEFAULT 1,
  is_demo       INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (name, sport_id, season_id)
);
CREATE INDEX IF NOT EXISTS idx_teams_sport ON teams(sport_id);

-- Historical roster. Old rows are closed with end_date, never deleted.
CREATE TABLE IF NOT EXISTS team_memberships (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  team_id       INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  player_id     INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  role          TEXT DEFAULT 'player'
                CHECK (role IN ('player','captain','vice_captain','wicket_keeper','goalkeeper')),
  jersey_number INTEGER,
  start_date    TEXT NOT NULL DEFAULT (date('now')),
  end_date      TEXT,
  status        TEXT NOT NULL DEFAULT 'active'
                CHECK (status IN ('active','ended','transferred','promoted')),
  notes         TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_memb_player ON team_memberships(player_id);
CREATE INDEX IF NOT EXISTS idx_memb_team ON team_memberships(team_id);
-- A player cannot hold two open memberships in the same team
CREATE UNIQUE INDEX IF NOT EXISTS uq_memb_active
  ON team_memberships(team_id, player_id) WHERE end_date IS NULL;

CREATE TABLE IF NOT EXISTS team_coaches (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  team_id    INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  coach_id   INTEGER NOT NULL REFERENCES coaches(id) ON DELETE CASCADE,
  role       TEXT DEFAULT 'head_coach',
  start_date TEXT NOT NULL DEFAULT (date('now')),
  end_date   TEXT,
  UNIQUE (team_id, coach_id, start_date)
);


-- Staff attached to an individual athlete: a personal trainer, physio or
-- mentor, separate from the coach who runs their team. Closed with an end
-- date rather than deleted, like every other assignment.
CREATE TABLE IF NOT EXISTS player_staff (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  player_id  INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  coach_id   INTEGER NOT NULL REFERENCES coaches(id) ON DELETE CASCADE,
  sport_id   INTEGER REFERENCES sports(id) ON DELETE SET NULL,
  role       TEXT NOT NULL DEFAULT 'coach'
             CHECK (role IN ('coach','assistant_coach','personal_trainer','fitness_trainer','physio','mentor','specialist')),
  start_date TEXT NOT NULL DEFAULT (date('now')),
  end_date   TEXT,
  notes      TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_player_staff ON player_staff(player_id);
-- One open assignment per athlete, staff member and role
CREATE UNIQUE INDEX IF NOT EXISTS uq_player_staff_active
  ON player_staff(player_id, coach_id, role) WHERE end_date IS NULL;

-- ---------------------------------------------------------------------
-- 5. COMPETITION: tournaments -> matches -> performances
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tournaments (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  sport_id    INTEGER NOT NULL REFERENCES sports(id) ON DELETE CASCADE,
  season_id   INTEGER REFERENCES seasons(id) ON DELETE SET NULL,
  format      TEXT,                 -- league, knockout, round-robin, T20
  level       TEXT,                 -- club, district, national, invitational
  age_group   TEXT,
  start_date  TEXT,
  end_date    TEXT,
  venue       TEXT,
  host        TEXT,
  description TEXT,
  status      TEXT NOT NULL DEFAULT 'upcoming'
              CHECK (status IN ('upcoming','ongoing','completed','cancelled')),
  is_demo     INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_tour_sport ON tournaments(sport_id, season_id);

CREATE TABLE IF NOT EXISTS tournament_teams (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  tournament_id INTEGER NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  team_id       INTEGER REFERENCES teams(id) ON DELETE CASCADE,
  external_name TEXT,               -- opposition clubs not registered at Karwan
  group_name    TEXT,
  seed          INTEGER,
  UNIQUE (tournament_id, team_id, external_name)
);

CREATE TABLE IF NOT EXISTS matches (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  sport_id           INTEGER NOT NULL REFERENCES sports(id) ON DELETE CASCADE,
  tournament_id      INTEGER REFERENCES tournaments(id) ON DELETE SET NULL,
  season_id          INTEGER REFERENCES seasons(id) ON DELETE SET NULL,
  match_no           TEXT,
  stage              TEXT,           -- group, semi-final, final, friendly
  match_type         TEXT NOT NULL DEFAULT 'team'
                     CHECK (match_type IN ('team','singles','doubles')),
  format             TEXT,           -- T20, 40-over, 90-min, best-of-3
  scheduled_at       TEXT NOT NULL,
  duration_minutes   INTEGER,
  venue              TEXT,
  home_team_id       INTEGER REFERENCES teams(id) ON DELETE SET NULL,
  away_team_id       INTEGER REFERENCES teams(id) ON DELETE SET NULL,
  opponent_name      TEXT,           -- external opposition when not a club team
  is_home            INTEGER NOT NULL DEFAULT 1,
  status             TEXT NOT NULL DEFAULT 'scheduled'
                     CHECK (status IN ('scheduled','live','completed','abandoned','cancelled')),
  result             TEXT CHECK (result IN ('win','loss','draw','tie','no_result')),
  home_score         TEXT,
  away_score         TEXT,
  winner_team_id     INTEGER REFERENCES teams(id) ON DELETE SET NULL,
  result_summary     TEXT,
  toss_winner        TEXT,
  toss_decision      TEXT,
  officials          TEXT,
  player_of_match_id INTEGER REFERENCES players(id) ON DELETE SET NULL,
  notes              TEXT,
  is_demo            INTEGER NOT NULL DEFAULT 0,
  created_by         INTEGER REFERENCES users(id),
  created_at         TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at         TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_match_sport_date ON matches(sport_id, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_match_tour ON matches(tournament_id);
-- Duplicate-fixture guard
CREATE UNIQUE INDEX IF NOT EXISTS uq_match_fixture
  ON matches(sport_id, scheduled_at, ifnull(home_team_id,0), ifnull(away_team_id,0), ifnull(opponent_name,''));

-- Squad / playing XI / lineup
CREATE TABLE IF NOT EXISTS match_players (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  match_id       INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  player_id      INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  team_id        INTEGER REFERENCES teams(id) ON DELETE SET NULL,
  partner_id     INTEGER REFERENCES players(id) ON DELETE SET NULL,  -- doubles
  is_starting    INTEGER NOT NULL DEFAULT 1,
  is_substitute  INTEGER NOT NULL DEFAULT 0,
  is_captain     INTEGER NOT NULL DEFAULT 0,
  is_keeper      INTEGER NOT NULL DEFAULT 0,
  position       TEXT,
  jersey_number  INTEGER,
  batting_order  INTEGER,
  minutes_played INTEGER,
  UNIQUE (match_id, player_id)
);
CREATE INDEX IF NOT EXISTS idx_mp_player ON match_players(player_id);

-- Sport-specific statistics, validated against sports.config_json
CREATE TABLE IF NOT EXISTS match_performances (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  match_id    INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  player_id   INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  sport_id    INTEGER NOT NULL REFERENCES sports(id) ON DELETE CASCADE,
  team_id     INTEGER REFERENCES teams(id) ON DELETE SET NULL,
  stats_json  TEXT NOT NULL DEFAULT '{}',
  rating      REAL,
  is_motm     INTEGER NOT NULL DEFAULT 0,
  notes       TEXT,
  created_by  INTEGER REFERENCES users(id),
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (match_id, player_id)
);
CREATE INDEX IF NOT EXISTS idx_perf_player_sport ON match_performances(player_id, sport_id);

-- Forward-compatible ball-by-ball / event store (cricket, football, etc.).
-- Not populated in Phase 2, but the relationship exists so live scoring can
-- be added later without restructuring.
CREATE TABLE IF NOT EXISTS match_events (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  match_id            INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  innings             INTEGER,
  sequence            INTEGER NOT NULL,
  period              TEXT,          -- over number, quarter, set
  clock               TEXT,
  event_type          TEXT NOT NULL, -- ball, goal, card, substitution, point
  primary_player_id   INTEGER REFERENCES players(id) ON DELETE SET NULL,
  secondary_player_id INTEGER REFERENCES players(id) ON DELETE SET NULL,
  payload_json        TEXT NOT NULL DEFAULT '{}',
  created_at          TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_events_match ON match_events(match_id, sequence);

-- ---------------------------------------------------------------------
-- 6. TRAINING
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS training_sessions (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  sport_id              INTEGER NOT NULL REFERENCES sports(id) ON DELETE CASCADE,
  team_id               INTEGER REFERENCES teams(id) ON DELETE SET NULL,
  coach_id              INTEGER REFERENCES coaches(id) ON DELETE SET NULL,
  title                 TEXT,
  session_date          TEXT NOT NULL,
  start_time            TEXT,
  duration_minutes      INTEGER NOT NULL DEFAULT 90,
  training_type         TEXT NOT NULL DEFAULT 'technical'
                        CHECK (training_type IN ('technical','tactical','fitness','strength','skills','match_practice','recovery','video_analysis')),
  location              TEXT,
  objectives            TEXT,
  exercises_json        TEXT NOT NULL DEFAULT '[]',
  skills_json           TEXT NOT NULL DEFAULT '[]',
  coach_notes           TEXT,
  areas_for_improvement TEXT,
  intensity             INTEGER CHECK (intensity BETWEEN 1 AND 10),
  is_demo               INTEGER NOT NULL DEFAULT 0,
  created_by            INTEGER REFERENCES users(id),
  created_at            TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at            TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_train_team_date ON training_sessions(team_id, session_date);

CREATE TABLE IF NOT EXISTS training_attendance (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id            INTEGER NOT NULL REFERENCES training_sessions(id) ON DELETE CASCADE,
  player_id             INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  status                TEXT NOT NULL DEFAULT 'present'
                        CHECK (status IN ('present','absent','late','excused','injured')),
  arrival_time          TEXT,
  performance_score     REAL CHECK (performance_score BETWEEN 0 AND 10),
  effort_score          REAL CHECK (effort_score BETWEEN 0 AND 10),
  coach_notes           TEXT,
  areas_for_improvement TEXT,
  UNIQUE (session_id, player_id)
);
CREATE INDEX IF NOT EXISTS idx_att_player ON training_attendance(player_id);

-- ---------------------------------------------------------------------
-- 7. ASSESSMENTS (append-only development record)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS assessment_criteria (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  key         TEXT NOT NULL,
  name        TEXT NOT NULL,
  category    TEXT NOT NULL CHECK (category IN ('physical','technical','tactical','behavioural')),
  sport_id    INTEGER REFERENCES sports(id) ON DELETE CASCADE,   -- NULL = all sports
  age_group   TEXT,                                              -- NULL = all age groups
  scale_min   REAL NOT NULL DEFAULT 0,
  scale_max   REAL NOT NULL DEFAULT 10,
  unit        TEXT,
  weight      REAL NOT NULL DEFAULT 1,
  higher_is_better INTEGER NOT NULL DEFAULT 1,
  description TEXT,
  is_active   INTEGER NOT NULL DEFAULT 1,
  sort_order  INTEGER NOT NULL DEFAULT 100,
  UNIQUE (key, sport_id, age_group)
);

CREATE TABLE IF NOT EXISTS assessments (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  player_id        INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  sport_id         INTEGER NOT NULL REFERENCES sports(id) ON DELETE CASCADE,
  team_id          INTEGER REFERENCES teams(id) ON DELETE SET NULL,
  assessed_by      INTEGER REFERENCES coaches(id) ON DELETE SET NULL,
  assessment_date  TEXT NOT NULL,
  cycle            TEXT,                 -- Monthly / Quarterly / Pre-season
  age_group        TEXT,
  overall_score    REAL,
  summary          TEXT,
  recommendation   TEXT,
  next_review_date TEXT,
  is_demo          INTEGER NOT NULL DEFAULT 0,
  created_by       INTEGER REFERENCES users(id),
  created_at       TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_assess_player ON assessments(player_id, assessment_date);

CREATE TABLE IF NOT EXISTS assessment_scores (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  assessment_id INTEGER NOT NULL REFERENCES assessments(id) ON DELETE CASCADE,
  criteria_id   INTEGER NOT NULL REFERENCES assessment_criteria(id) ON DELETE CASCADE,
  score         REAL NOT NULL,
  comment       TEXT,
  UNIQUE (assessment_id, criteria_id)
);

-- ---------------------------------------------------------------------
-- 8. ACHIEVEMENTS & AWARDS
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS achievements (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  player_id     INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  title         TEXT NOT NULL,
  category      TEXT NOT NULL DEFAULT 'match'
                CHECK (category IN ('match','tournament','season','academy','selection','representative','milestone','coach_award')),
  level         TEXT DEFAULT 'club' CHECK (level IN ('club','district','state','national','international')),
  sport_id      INTEGER REFERENCES sports(id) ON DELETE SET NULL,
  tournament_id INTEGER REFERENCES tournaments(id) ON DELETE SET NULL,
  match_id      INTEGER REFERENCES matches(id) ON DELETE SET NULL,
  team_id       INTEGER REFERENCES teams(id) ON DELETE SET NULL,
  awarded_date  TEXT NOT NULL,
  description   TEXT,
  media_id      INTEGER,
  is_demo       INTEGER NOT NULL DEFAULT 0,
  created_by    INTEGER REFERENCES users(id),
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ach_player ON achievements(player_id, awarded_date);

-- ---------------------------------------------------------------------
-- 9. CAREER TIMELINE (system-generated + manual)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS player_timeline (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  player_id   INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  event_date  TEXT NOT NULL,
  event_type  TEXT NOT NULL,   -- registration, sport_added, team_joined, team_left, promotion,
                               -- match, debut, milestone, achievement, assessment, status_change, note
  title       TEXT NOT NULL,
  description TEXT,
  sport_id    INTEGER REFERENCES sports(id) ON DELETE SET NULL,
  ref_table   TEXT,
  ref_id      INTEGER,
  importance  INTEGER NOT NULL DEFAULT 2 CHECK (importance BETWEEN 1 AND 3),
  is_system   INTEGER NOT NULL DEFAULT 1,
  created_by  INTEGER REFERENCES users(id),
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_timeline_player ON player_timeline(player_id, event_date);
CREATE UNIQUE INDEX IF NOT EXISTS uq_timeline_system
  ON player_timeline(player_id, event_type, ifnull(ref_table,''), ifnull(ref_id,0)) WHERE is_system = 1;

-- ---------------------------------------------------------------------
-- 10. MEDIA & DOCUMENTS (access controlled)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS media (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_type   TEXT NOT NULL CHECK (owner_type IN ('player','match','tournament','training','achievement','team')),
  owner_id     INTEGER NOT NULL,
  player_id    INTEGER REFERENCES players(id) ON DELETE CASCADE,  -- fast gallery lookup
  kind         TEXT NOT NULL DEFAULT 'photo'
               CHECK (kind IN ('photo','video','highlight','certificate','document','link')),
  title        TEXT NOT NULL,
  description  TEXT,
  file_path    TEXT,
  external_url TEXT,
  mime         TEXT,
  size_bytes   INTEGER,
  visibility   TEXT NOT NULL DEFAULT 'club' CHECK (visibility IN ('public','club','staff','private')),
  is_approved  INTEGER NOT NULL DEFAULT 0,
  uploaded_by  INTEGER REFERENCES users(id),
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_media_owner ON media(owner_type, owner_id);

CREATE TABLE IF NOT EXISTS documents (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  player_id   INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  doc_type    TEXT NOT NULL
              CHECK (doc_type IN ('registration','identification','birth_certificate','medical','consent','certificate','photo_id','other')),
  title       TEXT NOT NULL,
  file_path   TEXT,
  mime        TEXT,
  size_bytes  INTEGER,
  issue_date  TEXT,
  expiry_date TEXT,
  is_verified INTEGER NOT NULL DEFAULT 0,
  verified_by INTEGER REFERENCES users(id),
  visibility  TEXT NOT NULL DEFAULT 'staff' CHECK (visibility IN ('club','staff','private')),
  uploaded_by INTEGER REFERENCES users(id),
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_docs_player ON documents(player_id);

-- ---------------------------------------------------------------------
-- 11. RANKINGS (saved snapshots; live leaderboards are computed)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ranking_snapshots (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  title        TEXT NOT NULL,
  sport_id     INTEGER REFERENCES sports(id) ON DELETE CASCADE,
  season_id    INTEGER REFERENCES seasons(id) ON DELETE SET NULL,
  metric       TEXT NOT NULL,
  filters_json TEXT NOT NULL DEFAULT '{}',
  results_json TEXT NOT NULL DEFAULT '[]',
  generated_by INTEGER REFERENCES users(id),
  generated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------------------
-- 12. SYSTEM
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_logs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  user_email  TEXT,
  action      TEXT NOT NULL,          -- create, update, delete, login, login_failed, export, download
  entity      TEXT NOT NULL,
  entity_id   INTEGER,
  summary     TEXT,
  before_json TEXT,
  after_json  TEXT,
  ip          TEXT,
  user_agent  TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_logs(entity, entity_id);

CREATE TABLE IF NOT EXISTS settings (
  key        TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_by INTEGER REFERENCES users(id),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
