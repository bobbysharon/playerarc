/**
 * Exports the seeded SQLite database to a JSON dataset that the browser-only
 * demo build loads instead of calling the API.
 *
 * Run after `npm run db:reset`:
 *   node scripts/export-demo-data.mjs
 *
 * The output is committed so the GitHub Pages build needs no database.
 */
import { createRequire } from 'node:module';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const db = new Database(join(root, 'server', 'data', 'playerarc.db'), { readonly: true });

const TABLES = [
  'roles', 'users', 'user_sport_scopes', 'user_team_scopes', 'user_player_links',
  'sports', 'seasons',
  'players', 'player_sports', 'player_status_history', 'player_attribute_history', 'player_timeline',
  'coaches', 'teams', 'team_memberships', 'team_coaches',
  'tournaments', 'tournament_teams', 'matches', 'match_players', 'match_performances',
  'training_sessions', 'training_attendance',
  'assessment_criteria', 'assessments', 'assessment_scores',
  'achievements', 'media', 'documents', 'settings', 'player_staff',
];

const data = {};
for (const table of TABLES) {
  data[table] = db.prepare(`SELECT * FROM ${table}`).all();
}

// Password hashes must never ship to the browser. The demo checks a shared
// plain-text password instead, which is stated openly on its sign-in screen.
data.users = data.users.map(({ password_hash, ...rest }) => rest);

// A short audit trail so the log screen has something to show. Real audit
// entries are written by the server; the demo generates its own as you work.
data.audit_logs = db
  .prepare('SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 40')
  .all()
  .map(({ before_json, after_json, ...rest }) => rest);

const out = join(root, 'web', 'src', 'demo', 'dataset.json');
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(data));

const counts = Object.entries(data)
  .map(([k, v]) => `${k}: ${v.length}`)
  .join(', ');
const kb = Math.round(JSON.stringify(data).length / 1024);
console.log(`[export] wrote web/src/demo/dataset.json (${kb} KB)`);
console.log(`[export] ${counts}`);
