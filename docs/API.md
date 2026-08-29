# API reference

Base URL `/api`. All endpoints except `POST /auth/login` and `GET /api/health` require
`Authorization: Bearer <token>`.

Errors return `{ "error": "A plain-language message.", "details": [...] }` with a meaningful status:
**401** not signed in · **403** out of scope or role · **404** no such record · **409** conflicts
with an existing record · **422** validation failed.

## Authentication
| Method | Path | Notes |
| --- | --- | --- |
| POST | `/auth/login` | `{ email, password }` → `{ token, user }` |
| GET | `/auth/me` | Current user with permissions and scopes |
| GET | `/auth/roles` | Role and permission matrix |
| POST | `/auth/change-password` | `{ currentPassword, newPassword }` |
| POST | `/auth/logout` | Records the sign-out in the audit log |

## Athletes
| Method | Path | Notes |
| --- | --- | --- |
| GET | `/players` | Filters: `q, sport, team, status, position, ageGroup, level, gender, nationality, season, coach, sort, dir, page, pageSize` |
| GET | `/players/filters/options` | Filter values built from live data |
| GET | `/players/:id` | Profile, sports, team history, achievements, status and attribute history, media, documents, summary |
| GET | `/players/:id/stats` | Career record per sport. `?sport=` for one; `?season=`, `?tournament=`, `?team=` to filter |
| GET | `/players/:id/timeline` | Full career timeline |
| POST | `/players/:id/timeline` | Add a manual entry |
| GET | `/players/:id/activity` | Recent matches, training, assessments, awards |
| POST | `/players` | Register. Rejects duplicates with the existing athlete ID |
| PUT | `/players/:id` | Status changes append to history |
| DELETE | `/players/:id` | Refuses if performances exist unless `?force=true` |
| POST | `/players/:id/sports` | Register for an additional sport |
| PUT | `/players/:id/sports/:sportId` | Position, level and jersey changes append to history |

## Sports and seasons
`GET /sports` · `GET /sports/:idOrCode` · `POST /sports` · `PUT /sports/:id` (formulas validated
before saving) · `GET /sports/meta/seasons` · `POST /sports/meta/seasons`

## Teams
`GET /teams` (`sport, season, ageGroup, level, active, q`) · `GET /teams/:id` (team, roster, matches,
training, record) · `POST /teams` · `PUT /teams/:id` · `POST /teams/:id/members` ·
`PUT /teams/:id/members/:membershipId` (setting `end_date` closes the membership; the row is kept)

## Coaches
`GET /coaches` · `GET /coaches/:id` · `POST /coaches` · `PUT /coaches/:id`

## Competition
| Method | Path | Notes |
| --- | --- | --- |
| GET | `/tournaments` | `sport, season, status, q` |
| GET | `/tournaments/:id` | Detail with fixtures, awards and per-sport leaders |
| POST / PUT | `/tournaments`, `/tournaments/:id` | |
| POST | `/tournaments/:id/teams` | Enter a club team or a visiting side |
| GET | `/matches` | `sport, tournament, season, team, status, from, to, limit` |
| GET | `/matches/:id` | Match, sport configuration, lineup, performances |
| POST / PUT / DELETE | `/matches`, `/matches/:id` | Setting `player_of_match_id` creates the award and timeline entry |
| PUT | `/matches/:id/lineup` | Full lineup replace; enforces squad size, one captain, no duplicates |
| PUT | `/matches/:id/performances` | Batch upsert of statistics; returns `{ saved, milestones }` |
| DELETE | `/matches/:id/performances/:playerId` | |

## Training
`GET /training` (`sport, team, coach, type, from, to`) · `GET /training/:id` ·
`POST /training` (attendance pre-filled from the roster) · `PUT /training/:id` ·
`PUT /training/:id/attendance` · `GET /training/player/:playerId/summary`

## Assessments
`GET /assessments/criteria` (`sport, ageGroup`) · `POST /assessments/criteria` ·
`PUT /assessments/criteria/:id` · `GET /assessments` · `GET /assessments/:id` ·
`POST /assessments` (scores validated against each criterion's own scale; overall computed by
weight) · `GET /assessments/player/:playerId/development` (per-criterion progression, category
averages, overall trend)

## Achievements
`GET /achievements` (`player, sport, category, tournament, from`) · `POST /achievements` ·
`DELETE /achievements/:id`

## Media and documents
`GET /media` · `POST /media` (multipart) · `PUT /media/:id/approve` · `GET /media/:id/file` ·
`DELETE /media/:id` · `GET /media/documents/:playerId` · `POST /media/documents` ·
`GET /media/documents/:id/file`

## Analytics, rankings and reports
| Method | Path | Notes |
| --- | --- | --- |
| GET | `/dashboard` | Totals, sport breakdown, status split, recent and upcoming activity, trends |
| GET | `/search?q=` | Athletes, teams, tournaments, matches, coaches |
| GET | `/rankings?sport=` | Required. `season, tournament, team, ageGroup, limit` |
| GET | `/reports/player/:id` | Complete sporting history |
| GET | `/reports/team/:id` | Squad performance, record, attendance |
| GET | `/reports/tournament/:id` | Results, athletes, awards |
| GET | `/reports/sport/:id` | Participation and structure |
| GET | `/reports/coach/:id` | Teams, athletes, sessions, assessments |
| GET | `/export/players.csv` | Roster export |
| GET | `/export/players.xlsx` | Roster plus one sheet of career statistics per sport |
| GET | `/export/player/:id.pdf` | Career report |

`/rankings` returns **422** without a sport — statistics from different sports are not comparable,
so the API declines to produce a meaningless table.

## Administration
`GET /admin/users` · `POST /admin/users` · `PUT /admin/users/:id` · `GET /admin/audit`
(`entity, action, user, from, limit`) · `GET /admin/settings` · `PUT /admin/settings/:key` ·
`POST /admin/demo-data/clear`

## Example

```bash
TOKEN=$(curl -s -X POST localhost:4000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@karwansc.com","password":"Karwan@2026"}' | jq -r .token)

# An athlete's complete career, every sport
curl -s localhost:4000/api/players/1/stats -H "Authorization: Bearer $TOKEN" | jq

# Save a cricket scorecard — career records update on the next read
curl -s -X PUT localhost:4000/api/matches/1/performances \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"performances":[{"player_id":1,"stats":{"batted":1,"runs":72,"balls_faced":48,"fours":9,"sixes":2}}]}'
```
