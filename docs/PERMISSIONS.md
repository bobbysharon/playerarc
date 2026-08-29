# Roles, permissions and privacy

Two questions are answered separately: **what may this role do**, and **which records may this user
touch**. Both are enforced in the API. The web app uses the same matrix to hide controls, but hiding
a button is a courtesy, not a boundary.

## Roles

| Role | Purpose | Data scope |
| --- | --- | --- |
| **Super Admin** | Full system access including users, settings and audit | Club-wide |
| **Sports Director** | Sports, athletes, teams, competitions, performance | Club-wide |
| **Sport Administrator** | Everything within assigned sports | `user_sport_scopes` |
| **Coach** | Training, attendance, assessments, notes for assigned teams | `user_team_scopes`, expanded to athletes on those rosters |
| **Statistician** | Match records and performance statistics | All sports, no athlete administration |
| **Player** | Their own approved record | `user_player_links` (self) |
| **Parent / Guardian** | Their linked child's approved record | `user_player_links` (guardian) |
| **Public** | Athletes marked `visibility = public` only | Unauthenticated |

## Permission keys

Checked by `requirePermission()` on every mutating route.

```
players.read              players.write         players.read_sensitive   players.delete
sports.read               sports.write          seasons.read             seasons.write
teams.read                teams.write           coaches.read             coaches.write
tournaments.read          tournaments.write     matches.read             matches.write
performances.read         performances.write    training.read            training.write
assessments.read          assessments.write     achievements.read        achievements.write
media.read                media.write           media.approve
documents.read            documents.write
reports.read              reports.export        rankings.read            analytics.read
audit.read                self.read             public.read
```

`super_admin` holds `*`. The full assignment per role is in `server/src/lib/permissions.js`, and the
live matrix is visible in the app under Settings → Permissions.

## How scoping works

`middleware/scope.js` resolves the caller into sets of sport, team and athlete IDs:

- `allowedSportIds(user)` — `null` means all sports
- `allowedTeamIds(user)` — `null` means all teams
- `allowedPlayerIds(user)` — `null` means all athletes

A coach's athlete set is every player holding a membership in one of their teams. A sport
administrator's is every player registered for one of their sports.

`scopeClause(column, ids)` folds that set into the SQL `WHERE` clause, so scoping happens in the
query rather than by filtering after the fact. An empty set produces `AND 1 = 0` — an out-of-scope
user gets an empty list, never someone else's data.

Point lookups (`GET /players/:id`) call `canAccessPlayer()` and return **403** with a plain
explanation rather than a silent empty response.

## Restricted fields

`redactPlayer()` strips these unless the viewer holds `players.read_sensitive`, or is the athlete
themselves or their linked guardian:

```
phone · email · address · city · country
emergency_name · emergency_phone · emergency_relation
guardian_name · guardian_phone · guardian_email
blood_group · notes
```

The redacted payload carries `_redacted: true`, which the profile page uses to explain the gap
rather than showing blank fields. A coach gets squad and performance data; a phone number is not
theirs to have.

Unauthenticated callers see nothing unless `players.visibility = 'public'`, and then only name,
athlete ID, photo, nationality and status.

## Files

Media and documents are stored on disk with metadata in the database, and served through
`/api/media/:id/file` and `/api/media/documents/:id/file` rather than statically. Every download
checks the caller's scope for the owning athlete, checks visibility, and writes an audit entry.
Uploads are limited by MIME type (images, video, PDF) and size.

## Auditing

Recorded for every create, update, delete, sign-in, failed sign-in, export and download: actor,
action, record, summary, before and after snapshots, IP and user agent. Readable by Super Admin and
Sports Director under Settings → Audit log.

## Security measures

| Concern | Measure |
| --- | --- |
| Passwords | bcrypt, cost 10; never returned by any endpoint |
| Sessions | JWT, 12-hour default expiry, secret from `JWT_SECRET` |
| Input | `zod` schemas at every route boundary |
| SQL injection | Prepared statements with positional parameters throughout |
| Headers | `helmet` |
| Cross-origin | `cors` restricted to `CORS_ORIGIN` |
| Uploads | Type and size limits, randomised stored filenames, `path.basename()` on every read |
| Errors | Constraint violations translated into plain messages; stack traces never returned |

**Before deploying:** set `JWT_SECRET` to a long random string, change every seeded password, set
`CORS_ORIGIN` to your real domain, run behind TLS, and set `SEED_DEMO=false` for a production
database.
