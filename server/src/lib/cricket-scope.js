'use strict';
/**
 * These features (benchmarks, drills, digital groups, messaging) were added
 * for cricket only, not as a platform-wide capability. The schema stays
 * sport-scoped like everything else so widening it later is a config change,
 * not a rebuild — but for now every route funnels through here to reject
 * any other sport with a clear message.
 */
const { getSport } = require('./repo');
const { ApiError } = require('../middleware/error');

function requireCricketSport(sportIdOrCode) {
  const sport = getSport(sportIdOrCode);
  if (!sport) throw new ApiError(404, 'That sport does not exist.');
  if (sport.code !== 'cricket') {
    throw new ApiError(403, `This feature is available for Cricket only (not ${sport.name}).`);
  }
  return sport;
}

module.exports = { requireCricketSport };
