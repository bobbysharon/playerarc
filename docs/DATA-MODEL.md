# Data model

33 tables. Every foreign key is declared and enforced (`PRAGMA foreign_keys = ON`), every table
carries timestamps, and no fact about an athlete is duplicated across tables.

## Core relationships

```
                        ┌──────────┐
                        │  roles   │
                        └────┬─────┘
                             │
                        ┌────▼─────┐   user_sport_scopes ──► sports
                        │  users   │   user_team_scopes  ──► teams
                        └────┬─────┘   user_player_links ──► players
                             │ (audit_logs, created_by everywhere)
                             │
  ┌──────────┐          ┌────▼─────┐          ┌─────────────┐
  │  sports  │◄─────────┤ players  ├─────────►│player_sports│
  └────┬─────┘          └────┬─────┘          └─────────────┘
       │                     │
       │                     ├──► player_status_history      (append-only)
       │                     ├──► player_attribute_history   (append-only)
       │                     ├──► player_timeline            (auto + manual)
       │                     ├──► documents                  (restricted)
       │                     ├──► media
       │                     └──► achievements
       │
       ├──► seasons ──► teams ──► team_memberships ──► players
       │                  │
       │                  ├──► team_coaches ──► coaches
       │                  └──► training_sessions ──► training_attendance ──► players
       │
       └──► tournaments ──► tournament_teams
                  │
                  └──► matches ──┬──► match_players        (playing XI / lineup)
                                 ├──► match_performances   (sport-specific stats)
                                 └──► match_events         (ball-by-ball, future)

  assessment_criteria ──► assessment_scores ◄── assessments ──► players
```

## The central four

### `players`
The master identity. `athlete_id` is the permanent public reference (`KSC-PLY-000042`), allocated
from the highest ever issued so a deleted registration never hands its number to someone else.

`uq_players_identity` on `(lower(first_name), lower(last_name), ifnull(dob,''))` blocks duplicate
registration at the database level; the API checks first so it can return the existing athlete ID in
the error rather than a constraint violation.

Contact, address and guardian columns are the restricted set stripped by `redactPlayer()`.
`visibility` controls how far the record travels: `public`, `club`, `staff` or `private`.

### `player_sports`
Resolves one athlete to many sports, with the position, playing role, level and jersey number
specific to each. `UNIQUE (player_id, sport_id)` is what enforces the core rule — participating in a
second sport can only ever add a row here, never a second athlete.

### `sports`
`config_json` holds the sport's entire definition: positions, match statistics, career aggregation
rules, rating model and leaderboards. See ARCHITECTURE.md.

### `match_performances`
One row per athlete per match, with `stats_json` validated against the sport's `matchStats` before
it is written. `UNIQUE (match_id, player_id)` makes saving a scorecard idempotent — the route
upserts, so re-saving a corrected card updates rather than duplicates. Indexed on
`(player_id, sport_id)`, the path every career page takes.

## Historical tables

| Table | Records |
| --- | --- |
| `team_memberships` | Roster with `start_date` / `end_date`. `uq_memb_active` permits many closed memberships per athlete and team but only one open one |
| `player_status_history` | Effective-dated status changes with a reason |
| `player_attribute_history` | Position, level and jersey changes, with old and new values |
| `assessments` + `assessment_scores` | Every review kept; a new review is a new row |
| `player_timeline` | The narrative record; `uq_timeline_system` keeps automatic writes idempotent |
| `audit_logs` | Who changed what, when, from where, with before and after snapshots |

## Integrity rules in the schema

- `CHECK` constraints on every status, category and enumerated field
- `uq_players_identity` — no duplicate athlete registration
- `uq_match_fixture` on `(sport, time, home team, away team, opponent)` — no duplicate fixtures
- `uq_memb_active` — no two open memberships for the same athlete and team
- `UNIQUE (session_id, player_id)` on attendance, `(assessment_id, criteria_id)` on scores
- `ON DELETE CASCADE` where a child cannot exist without its parent (performances without a match);
  `ON DELETE SET NULL` where it can (a match keeps its record when a team is archived)

Rules that need more than a constraint live in `lib/stats-engine.js` (`validateStats`) and in the
routes: shots on target cannot exceed shots, runs cannot exceed six per ball faced, wickets cannot
exceed balls bowled, a jersey number cannot be worn twice in one squad, a team cannot play itself,
and a starting lineup cannot exceed the sport's squad size.

## Column conventions

- Dates are `TEXT` in ISO form (`2026-03-14`, `2026-03-14T16:00:00`) — sortable and comparable in
  SQLite, and portable to `DATE` / `TIMESTAMPTZ` in Postgres
- Booleans are `INTEGER` 0/1
- JSON columns are `TEXT`, read through `parseJson()` which never throws
- `is_demo` marks seeded records so demonstration data can be cleared without touching real records
- `created_by` references the acting user wherever a record is entered by a person
