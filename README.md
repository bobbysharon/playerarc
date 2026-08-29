# PlayerArc

**Athlete Records & Performance Management Platform for Karwan Sports Club**

> One athlete. Every sport. The whole journey.

PlayerArc is the central source of truth for athlete records at Karwan Sports Club. Every player
holds one permanent identity — `KSC-PLY-000001` — that follows them through every sport, team, age
group, match, training session, assessment and award for as long as they are at the club.

The question the platform is built to answer: *pick any athlete, and can you understand their
complete sporting journey from one place?*

---

## What it does

| Module | What it holds |
| --- | --- |
| **Athletes** | One master record per person: identity, contact, guardian, physical profile, documents, status history |
| **Sports** | Cricket, football, basketball, badminton, table tennis, futsal, volleyball — each defining its own positions, statistics and rating model |
| **Teams** | Squads by sport, age group and season, with roster history that is closed rather than deleted |
| **Tournaments** | Competitions, entered teams, fixtures, results, awards and per-tournament leaderboards |
| **Matches** | Fixtures, playing XI / lineup, and per-player statistics entered against the sport's own schema |
| **Training** | Sessions, exercises, attendance, per-athlete performance and effort scores, coach notes |
| **Assessments** | Configurable criteria across physical, technical, tactical and behavioural categories — append-only, so development is visible over years |
| **Achievements** | Awards, selections and milestones, flowing onto the athlete's timeline |
| **Career timeline** | Registration, sport added, team joined, promotion, debut, milestone, assessment, award — assembled automatically |
| **Rankings** | Per-sport leaderboards with qualification thresholds; never cross-sport |
| **Reports** | Player, team, tournament, sport and coach reports, with CSV, Excel and PDF export |
| **Administration** | Users, roles, data scopes, audit log, demo data management |

---

## Running it

Requires **Node.js 20 or later**. No database server to install — SQLite is embedded.

```bash
git clone <your-repo-url> playerarc
cd playerarc

cp .env.example .env          # then set JWT_SECRET to a long random string
npm install
npm run db:reset              # creates the schema and seeds the demonstration club
npm run dev                   # API on :4000, web app on :5173
```

Open **http://localhost:5173** and sign in.

### Demonstration accounts

Password for all: `Karwan@2026`

| Email | Role | What they see |
| --- | --- | --- |
| `admin@karwansc.com` | Super Admin | Everything, including users, settings and the audit log |
| `director@karwansc.com` | Sports Director | All sports, athletes, teams, competitions and performance data |
| `cricket.admin@karwansc.com` | Sport Administrator | Cricket only |
| `coach.cricket@karwansc.com` | Coach | Only the cricket teams assigned to them; contact details are hidden |
| `stats@karwansc.com` | Statistician | Match records and statistics across all sports |
| `player@karwansc.com` | Player | Their own record only |
| `parent@karwansc.com` | Parent / Guardian | Their linked child's record only |

Signing in as the coach and then the director is the quickest way to see role scoping working — the
coach sees a fraction of the athlete list, and contact details are stripped from what they receive.

### Production build

```bash
npm run build        # builds the web app into web/dist
npm start            # the API serves the built app on :4000
```

### Verifying the installation

```bash
npm start                       # in one terminal
node scripts/smoke-test.mjs     # in another — 44 checks across every module
```

---

## How it is put together

```
playerarc/
├── server/                     Node.js + Express API, SQLite via better-sqlite3
│   └── src/
│       ├── db/schema.sql       33 tables — the full relational model
│       ├── db/seed.js          Sport definitions, criteria, and the demo club
│       ├── lib/
│       │   ├── sport-configs.js   Every sport defined as data, not code
│       │   ├── stats-engine.js    Career aggregation, ratings, validation
│       │   ├── formula.js         Safe evaluator for configured formulas
│       │   ├── permissions.js     Role matrix and field redaction
│       │   ├── timeline.js        Career timeline and milestone detection
│       │   └── repo.js            Shared career/statistics queries
│       ├── middleware/         auth · scope · audit · errors
│       └── routes/             12 route modules
├── web/                        React 18 + Vite + Tailwind
│   └── src/
│       ├── components/ui.jsx   Shared interface: tables, charts, career spine
│       ├── lib/                API client, auth context, formatting
│       └── pages/              20 screens
├── docs/                       Architecture, data model, permissions, API
└── scripts/smoke-test.mjs      End-to-end verification
```

Full detail is in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md),
[`docs/DATA-MODEL.md`](docs/DATA-MODEL.md), [`docs/PERMISSIONS.md`](docs/PERMISSIONS.md) and
[`docs/API.md`](docs/API.md).

---

## Three decisions worth knowing about

**1. Adding a sport is a row, not a release.**
Positions, the statistics captured per match, how those roll up into a career record, the rating
model and the leaderboards all live in `sports.config_json`. Volleyball and futsal were added to the
seed without touching a route, a form or a query. The match statistics form renders from that
configuration, including position-specific fields — a goalkeeper is asked about saves, a striker is
not. See `server/src/lib/sport-configs.js`.

**2. Career statistics are computed, never stored as running totals.**
When a scorer corrects a typo in a match from two seasons ago, every affected career record, rating
and leaderboard is right on the next read, because they are aggregated from the underlying
performances each time. Nothing has to be recalculated or repaired. See
`server/src/lib/stats-engine.js`.

**3. History is closed, not overwritten.**
Team memberships get an end date. Status changes append to a status history. Position, level and
jersey changes append to an attribute history. Assessments are never edited in place. This is what
makes the platform a longitudinal record rather than a snapshot of the current squad.

---

## Requirements coverage

The build follows the phased approach in the requirements document. All five phases are implemented.

| Requirement | Where |
| --- | --- |
| 2 — Permanent athlete ID, one identity across sports | `lib/ids.js`, unique index `uq_players_identity`, duplicate check on registration |
| 3 — Multi-sport architecture, no hard-coding | `sports.config_json` + `lib/sport-configs.js` |
| 4 — Player master profile | `players` table, Athletes page, profile tab |
| 5 — Career timeline | `player_timeline` + `lib/timeline.js`, the career spine on the profile |
| 6–9 — Cricket, football, basketball, racket statistics | Sport configs; scorecard renders from them |
| 10 — Team history preserved | `team_memberships` with start/end dating |
| 11–12 — Tournaments and matches | `routes/competitions.js` |
| 13 — Training | `routes/training.js`, attendance pre-filled from roster |
| 14–15 — Assessments and development | `assessment_criteria`, append-only `assessments`, development charts |
| 16 — Achievements | `routes/achievements.js`; Player of the Match created automatically |
| 17 — Configurable rating per sport | `ratingModel` in each sport config, evaluated by `lib/formula.js` |
| 18 — Media with permissions | `routes/media.js`, files streamed through access checks |
| 19 — Player dashboard | `pages/PlayerProfile.jsx` |
| 20 — Search and filtering | Global search, athlete filter panel |
| 21 — Reports and exports | `routes/analytics.js` — CSV, Excel, PDF |
| 22 — Rankings | Per-sport leaderboards with qualification thresholds |
| 23 — Roles | `lib/permissions.js`, eight roles |
| 24 — Privacy and security | JWT, bcrypt, field redaction, audit log, scoped queries |
| 25 — Admin dashboard | `pages/Dashboard.jsx` |
| 27–28 — Relational model, historical records | `db/schema.sql` |
| 29 — Scalability | Indexed foreign keys, paginated lists, Postgres-portable schema |
| 30 — Future features | `match_events` table exists for ball-by-ball; portal roles and public visibility already modelled |
| 34 — Data integrity | Unique indexes, cross-field statistic validation, scale checks |
| 35 — Demo data | `is_demo` flag on every seeded record; clearable from Settings |

### Deliberately left for later

Consistent with requirement 30, these are modelled but not built out: ball-by-ball cricket scoring
(the `match_events` table and relationships exist), public athlete profiles, player comparison,
video analysis, wearable integrations and notifications. None of them require schema restructuring.

---

## Moving to Postgres

The schema is written to port cleanly. Change `INTEGER PRIMARY KEY AUTOINCREMENT` to `SERIAL`,
`TEXT` timestamps to `TIMESTAMPTZ`, and the JSON columns to `JSONB`; then swap the `better-sqlite3`
calls in `server/src/db/index.js` for a `pg` pool. Route code uses positional parameters throughout,
so it needs no changes. The statistics engine operates on parsed JSON in application code and is
storage-agnostic.

---

## Licence

Proprietary — built for Karwan Sports Club.
