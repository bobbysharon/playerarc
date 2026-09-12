'use strict';
/**
 * Applies schema.sql. Use `node src/db/migrate.js --fresh` to drop and rebuild.
 * Idempotent: every statement is CREATE ... IF NOT EXISTS.
 */
const fs = require('fs');
const path = require('path');
const config = require('../config');

const fresh = process.argv.includes('--fresh');
if (fresh && fs.existsSync(config.databaseFile)) {
  for (const suffix of ['', '-wal', '-shm']) {
    const f = config.databaseFile + suffix;
    if (fs.existsSync(f)) fs.unlinkSync(f);
  }
  console.log('[migrate] dropped existing database');
}

const { db } = require('./index');
const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
db.exec(sql);

/**
 * schema.sql is CREATE-TABLE-IF-NOT-EXISTS, so it never touches a table
 * that's already there. New columns added to an existing table (e.g. the
 * cricket showcase-profile fields on `players`, or `training_sessions.group_id`)
 * need an explicit, idempotent ALTER TABLE so upgrading a live database
 * doesn't require `--fresh` (and the data loss that comes with it).
 */
function ensureColumn(table, column, definitionSql) {
  const existing = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  if (!existing.includes(column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${definitionSql}`);
    console.log(`[migrate] added ${table}.${column}`);
  }
}

ensureColumn('players', 'showcase_enabled', 'showcase_enabled INTEGER NOT NULL DEFAULT 0');
ensureColumn('players', 'showcase_token', 'showcase_token TEXT');
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_players_showcase_token ON players(showcase_token) WHERE showcase_token IS NOT NULL');
ensureColumn('training_sessions', 'group_id', 'group_id INTEGER REFERENCES player_groups(id) ON DELETE SET NULL');
db.exec('CREATE INDEX IF NOT EXISTS idx_train_group_date ON training_sessions(group_id, session_date)');

const tables = db
  .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
  .all()
  .map((r) => r.name);

console.log(`[migrate] schema applied — ${tables.length} tables`);
console.log('[migrate] ' + tables.join(', '));
