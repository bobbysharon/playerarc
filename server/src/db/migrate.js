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

const tables = db
  .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
  .all()
  .map((r) => r.name);

console.log(`[migrate] schema applied — ${tables.length} tables`);
console.log('[migrate] ' + tables.join(', '));
