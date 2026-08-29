'use strict';
const app = require('./app');
const config = require('./config');
const { db } = require('./db');

const tables = db.prepare("SELECT COUNT(*) AS c FROM sqlite_master WHERE type='table'").get().c;
if (tables < 5) {
  console.error('\n  The database has not been created yet. Run:  npm run db:reset\n');
  process.exit(1);
}

const server = app.listen(config.port, () => {
  console.log(`\n  ${config.club.platform} — ${config.club.name}`);
  console.log(`  API      http://localhost:${config.port}/api`);
  console.log(`  Health   http://localhost:${config.port}/api/health`);
  console.log(`  Mode     ${config.env}\n`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    server.close(() => {
      db.close();
      process.exit(0);
    });
  });
}
