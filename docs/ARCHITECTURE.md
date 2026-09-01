# Architecture

## The shape of the problem

Karwan Sports Club runs cricket, football, basketball, badminton, table tennis, indoor sports, a gym
and an academy. A fourteen-year-old joins the U16 cricket academy, picks up badminton two years
later, moves to the U18 squad, then the senior XI. Six years on, someone needs to answer: what has
this athlete actually done here?

Three consequences follow, and they drive every structural decision in this codebase.

**One identity, many sports.** The player is the central entity. Registering for a second sport adds
a row to `player_sports`, never a second athlete record. A unique index on
`(first_name, last_name, dob)` plus an explicit check at registration makes accidental duplication
hard: attempting it returns the existing athlete ID and tells the user to add the sport to that
record instead.

**Sports differ, and the differences must not be hard-coded.** A cricket innings and a basketball
box score share almost nothing. Building a table per sport means a schema migration for every new
sport; forcing them into one table means either null-strewn columns or meaningless shared fields.
Instead, everything sport-specific is configuration.

**History is the product.** A system that only knows the current squad answers none of the questions
above. Nothing important is overwritten.

---

## Stack

| Layer | Choice | Why |
| --- | --- | --- |
| API | Node.js 20+, Express 5 | Small surface, no build step, easy for the club to host |
| Database | SQLite via `better-sqlite3` | Zero-configuration deployment; synchronous driver keeps route code linear; the schema ports to Postgres without restructuring |
| Auth | JWT (`jsonwebtoken`) + `bcryptjs` | Stateless, no session store |
| Validation | `zod` at the route boundary | Rejects bad input before it reaches SQL |
| Web | React 18, Vite, React Router, Recharts | Fast builds, no server-side rendering needed |
| Styling | Tailwind with a fixed token set | Consistency without a component library |
| Exports | `exceljs`, `pdfkit` | Excel and PDF generated server-side, permission-checked |

---

## The multi-sport engine

Each row in `sports` carries a `config_json` document describing that sport completely:

```jsonc
{
  "positions":   [{ "key": "GK", "label": "Goalkeeper", "group": "goalkeeper" }],
  "squadSize":   11,
  "statGroups":  [{ "key": "attacking", "label": "Attacking" }],
  "matchStats":  [
    { "key": "goals",  "label": "Goals", "group": "attacking", "type": "int", "min": 0, "max": 15 },
    { "key": "saves",  "label": "Saves", "group": "goalkeeping", "type": "int",
      "positions": ["GK"] }          // only asked of goalkeepers
  ],
  "matchDerived": [
    { "key": "pass_accuracy", "formula": "div(passes_completed, passes) * 100", "format": "pct" }
  ],
  "career": [
    { "key": "goals", "agg": "sum", "field": "goals", "format": "int" },
    { "key": "hat_tricks", "agg": "count_if", "whenFormula": "gte(goals, 3)" },
    { "key": "goals_per_90", "formula": "div(goals, div(minutes, 90))", "format": "2dp" }
  ],
  "ratingModel": {
    "components": [
      { "key": "attacking", "label": "Attacking output", "weight": 0.25,
        "formula": "clamp(scale(goal_contributions, 25), 0, 100)" }
    ]
  },
  "leaderboards": [
    { "key": "top_scorers", "label": "Top scorers", "metric": "goals", "order": "desc" }
  ]
}
```

Three things read this document and nothing else:

- **The scorecard form** (`web/src/pages/MatchDetail.jsx`) renders inputs from `matchStats`,
  grouped by `statGroups`, filtered by the athlete's position.
- **The statistics engine** (`server/src/lib/stats-engine.js`) aggregates performances into a career
  record using `career`, then computes the rating from `ratingModel`.
- **Rankings** (`server/src/routes/analytics.js`) builds leaderboards from `leaderboards`, applying
  each board's qualification threshold.

Adding volleyball meant adding one object to `lib/sport-configs.js`. No route, form, table or query
changed. A director can edit an existing sport's configuration through the API, and formulas are
validated before they are saved.

### Why formulas are text

Storing `"div(runs, dismissals)"` as configuration means the club can change how a rating is
composed without a deployment. Evaluating stored text with `eval()` or `new Function()` would let
that configuration execute arbitrary code, so `lib/formula.js` implements a small recursive-descent
parser over arithmetic, comparisons and a fixed function set (`div`, `clamp`, `scale`, `min`, `max`,
`gte`…). `div` returns 0 rather than infinity, which matters constantly — a bowler with no wickets
should show an average of 0, not `NaN`.

---

## Statistics are derived, never stored

Career totals are recomputed from `match_performances` on every read.

The alternative — maintaining running totals — fails the moment a scorer corrects a match from two
seasons ago. Every total, average, rating and leaderboard position built on that match is then
wrong, and there is no reliable way to know which. Recomputing means a correction anywhere is
correct everywhere on the next page load.

The cost is real but bounded: a career page aggregates that athlete's performances in one sport,
typically tens to low hundreds of rows, behind an index on `(player_id, sport_id)`. When the club
outgrows that, `playerCareer()` in `lib/repo.js` is the single place to add a cache keyed on the
athlete's last performance update.

The same principle governs input. Anything derivable is never typed: strike rate, pass accuracy,
points, economy and rebounds are computed. `validateStats()` also enforces relationships no bounds
check catches — shots on target cannot exceed shots, runs cannot exceed six per ball faced, a
not-out innings cannot also record a dismissal.

---

## A match is a stream of events

The tables above record what a match produced. `match_periods` and `match_events` record how it
happened, and everything else about the match is read off them.

One delivery is one row: the striker, the bowler, the fielder, where the ball pitched, where it went,
the shot played, the speed, whether the batter was in control, and what the outcome was. From that
stream `lib/match-analysis.js` derives the batting and bowling cards, the run rate, partnerships,
fall of wickets, phase splits, the wagon wheel, the pitch map, dot-ball and control percentages, the
head-to-head matchups and the commentary. None of it is stored.

Two things follow from that.

**A scorer never types a scorecard twice.** Each sport declares `derive` rules mapping events to the
match statistics they produce — runs from `runs_batter` on the striker, wickets from a dismissal on
the bowler unless it was a run out, assists from the secondary player on a scored shot. Saving an
event runs those rules and refreshes `match_performances`, which is the same table a typed scorecard
writes to, so career records, ratings and leaderboards need no special handling. Statistics events
cannot produce are left alone, so a hand-entered coach rating survives.

**A correction propagates everywhere.** Fix one delivery and the bowler's economy, the batter's
strike rate, the partnership, the phase totals, the athlete's career average and their leaderboard
position are all right on the next read, because every one of them is computed from that delivery
rather than from a stored total.

Event definitions are configuration, like statistics: `lib/event-configs.js` declares each sport's
event types, their fields and valid outcomes, the quick-entry buttons, the coordinate surface, the
phase boundaries and the derivation rules. The scoring console and the analysis screen render
themselves from it. Adding handball would mean adding one block.

Two details worth knowing. Cricket positions its own deliveries: the API works out the over and ball
from the previous delivery and knows a wide or no ball is re-bowled rather than advancing the over.
And match totals for a ball-based sport are summed from the innings rather than recomputed over
merged events — recomputing would put over 1 in the data twice and report a 24-over innings.

## History is closed, not overwritten

| Change | What happens |
| --- | --- |
| Athlete leaves a team | `team_memberships.end_date` is set; the row stays |
| Athlete is promoted | Old membership closed with status `promoted`, new one opened |
| Status changes | Previous `player_status_history` row closed, new row appended |
| Position, level or jersey changes | Appended to `player_attribute_history` |
| New assessment | A new `assessments` row — earlier reviews are never edited |

A partial unique index (`uq_memb_active`) allows many closed memberships for the same athlete and
team but only one open one, which is what makes "rejoined the senior squad after a season away"
representable without corrupting the roster.

---

## The career timeline assembles itself

`lib/timeline.js` writes to `player_timeline` as a side effect of real events: registration, sport
added, team joined, promotion, match played, assessment recorded, award given. A partial unique
index on `(player_id, event_type, ref_table, ref_id)` for system entries makes those writes
idempotent, so editing a match does not duplicate its timeline entry.

`checkMilestones()` inspects each saved performance for feats worth marking — a debut in a sport, a
fifty, a five-wicket haul, a hat-trick, a thirty-point game — and writes them at higher prominence.
Staff can add manual entries; those are flagged `is_system = 0` and are never touched by the
automatic writes.

---

## Permissions

Two separate questions, answered in two places.

**What may this role do?** `lib/permissions.js` holds a permission matrix. `requirePermission()`
guards every mutating route.

**Which records may this user touch?** `middleware/scope.js` resolves the caller to a set of sports,
teams and athletes. A sport administrator is scoped by `user_sport_scopes`; a coach by
`user_team_scopes`, expanded to every athlete currently on those rosters; a player or guardian by
`user_player_links`. `scopeClause()` folds that set into the SQL `WHERE`, so scoping happens in the
query rather than by filtering results after the fact.

Within a permitted record, `redactPlayer()` strips contact, address and guardian fields unless the
viewer holds `players.read_sensitive` or is the athlete themselves. A coach gets squad and
performance data; a phone number is not theirs to have.

The web app uses the same matrix to hide controls. That is a courtesy — the API is the boundary, and
the smoke test asserts that a coach's write attempt returns 403 even though the button is hidden.

---

## Auditing

`middleware/audit.js` records every create, update, delete, sign-in, failed sign-in, export and file
download with the actor, the record, a summary and — for updates — before and after snapshots. Audit
failures are logged but never break the request that triggered them; losing an audit line is
preferable to losing an athlete's record.

---

## Request flow

```
Browser
  └─ fetch /api/... with Bearer token
       └─ helmet · cors · json body parsing
            └─ authenticate()        loads user, sports, teams, linked athletes
                 └─ requirePermission('...')     may this role act at all?
                      └─ route handler
                           ├─ zod schema         is the input well formed?
                           ├─ scope check        may this user touch this record?
                           ├─ business rules     integrity beyond the schema
                           ├─ transaction        multi-table writes together
                           ├─ timeline.addEvent()
                           └─ audit()
                                └─ JSON response (redacted where required)
```

---

## Scaling

Built for thousands of athletes and tens of thousands of performances.

- Foreign keys and hot query paths are indexed: `(player_id, sport_id)` on performances,
  `(sport_id, scheduled_at)` on matches, `(player_id, event_date)` on the timeline.
- Athlete lists are paginated and sorted in SQL, never in the browser.
- Media and documents are stored on disk with metadata in the database, and streamed through
  permission-checked routes rather than served statically.
- SQLite runs in WAL mode. When concurrent writers become the constraint, the port to Postgres is
  the driver in `db/index.js` and the type changes listed in the README; route code uses positional
  parameters throughout and needs no changes.

## Built to extend

`match_events` exists and is related to matches and players, but is not yet populated. Ball-by-ball
cricket scoring, football event feeds and live scoring can be added by writing to it and reading it
back — the relationships are already correct. Public profiles are covered by `players.visibility`;
the player and guardian portal roles already exist and are scoped.
