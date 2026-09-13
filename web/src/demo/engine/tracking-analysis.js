/* AUTO-GENERATED — do not edit.
 * Converted from server/src/lib/tracking-analysis.js by scripts/build-demo-engine.mjs.
 * Edit the server module and re-run: npm run demo:data
 */
/**
 * Ball-tracking analytics.
 *
 * Deliveries carry raw measurements — release speed, where the ball pitched in
 * centimetres, where it would have met the stumps. Everything a coach actually
 * looks at is worked out from those here: the pitch map, the stump-line
 * breakdown, the speed trend, and the consistency score against a stated target.
 *
 * Two things are deliberate.
 *
 * Nothing derived is stored. Correct one delivery's coordinates and the map,
 * the zone percentages and the consistency score are all right on the next read.
 *
 * The origin is fixed: the batter's stumps are (0, 0), x runs across the pitch
 * with positive to the off side for a right-hander, and y runs back down the
 * pitch towards the bowler. A pitch map and a stump-line reading are then the
 * same measurement read two ways, rather than two numbers that can disagree.
 */

const STUMP_HALF_WIDTH_CM = 11.43;   // a 22.86cm stump line, measured from middle
const STUMP_HEIGHT_CM = 71.1;

/** Length zones, as distance from the batter's stumps in centimetres. */
const LENGTH_ZONES = [
  { key: 'full_toss', label: 'Full toss', from: -9999, to: 0 },
  { key: 'yorker', label: 'Yorker', from: 0, to: 180 },
  { key: 'full', label: 'Full', from: 180, to: 400 },
  { key: 'good', label: 'Good', from: 400, to: 700 },
  { key: 'back_of_length', label: 'Back of a length', from: 700, to: 1000 },
  { key: 'short', label: 'Short', from: 1000, to: 9999 },
];

/**
 * Line zones across the pitch, in centimetres from middle stump.
 * Mirrored for a left-hander so "outside off" means the same thing to both.
 */
const LINE_ZONES = [
  { key: 'wide_down_leg', label: 'Wide down leg', from: -9999, to: -45 },
  { key: 'down_leg', label: 'Down leg', from: -45, to: -20 },
  { key: 'leg_stump', label: 'Leg stump', from: -20, to: -7 },
  { key: 'middle_stump', label: 'Middle stump', from: -7, to: 7 },
  { key: 'off_stump', label: 'Off stump', from: 7, to: 20 },
  { key: 'outside_off', label: 'Outside off', from: 20, to: 45 },
  { key: 'wide_outside_off', label: 'Wide outside off', from: 45, to: 9999 },
];

const round = (n, dp = 1) => (Number.isFinite(n) ? Math.round(n * 10 ** dp) / 10 ** dp : null);
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

function stdev(xs) {
  if (xs.length < 2) return null;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1));
}

/** Which length zone a pitching distance falls in. */
function lengthZoneFor(yCm) {
  if (yCm === null || yCm === undefined) return null;
  return (LENGTH_ZONES.find((z) => yCm > z.from && yCm <= z.to) || {}).key ?? null;
}

/**
 * Which line zone a lateral position falls in.
 * For a left-hander the pitch is mirrored, so the zone names stay meaningful.
 */
function lineZoneFor(xCm, handedness = 'right') {
  if (xCm === null || xCm === undefined) return null;
  const x = handedness === 'left' ? -xCm : xCm;
  return (LINE_ZONES.find((z) => x > z.from && x <= z.to) || {}).key ?? null;
}

/**
 * Would it have hit the stumps, and which one?
 * Height matters as much as line — a ball on middle that is still climbing
 * goes over the top.
 */
function stumpReading(stumpXCm, stumpZCm, handedness = 'right') {
  if (stumpXCm === null || stumpXCm === undefined) return { hits: null, stump: null };
  const x = handedness === 'left' ? -stumpXCm : stumpXCm;

  if (stumpZCm !== null && stumpZCm !== undefined) {
    if (stumpZCm > STUMP_HEIGHT_CM) return { hits: 0, stump: 'over' };
    if (stumpZCm < 0) return { hits: 0, stump: 'under' };
  }
  if (x > STUMP_HALF_WIDTH_CM) return { hits: 0, stump: 'miss_off' };
  if (x < -STUMP_HALF_WIDTH_CM) return { hits: 0, stump: 'miss_leg' };

  if (stumpZCm !== null && stumpZCm !== undefined && stumpZCm > STUMP_HEIGHT_CM - 10) {
    return { hits: 1, stump: 'bails' };
  }
  if (x > 3.8) return { hits: 1, stump: 'off' };
  if (x < -3.8) return { hits: 1, stump: 'leg' };
  return { hits: 1, stump: 'middle' };
}

/**
 * How far a delivery landed from the middle of its target zone, and whether
 * it was inside it. A target with an explicit rectangle is measured against
 * that; otherwise the named line and length zones are used.
 */
function targetReading(delivery, target) {
  if (!target) return { inTarget: null, distanceCm: null };

  const { pitch_x_cm: x, pitch_y_cm: y } = delivery;
  if (x === null || x === undefined || y === null || y === undefined) {
    return { inTarget: null, distanceCm: null };
  }

  const hand = delivery.batter_handedness || 'right';
  const px = hand === 'left' ? -x : x;

  let xMin = target.x_min_cm;
  let xMax = target.x_max_cm;
  let yMin = target.y_min_cm;
  let yMax = target.y_max_cm;

  if (xMin === null || xMin === undefined) {
    const zone = LINE_ZONES.find((z) => z.key === target.line_zone);
    if (zone) { xMin = zone.from; xMax = zone.to; }
  }
  if (yMin === null || yMin === undefined) {
    const zone = LENGTH_ZONES.find((z) => z.key === target.length_zone);
    if (zone) { yMin = zone.from; yMax = zone.to; }
  }
  if ([xMin, xMax, yMin, yMax].some((v) => v === null || v === undefined)) {
    return { inTarget: null, distanceCm: null };
  }

  const inTarget = px >= xMin && px <= xMax && y >= yMin && y <= yMax ? 1 : 0;

  // Distance to the centre of the zone, so "how far off" is comparable
  // between a near miss and a wild one.
  const cx = (Math.max(xMin, -200) + Math.min(xMax, 200)) / 2;
  const cy = (Math.max(yMin, 0) + Math.min(yMax, 2000)) / 2;
  const distance = Math.sqrt((px - cx) ** 2 + (y - cy) ** 2);

  return { inTarget, distanceCm: round(distance, 1) };
}

/* ------------------------------------------------------------------ */
/* Aggregates                                                          */
/* ------------------------------------------------------------------ */

/** Speed, read three ways: effort, what the batter faced, and how it moved. */
function speedSummary(deliveries) {
  const release = deliveries.map((d) => d.release_speed_kph).filter(Number.isFinite);
  const offPitch = deliveries.map((d) => d.speed_off_pitch_kph).filter(Number.isFinite);
  if (!release.length && !offPitch.length) return null;

  const drops = deliveries
    .filter((d) => Number.isFinite(d.release_speed_kph) && Number.isFinite(d.speed_off_pitch_kph) && d.release_speed_kph > 0)
    .map((d) => ((d.release_speed_kph - d.speed_off_pitch_kph) / d.release_speed_kph) * 100);

  return {
    deliveries: deliveries.length,
    averageRelease: round(mean(release)),
    peakRelease: release.length ? round(Math.max(...release)) : null,
    slowestRelease: release.length ? round(Math.min(...release)) : null,
    spread: round(stdev(release)),
    averageOffPitch: round(mean(offPitch)),
    averageSpeedDrop: round(mean(drops)),
    // A tight spread at pace is a different bowler from a wild one with the
    // same average, so consistency of pace is reported alongside it.
    paceConsistency: release.length > 1 && mean(release)
      ? round(Math.max(0, 100 - (stdev(release) / mean(release)) * 100))
      : null,
  };
}

/** Every pitching point, plus the grid a heat map is drawn from. */
function pitchMap(deliveries) {
  const points = deliveries
    .filter((d) => Number.isFinite(d.pitch_x_cm) && Number.isFinite(d.pitch_y_cm))
    .map((d) => ({
      x: round(d.pitch_x_cm), y: round(d.pitch_y_cm),
      lengthZone: d.length_zone || lengthZoneFor(d.pitch_y_cm),
      lineZone: d.line_zone || lineZoneFor(d.pitch_x_cm, d.batter_handedness),
      speed: d.release_speed_kph ?? null,
      bounceHeight: d.bounce_height_cm ?? null,
      runs: d.runs ?? null,
      wicket: !!d.wicket,
      inTarget: d.in_target,
      deliveryType: d.delivery_type ?? null,
      outcome: d.outcome ?? null,
    }));

  // Zone grid: how many balls, how many runs and how many wickets in each
  // line-and-length cell.
  const grid = [];
  for (const length of LENGTH_ZONES) {
    for (const line of LINE_ZONES) {
      const cell = points.filter((p) => p.lengthZone === length.key && p.lineZone === line.key);
      if (!cell.length) continue;
      grid.push({
        lengthZone: length.key,
        lengthLabel: length.label,
        lineZone: line.key,
        lineLabel: line.label,
        balls: cell.length,
        runs: cell.reduce((a, p) => a + (p.runs || 0), 0),
        wickets: cell.filter((p) => p.wicket).length,
        percent: round((cell.length / points.length) * 100),
      });
    }
  }

  return {
    points,
    grid,
    byLength: LENGTH_ZONES.map((z) => ({
      key: z.key, label: z.label,
      balls: points.filter((p) => p.lengthZone === z.key).length,
      percent: points.length ? round((points.filter((p) => p.lengthZone === z.key).length / points.length) * 100) : 0,
      runs: points.filter((p) => p.lengthZone === z.key).reduce((a, p) => a + (p.runs || 0), 0),
      wickets: points.filter((p) => p.lengthZone === z.key && p.wicket).length,
    })).filter((z) => z.balls > 0),
    byLine: LINE_ZONES.map((z) => ({
      key: z.key, label: z.label,
      balls: points.filter((p) => p.lineZone === z.key).length,
      percent: points.length ? round((points.filter((p) => p.lineZone === z.key).length / points.length) * 100) : 0,
      runs: points.filter((p) => p.lineZone === z.key).reduce((a, p) => a + (p.runs || 0), 0),
      wickets: points.filter((p) => p.lineZone === z.key && p.wicket).length,
    })).filter((z) => z.balls > 0),
    averageBounceCm: round(mean(points.map((p) => p.bounceHeight).filter(Number.isFinite))),
  };
}

/** How often the stumps were threatened, and which one was hit. */
function stumpLine(deliveries) {
  const assessed = deliveries.filter((d) => d.hits_stumps !== null && d.hits_stumps !== undefined);
  if (!assessed.length) return null;

  const hits = assessed.filter((d) => d.hits_stumps);
  const tally = {};
  for (const d of assessed) {
    const key = d.stump_hit || (d.hits_stumps ? 'middle' : 'miss_off');
    tally[key] = (tally[key] || 0) + 1;
  }

  return {
    assessed: assessed.length,
    hitting: hits.length,
    hittingPercent: round((hits.length / assessed.length) * 100),
    breakdown: [
      ['off', 'Off stump'], ['middle', 'Middle stump'], ['leg', 'Leg stump'], ['bails', 'Clipping the bails'],
      ['miss_off', 'Missing off'], ['miss_leg', 'Missing leg'], ['over', 'Over the stumps'], ['under', 'Keeping low'],
    ].map(([key, label]) => ({
      key, label, count: tally[key] || 0,
      percent: round(((tally[key] || 0) / assessed.length) * 100),
      wouldHit: ['off', 'middle', 'leg', 'bails'].includes(key),
    })).filter((row) => row.count > 0),
    // Average lateral miss, which says whether a bowler strays one side or
    // sprays both.
    averageStumpOffsetCm: round(mean(assessed.map((d) => d.stump_x_cm).filter(Number.isFinite))),
  };
}

/**
 * Consistency: how reliably a bowler hits the zone they were aiming at.
 *
 * Reported as a hit rate and a tightness score. The hit rate says how often
 * they landed it; tightness says how far out they were when they missed,
 * which distinguishes a bowler who is nearly there from one who is not.
 */
function consistency(deliveries) {
  const aimed = deliveries.filter((d) => d.in_target !== null && d.in_target !== undefined);
  if (!aimed.length) return null;

  const hits = aimed.filter((d) => d.in_target).length;
  const distances = aimed.map((d) => d.distance_from_target_cm).filter(Number.isFinite);
  const averageMiss = mean(distances);

  // Tightness falls away over roughly a metre: dead on is 100, a metre out
  // is nothing. It is a scale for coaching, not a physical constant.
  const tightness = averageMiss === null ? null : round(Math.max(0, 100 - (averageMiss / 100) * 100));

  // The longest run of deliveries landed in the zone — what a coach means by
  // "he found his rhythm".
  let best = 0;
  let run = 0;
  for (const d of aimed) {
    if (d.in_target) { run += 1; best = Math.max(best, run); } else run = 0;
  }

  return {
    aimed: aimed.length,
    inZone: hits,
    hitRate: round((hits / aimed.length) * 100),
    averageMissCm: round(averageMiss),
    tightness,
    bestRun: best,
    // One score a coach can track week to week, weighted towards actually
    // landing it rather than being narrowly wrong.
    score: tightness === null ? null : round((hits / aimed.length) * 100 * 0.7 + tightness * 0.3),
  };
}

/** Session-by-session trend, which is where progress actually shows. */
function trend(sessions) {
  return sessions
    .map((s) => ({
      sessionId: s.id,
      date: s.session_date,
      title: s.title,
      mode: s.mode,
      deliveries: s.deliveries.length,
      averageRelease: round(mean(s.deliveries.map((d) => d.release_speed_kph).filter(Number.isFinite))),
      peakRelease: (() => {
        const xs = s.deliveries.map((d) => d.release_speed_kph).filter(Number.isFinite);
        return xs.length ? round(Math.max(...xs)) : null;
      })(),
      consistencyScore: consistency(s.deliveries)?.score ?? null,
      hitRate: consistency(s.deliveries)?.hitRate ?? null,
      stumpsHitPercent: stumpLine(s.deliveries)?.hittingPercent ?? null,
      goodLengthPercent: (() => {
        const withLength = s.deliveries.filter((d) => d.length_zone || Number.isFinite(d.pitch_y_cm));
        if (!withLength.length) return null;
        const good = withLength.filter((d) => (d.length_zone || lengthZoneFor(d.pitch_y_cm)) === 'good');
        return round((good.length / withLength.length) * 100);
      })(),
    }))
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
}

/** Everything about one bowler's tracked work, in one shape. */
function bowlerReport(deliveries, sessions) {
  return {
    deliveries: deliveries.length,
    speed: speedSummary(deliveries),
    pitchMap: pitchMap(deliveries),
    stumpLine: stumpLine(deliveries),
    consistency: consistency(deliveries),
    trend: trend(sessions),
    byDeliveryType: [...new Set(deliveries.map((d) => d.delivery_type).filter(Boolean))].map((type) => {
      const subset = deliveries.filter((d) => d.delivery_type === type);
      return {
        type,
        balls: subset.length,
        averageSpeed: round(mean(subset.map((d) => d.release_speed_kph).filter(Number.isFinite))),
        inZonePercent: consistency(subset)?.hitRate ?? null,
        wickets: subset.filter((d) => d.wicket).length,
        runs: subset.reduce((a, d) => a + (d.runs || 0), 0),
      };
    }).sort((a, b) => b.balls - a.balls),
    machineVsLive: {
      machine: deliveries.filter((d) => d.machine_delivery).length,
      live: deliveries.filter((d) => !d.machine_delivery).length,
    },
  };
}

/** What a batter faced: the same measurements, read from the other end. */
function batterReport(deliveries) {
  const faced = deliveries.length;
  if (!faced) return null;
  const speeds = deliveries.map((d) => d.speed_off_pitch_kph ?? d.release_speed_kph).filter(Number.isFinite);

  return {
    faced,
    runs: deliveries.reduce((a, d) => a + (d.runs || 0), 0),
    dismissals: deliveries.filter((d) => d.wicket).length,
    averageSpeedFaced: round(mean(speeds)),
    fastestFaced: speeds.length ? round(Math.max(...speeds)) : null,
    pitchMap: pitchMap(deliveries),
    // Where the runs came from, and where the trouble was.
    byLength: pitchMap(deliveries).byLength.map((z) => ({
      ...z,
      runsPerBall: z.balls ? round(z.runs / z.balls, 2) : 0,
    })),
    againstMachine: deliveries.filter((d) => d.machine_delivery).length,
  };
}

export {
  LENGTH_ZONES,
  LINE_ZONES,
  lengthZoneFor,
  lineZoneFor,
  stumpReading,
  targetReading,
  speedSummary,
  pitchMap,
  stumpLine,
  consistency,
  trend,
  bowlerReport,
  batterReport,
};