'use strict';
const { db } = require('../db');
const config = require('../config');

/**
 * Allocate the next permanent athlete ID, e.g. KSC-PLY-000042.
 * The number never rewinds: it is derived from the highest ID ever issued,
 * so a deleted registration does not hand its identifier to someone else.
 */
function nextAthleteId() {
  const prefix = config.club.athleteIdPrefix;
  const row = db
    .prepare(`SELECT athlete_id FROM players WHERE athlete_id LIKE ? ORDER BY id DESC LIMIT 1`)
    .get(`${prefix}-%`);
  let next = 1;
  if (row) {
    const n = Number(String(row.athlete_id).split('-').pop());
    if (Number.isFinite(n)) next = n + 1;
  }
  const seq = db.prepare('SELECT COUNT(*) AS c FROM players').get().c + 1;
  next = Math.max(next, seq);
  return `${prefix}-${String(next).padStart(6, '0')}`;
}

module.exports = { nextAthleteId };
