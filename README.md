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
| **Ball-by-ball capture** | Every delivery, shot, goal, rally and card — in each sport's own vocabulary, with actors, coordinates and full detail |
| **Match analysis** | Scorecards, run rates, partnerships, phases, wagon wheels, pitch maps, shot maps, momentum, head-to-head and commentary — all derived from the events |
| **Training** | Sessions, exercises, attendance, per-athlete performance and effort scores, coach notes |
| **Assessments** | Configurable criteria across physical, technical, tactical and behavioural categories — append-only, so development is visible over years |
| **Achievements** | Awards, selections and milestones, flowing onto the athlete's timeline |
| **Career timeline** | Registration, sport added, team joined, promotion, debut, milestone, assessment, award — assembled automatically |
| **Rankings** | Per-sport leaderboards with qualification thresholds; never cross-sport |
| **Reports** | Player, team, tournament, sport and coach reports, with CSV, Excel and PDF export |
| **User manager** | Accounts, roles, data scopes, staff and athlete links, passwords — super admin only |
| **Drill library** | Reusable drills with coaching points and equipment, and session plans built from them |
| **Ball tracking** | Release speed, pitch map to the centimetre, stump-line analysis and consistency against a stated target |
| **Fitness** | Test results, strength numbers and logged workouts, trended per metric |
| **Benchmarks** | Age-group standards, so a number is read against what "good" means for that group |
| **Selection** | Athletes compared side by side on figures already in their records |
| **Announcements** | Notices to the whole club, one sport, a squad or named athletes |
| **Showcase profile** | A shareable, revocable record for selectors — honours and statistics, never contact details |
| **Administration** | Audit log, settings, demo data management |

---

## Three ways to run it

### 1. Live demo — GitHub Pages

The repository ships a **browser-only demonstration**: the full interface and the seeded club,
running entirely in the page with no server and no database.

The built demo is committed to `docs/`, so publishing it takes one setting:

**Settings → Pages → Source → "Deploy from a branch" → Branch: `main`, folder: `/docs` → Save.**

Your site appears at `https://<username>.github.io/<repository-name>/` within a minute or two.

> **If it shows the README instead of the app**, the folder is still set to `/ (root)`. GitHub then
> runs the repository through Jekyll and renders `README.md`. Changing the folder to `/docs` is the
> fix — `docs/` contains an `index.html` and a `.nojekyll` file, which is what stops Jekyll taking
> over. Hard-refresh afterwards, since the old page will be cached.

Rebuilding it after a change:

```bash
npm run build:pages      # builds the demo and stages it in docs/
git add docs && git commit -m "Rebuild demo" && git push
```

The repository name is baked into the asset paths. If yours is not `playerarc`, set `VITE_BASE` in
`web/.env.demo` to `/<your-repository-name>/` before running `npm run build:pages`.

**If the site returns a 404 saying "you must provide an index.html file"**, something deployed the
repository root instead of the built app. The usual cause is the **Static HTML** workflow offered on
the Pages settings screen: pressing *Configure* on that card adds a second workflow that uploads
`path: '.'`, and whichever workflow deploys last wins. Check the Actions tab — if the most recent
run is not **Deploy demo to GitHub Pages**, delete the stray workflow file from
`.github/workflows/` and re-run ours. The workflow here refuses to publish an empty site, so a
failure shows up as a red build rather than a 404.

**Alternative — GitHub Actions.** `.github/workflows/deploy-demo.yml` builds and publishes on every
push and picks the repository name up automatically, so nothing is committed. It only runs if
**Settings → Pages → Source** is set to **GitHub Actions**; while the source is "Deploy from a
branch", the workflow succeeds and publishes nothing. Use whichever you prefer, not both.

**What is real in the demo:** every screen, the seeded club, career statistics computed by the same
engine the server uses, ball-by-ball capture and the full match analysis, per-sport ratings,
leaderboards, role permissions and field redaction. Changes you make persist until you reload.

**What is not:** sign-in is not secured — the demo compares a password in memory rather than a hash,
because password hashes must never ship to a browser. File uploads, Excel and PDF reports need the
server. Use the demo to show people the platform, not to run the club.

> Previewing locally: `npm run build:demo`, then `npm run preview:demo`.

### 2. Locally — the real platform

Requires **Node.js 20 or later**. No database server to install; SQLite is embedded.

```bash
git clone <your-repo-url> playerarc
cd playerarc

cp .env.example .env          # then set JWT_SECRET to a long random string
npm install
npm run db:reset              # creates the schema and seeds the demonstration club
npm run dev                   # API on :4000, web app on :5173
```

Open **http://localhost:5173** and sign in.

### 3. Hosted — the real platform on a live URL

GitHub Pages cannot host the real application: it serves static files only, and PlayerArc needs a
Node process and a database. Any host that runs Node will do.

**Render** — push to GitHub, then New → Blueprint and point it at the repository. `render.yaml`
describes the service, generates a `JWT_SECRET`, and attaches a disk so the database and uploads
survive redeploys. Set `CORS_ORIGIN` to your actual URL once it is assigned.

**Docker** — anywhere that runs containers:

```bash
docker build -t playerarc .
docker run -p 4000:4000 -e JWT_SECRET=<long-random-string> \
  -v playerarc-data:/app/server/data playerarc
```

Railway, Fly.io and a plain VPS all work the same way: build, then `npm start`.

### Demonstration accounts

Password for all: `Karwan@2026`

| Email | Role | What they see |
| --- | --- | --- |
| `admin@playerarc.local` | Administrator | Everything, including users, settings and the audit log |
| `director@karwansportsclub.com` | Sports Director | All sports, athletes, teams, competitions and performance data |
| `cricket.admin@playerarc.local` | Sport Administrator | Cricket only |
| `coach.cricket@karwansportsclub.com` | Coach | Only the cricket teams assigned to them; contact details are hidden |
| `stats@karwansportsclub.com` | Statistician | Match records and statistics across all sports |
| `player@karwansportsclub.com` | Player | Their own record only |
| `parent@karwansportsclub.com` | Parent / Guardian | Their linked child's record only |

Signing in as the coach and then the director is the quickest way to see role scoping working — the
coach sees a fraction of the athlete list, and contact details are stripped from what they receive.

These credentials are documented here only. The sign-in screen does not list accounts or show a
password, so anyone opening the demo needs to be told what to use.

### Production build

```bash
npm run build        # builds the web app into web/dist
npm start            # the API serves the built app on :4000
```

### Verifying the installation

```bash
npm start                       # in one terminal
node scripts/smoke-test.mjs     # in another — 98 checks against the live API
node scripts/demo-test.mjs      # 78 checks against the browser demo
```

`package-lock.json` is committed, so every environment installs the same dependency tree.

One wrinkle worth knowing: `better-sqlite3` ships prebuilt binaries inside its package, but npm
still starts a `node-gyp` rebuild because the package contains a `binding.gyp`. That rebuild needs a
C++ toolchain and network access to `nodejs.org`, and it produces a binary identical to the one
already there. The Docker and Render builds therefore use `npm ci --ignore-scripts`, which uses the
shipped binary. If you hit a `node-gyp` error installing locally, the same flag fixes it. The
GitHub Pages build sidesteps this entirely — it installs only the `web` workspace, which has no
native dependencies.

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
│       │   ├── event-configs.js   Ball-by-ball event types and derivation rules
│       │   ├── match-analysis.js  Scorecards and analysis derived from events
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
│       ├── pages/              20 screens
│       └── demo/               Browser-only backend for the static build
│           ├── api.js          Answers the same calls the server does
│           ├── dataset.json    Exported from the seeded database
│           └── engine/         Generated from the server's shared modules
├── docs/                       Architecture, data model, permissions, API
│                               — and the built demo GitHub Pages serves
├── .github/workflows/          GitHub Pages deployment
├── Dockerfile · render.yaml    Hosting the real platform
└── scripts/
    ├── smoke-test.mjs          End-to-end API verification
    ├── demo-test.mjs           Browser demo verification
    ├── export-demo-data.mjs    Database → demo dataset
    └── build-demo-engine.mjs   Server modules → demo engine
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

**4. A match is recorded as events — in any sport — and everything else is read off them.**
A scorer records one delivery — runs, extras, shot, length, line, delivery type, speed, whether the
batter was in control, who took the catch, where the ball went. From that single stream the platform
derives the batting and bowling cards, run rate, partnerships, fall of wickets, phase splits, wagon
wheel, pitch map, dot-ball and control percentages, head-to-head matchups and the commentary feed —
and then the athlete's career record, rating and league position, because the scorecard itself is
derived too. Nobody types a scorecard for a match that was scored ball by ball, and correcting one
delivery corrects every figure built on it. Football, basketball and the racket sports work the same
way with their own event types, defined as configuration rather than code: football and futsal
record shots, key passes, defensive actions, saves, cards and substitutions; basketball records
shots by value, rebounds, turnovers and fouls; badminton, table tennis and volleyball record every
rally with how the point was won and how long it lasted. All seven sports are verified end to end —
capture, derivation and analysis — by the test suite.

One consequence worth knowing: once a match is scored ball by ball, the events become the source of
truth for anything they can produce. If a scorecard was typed first, those figures are recomputed
from the deliveries, because otherwise the same runs would be counted twice. The scoring console
says so plainly the first time it happens rather than letting a career average change quietly.

**5. The interface is dark, and colour carries meaning.**
Near-black canvas, slate panels, and an amber-to-orange gradient on everything primary — the same
system as Aura King. Colour is not decoration: each sport carries its own colour from the database
through cards, chips, charts and timeline entries, and status pills use a fixed accent map (emerald
for active and won, rose for injured and lost, amber for pending, sky for scheduled, violet for
drawn). Every text colour was checked against every surface for WCAG AA contrast; two were adjusted
because they came in under 4.5:1.

**6. The demo shares the server's logic rather than copying it.**
A hand-written second implementation would drift the first time a rating formula changed.
`scripts/build-demo-engine.mjs` converts `stats-engine.js`, `formula.js` and `permissions.js` from
CommonJS to ES modules and writes them into the demo, so the browser computes career records and
applies permissions with the same code the server runs. Regenerate both with `npm run demo:data`
after changing a sport configuration or the seed.

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
| 23 — Roles | `lib/permissions.js`, eight roles; managed from the User manager |
| User & athlete administration | `pages/UserManager.jsx`, athlete team and staff assignment on the profile |
| 24 — Privacy and security | JWT, bcrypt, field redaction, audit log, scoped queries |
| 25 — Admin dashboard | `pages/Dashboard.jsx` |
| 27–28 — Relational model, historical records | `db/schema.sql` |
| 29 — Scalability | Indexed foreign keys, paginated lists, Postgres-portable schema |
| Ball-by-ball capture | `match_periods` + `match_events`, `lib/event-configs.js`, `pages/MatchScoring.jsx` |
| Full match analysis | `lib/match-analysis.js`, `pages/MatchAnalysis.jsx` |
| Statistics derived from events | `derive` rules per sport; `refreshPerformances()` in `routes/match-events.js` |
| 30 — Future features | Live scoring now built; portal roles and public visibility already modelled |
| 34 — Data integrity | Unique indexes, cross-field statistic validation, scale checks |
| 35 — Demo data | `is_demo` flag on every seeded record; clearable from Settings |
| Deployment | GitHub Pages demo, Docker image, Render blueprint |

### Deliberately left for later

Consistent with requirement 30, these are modelled but not built out: ball-by-ball cricket scoring
(the `match_events` table and relationships exist), public athlete profiles, player comparison,
video analysis, wearable integrations and notifications. None of them require schema restructuring.

---

## Recording a match in full

Open a match and choose **Score ball by ball**. The console renders itself from the sport's event
configuration, so what you see depends on the sport:

| Sport | A period is | You record |
| --- | --- | --- |
| Cricket | an innings | every delivery: runs, extras, shot, length, line, delivery type, speed, control, edge, appeal, dropped catch, wicket and dismissal, plus where the ball went |
| Football / futsal | a half | shots with body part and situation, key passes, tackles and interceptions, saves, fouls, cards, substitutions, all with pitch coordinates |
| Basketball | a quarter | shots by type and value with court coordinates, rebounds, assists, blocks, steals, turnovers, fouls |
| Badminton / table tennis | a set | every rally: who won it, how, rally length, whether they were serving, where it landed |
| Volleyball | a set | every rally: kill, block, ace or error, contacts in the rally |

Set the striker, bowler and fielder once and they stay until you change them. Tap an outcome to
record a delivery, or open **Full detail** for everything the sport declares. Cricket works out its
own over and ball number, and knows that a wide is re-bowled. **Undo last** removes a delivery
mid-over; an older one is voided rather than deleted, so the correction stays on the record.

Then open **Analysis**. Nothing there is stored — it is all computed from the events on each read,
which is why fixing one delivery fixes the scorecard, the run rate, the partnership, the bowler's
economy, the athlete's career average and their position on the leaderboard at once.

## The coaching layer

Four additions sit alongside the match record rather than replacing any of it.

**Drill library and session plans.** A drill is written once — coaching points, equipment, age
groups, how to make it harder — and reused. A session plan is an ordered set of drills with timings;
applying one to a session fills in its drills, and attendance still pre-fills from the roster. Open
**Drill library** under Development.

**Age-group benchmarks.** Twenty-four runs an innings is excellent at under-14 and modest for a
senior, so a raw figure says little on its own. Benchmarks give each metric four bands — developing,
competent, strong, exceptional — per age group, and the athlete's Development tab reads their record
against the group they actually play in. Metrics where lower is better, like economy rate, band the
other way round. Assessment criteria are banded the same way.

**Announcements.** A notice to the whole club, one sport, a single squad or a named handful of
athletes, with a priority and an expiry. Coaches see club-wide notices and anything for their own
teams; an athlete or guardian sees what was addressed to them.

**Showcase profile.** A shareable summary of an athlete's record for selectors and academies —
career statistics, honours, squads and milestones. The link is the credential: there is no sign-in,
and withdrawing it destroys the token so a copied URL genuinely stops working. Contact details,
guardians, documents, assessments and coach notes are never fetched for it, so there is nothing to
leak. Publish it from the athlete's profile.

## Ball tracking

Open **Ball tracking** under Analysis. A tracking session is a spell in the nets, a
bowling-machine block, or the tracked part of a match, and every delivery in it is measured.

The screen is built as an instrument panel rather than a set of tables: a speed dial with a peak
marker, a two-ring consistency gauge, a stump tower lit by how often each stump was struck, and the
pitch drawn in perspective so length reads as distance. Every graphic is an SVG generated from the
session's own numbers — there is no chart library behind them, because the shapes are specific.
Tapping a bowler re-reads all of it from their deliveries alone.

**What is measured and what is derived.** A delivery carries raw numbers: release speed, speed off
the pitch, where it bounced in centimetres, where it would have met the stumps, how much it moved.
Everything a coach looks at is worked out from those — the pitch map, the length and line
distribution, the stump-line breakdown, the consistency score. Correct one delivery's coordinates
and every figure built on it is right on the next read.

| Feature | How it works here |
| --- | --- |
| **Speed** | Release speed and speed off the pitch are recorded separately, because they answer different questions: the first is the bowler's effort, the second is what the batter faced. The drop between them is derived, and pace consistency is reported alongside the average |
| **Pitch mapping** | Coordinates in centimetres from a fixed origin — the batter's stumps at (0,0). Length and line zones are computed from the coordinate, so a map and a zone reading can never disagree |
| **Stump line** | Line *and* height together: a ball on middle that is still climbing goes over the top, so both are needed. Reported as a hit percentage with a per-stump breakdown |
| **Consistency zones** | Scored against a zone the bowler stated beforehand, stored as a rectangle in centimetres. A hit rate says how often they landed it; a tightness figure says how far out the misses were |
| **Scene calibration** | Pitch length, width, stump dimensions and crease distance are recorded per session. A centimetre means nothing without the frame it was measured in, so sessions carry theirs and uncalibrated ones are flagged |
| **Bowling machine** | A session mode with the machine's make, speed and setting stored, so machine work and live bowling are never averaged together |

**What this does not do.** No computer vision runs in this platform, and none is claimed. The
measurements come from a coach with a speed gun, a phone app, or a tracking provider — every
delivery records its `source`, so a measured figure is never confused with an estimated one. The
schema and the ingest endpoint are shaped to take a provider's output directly.

## Fitness

Test results, strength numbers and logged gym work sit on the athlete's record beside their playing
history. Each metric builds its own trend, and the direction of improvement follows the metric: a
faster 20m sprint is a smaller number, and the platform reads it that way.

## Evidence-led selection

`/selection/compare` puts a shortlist side by side on measures every one of them has — matches,
headline statistics, the latest assessment, training attendance, tracked accuracy and recent fitness
tests. Nothing is weighted or ranked. The point is to make a selection argument checkable, not to
make the decision.

## When a page fails

A render error in React unmounts the whole tree, which means a blank screen with no navigation — one
broken page becomes a total outage and the person cannot even go back to where they came from.

`components/PageErrorBoundary.jsx` sits *inside* the shell, so the sidebar and header survive a
failure: the page area explains what happened, shows the error message, and offers to retry or
reload, while the rest of the platform stays reachable. Navigating away clears it.

`web/scripts/error-boundary-test.mjs` mounts a component that throws on purpose and asserts the shell
is still standing.

## Dialogs

Every form dialog is centred and scrolls inside itself: the panel is capped to the viewport height,
its body is the scrolling region, and the title bar stays pinned while the form moves under it. The
submit button sits at the end of that scrolling region, so it is always reachable however long the
form is.

Two details are load-bearing and easy to undo by accident. The scrolling body needs `min-h-0` — as a
flex child without it, it grows to fit its content, the panel clips it, and nothing scrolls at all.
And the height cap is written as real CSS with a `100vh` value and a `@supports`-guarded `100dvh`
override, because an unrecognised `dvh` is dropped silently and a dropped cap brings the bug back.

`web/scripts/dialog-scroll-test.mjs` asserts all of it for every dialog in the app.

## Which build am I looking at?

The bottom of the sidebar shows a build timestamp, set when the bundle was compiled. If a change you
expect is missing, check it first: a browser showing an older stamp is running a cached page or an
older deployment, not a build with the change missing.

```bash
npm run build          # local
npm run build:pages    # then commit docs/ and push, for the GitHub Pages demo
```

Both builds write to `web/dist`, so whatever is there is not necessarily the one that should be
published. Staging the server build as the Pages demo produces a site where every request fails, and
the failure only shows up in a browser — so `publish-docs.mjs` checks the staged bundle really is the
demo build and refuses otherwise.

Hard-refresh (Ctrl+Shift+R) after deploying. The Pages demo only changes when you push.

## Signing in, and booking without an account

The sign-in screen is a single centred card: a choice between **Athlete** and **Staff**, email or
phone, password, and below a divider, **Book now as a guest**.

Athlete and staff are separate sign-ins because they are separate things — an athlete login lives in
its own table, carries no role, and opens only that athlete's own record (see below).

**Booking needs no account at all.** `/book` walks through sport, ground, date and time, an optional
coach, and a name with one contact. Nothing about an athlete is asked for or stored, so booking can
never introduce a duplicate athlete record.

Coaches are shown as cards rather than a dropdown, because which coach to book comes down to what
they specialise in and how long they have done it — a list of names carries neither.

Two things make the availability honest. Grounds are records now rather than free text, so a slot is
marked unavailable when the club already needs it for a fixture or a training session, not only when
another guest has booked it. And double booking is prevented by the database: three simultaneous
requests for one slot leave exactly one winner, which an application-level check cannot guarantee.

A booking is looked up and cancelled with its reference plus the contact it was made with.

## One athlete, one record

The identity is the athlete's own name and date of birth, which is unique in the database. Email and
phone are checked as well, because a guardian's contact is often shared between siblings: a matching
email alone proves nothing, but the same *name* on the same contact almost always means the record is
being entered twice. Any match is refused with the existing athlete ID, so whoever is entering it can
go and find the record rather than working around the error.

## The athlete portal

An athlete signs in on the **Athlete** tab and lands at `/my` — their own record and nothing else:
career figures by sport, squads, what is coming up, training attendance, honours and their journey.

It is a separate surface from the staff application on purpose. There is no navigation to the roster
or any club screen, because an athlete login cannot reach those routes anyway — the page matches what
the credential can actually do rather than offering links that would fail. A password issued by the
club has to be replaced before anything is shown.

## Athlete logins

Athlete portal credentials are **not** staff accounts. They live in their own table with a unique key
on the athlete, and — deliberately — no role column at all.

That last point is the security property. A staff account carries a role, scopes and permissions, so
raising one to administrator is a matter of changing a field. An athlete login has no such field, so
it cannot be escalated: its capability is fixed by the shape of the table. The tokens carry a
different audience too, so an athlete credential is rejected by every staff route and a staff
credential is rejected by the portal.

Every portal endpoint reads the athlete's id from the token. None of them takes an athlete id as a
parameter, so reading somebody else's record is not a permission that has been withheld — it is a
request that cannot be expressed.

Manage them from **User manager → Athlete logins**, the third tab after Accounts and Roles &
permissions: issue a login, edit the sign-in address, suspend it, reset the password, or remove it.
Removing a login takes away the athlete's way of signing in and leaves their record untouched.

One login per athlete is enforced by the database, an athlete address cannot collide with a staff
one, and issuing a login never creates an athlete record — it always attaches to one that exists.

## The administrator account

`admin@playerarc.local` is the account that guarantees the club can always get
back in, so two things about it are fixed: **its role cannot be changed and it cannot be suspended or
deleted**. Everything else — name, contact details, and above all its password — is editable exactly
like any other account's.

Every other account can be created, edited, suspended and deleted, and only the administrator can do
any of it. The rules are enforced by the API, not merely greyed out in the interface, and the test
suite asserts all four.

## A note on passwords

The user manager lets a super admin create accounts, change roles and scopes, and **issue** a
password — either typing one or generating a strong one that is shown once with a copy button, with
an optional "must change at next sign-in" flag that blocks the app until the person picks their own.

What it deliberately cannot do is **display an existing password**. Passwords are stored as bcrypt
hashes, which are one-way: there is nothing to read back. Keeping them recoverable would mean one
database leak exposes every account at the club, including athletes' and guardians'. Issuing a new
password solves the real problem — someone locked out — without that exposure. The smoke test
asserts that no endpoint returns a hash or a password field.

## Moving to Postgres

The schema is written to port cleanly. Change `INTEGER PRIMARY KEY AUTOINCREMENT` to `SERIAL`,
`TEXT` timestamps to `TIMESTAMPTZ`, and the JSON columns to `JSONB`; then swap the `better-sqlite3`
calls in `server/src/db/index.js` for a `pg` pool. Route code uses positional parameters throughout,
so it needs no changes. The statistics engine operates on parsed JSON in application code and is
storage-agnostic.

---

## Licence

Proprietary — built for Karwan Sports Club.
