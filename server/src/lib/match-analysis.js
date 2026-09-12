'use strict';
/**
 * Match analysis.
 *
 * Everything here is computed from match_events. Nothing is stored, for the
 * same reason career records are not: correct one delivery and every number
 * built on it — the scorecard, the run rate, the partnership, the spell, the
 * momentum chart, the athlete's career average — is right on the next read.
 *
 * Two exports matter:
 *
 *   derivePerformances()  events → per-player match statistics. This is what
 *                         lets a scorer record deliveries and never type a
 *                         scorecard, and it feeds career records unchanged.
 *
 *   analyseMatch()        events → the full analysis: progression, phases,
 *                         partnerships, spells, matchups, maps, momentum and
 *                         a commentary feed.
 */

const { num } = require('./stats-engine');

/* ------------------------------------------------------------------ */
/* Rule evaluation                                                     */
/* ------------------------------------------------------------------ */

function truthy(v) {
  return v === true || v === 1 || v === '1' || v === 'true';
}

/** Does an event satisfy a { field, eq | gte | in | truthy | falsy } test? */
function matches(payload, test) {
  if (!test) return true;
  const value = payload[test.field];
  if (test.truthy !== undefined) return truthy(value) === truthy(test.truthy);
  if (test.falsy !== undefined) return !truthy(value);
  if (test.eq !== undefined) return String(value) === String(test.eq);
  if (test.gte !== undefined) return num(value) >= test.gte;
  if (test.in !== undefined) return test.in.includes(String(value));
  return true;
}

/** A wide or no ball disqualifies some rules; `unless` names those flags. */
function excluded(payload, unless) {
  if (!unless || !unless.length) return false;
  const extra = String(payload.extra_type || '').toLowerCase();
  return unless.some((flag) => extra === String(flag).toLowerCase() || truthy(payload[flag]));
}

const roleColumn = {
  primary: 'primary_player_id',
  secondary: 'secondary_player_id',
  tertiary: 'tertiary_player_id',
};

/**
 * Turn events into per-player match statistics.
 * @returns {Map<number, object>} player id → stats object
 */
function derivePerformances(sportConfig, events) {
  const rules = (sportConfig.events && sportConfig.events.derive) || [];
  const byPlayer = new Map();
  const bump = (playerId, stat, amount, max) => {
    if (!playerId || !amount) return;
    if (!byPlayer.has(playerId)) byPlayer.set(playerId, {});
    const stats = byPlayer.get(playerId);
    const next = (stats[stat] || 0) + amount;
    stats[stat] = max !== undefined ? Math.min(next, max) : next;
  };

  for (const event of events) {
    if (event.is_void) continue;
    const payload = event.payload || {};
    for (const rule of rules) {
      if (rule.event !== event.event_type) continue;
      const playerId = event[roleColumn[rule.role || 'primary']];
      if (!playerId) continue;

      if (rule.when && !matches(payload, rule.when)) continue;
      if (rule.andWhen && !matches(payload, rule.andWhen)) continue;
      if (rule.whenNot && matches(payload, rule.whenNot)) continue;
      if (excluded(payload, rule.unless)) continue;
      if (rule.unlessDismissal && rule.unlessDismissal.includes(String(payload.dismissal || ''))) continue;
      if (rule.onlyExtras) {
        const extra = String(payload.extra_type || '').toLowerCase();
        if (!rule.onlyExtras.map((e) => e.toLowerCase()).includes(extra)) continue;
      }

      let amount = 0;
      if (rule.sum) amount = num(payload[rule.sum]);
      else if (rule.count) amount = 1;
      else if (rule.value !== undefined) amount = rule.value;
      bump(playerId, rule.stat, amount, rule.max);
    }

    // A not-out batter is one who faced deliveries and was never dismissed;
    // that is settled after the whole innings, below.
  }

  // Cricket: mark the batters who were never dismissed.
  if (sportConfig.events && sportConfig.events.ballBased) {
    const dismissed = new Set();
    for (const e of events) {
      if (e.is_void || e.event_type !== 'ball') continue;
      if (truthy((e.payload || {}).wicket)) {
        const out = (e.payload || {}).dismissed_player_id || e.primary_player_id;
        if (out) dismissed.add(Number(out));
      }
    }
    for (const [playerId, stats] of byPlayer) {
      if (stats.balls_faced > 0 || stats.runs > 0) {
        stats.not_out = dismissed.has(Number(playerId)) ? 0 : 1;
      }
    }
  }

  return byPlayer;
}

/* ------------------------------------------------------------------ */
/* Shared helpers                                                      */
/* ------------------------------------------------------------------ */

const nameOf = (players, id, fallback = null) => {
  const p = players.get(Number(id));
  if (p) return p.display_name || `${p.first_name} ${p.last_name}`;
  return fallback;
};

const oversFromBalls = (balls) => `${Math.floor(balls / 6)}.${balls % 6}`;
const round = (n, dp = 2) => (Number.isFinite(n) ? Math.round(n * 10 ** dp) / 10 ** dp : 0);

/* ------------------------------------------------------------------ */
/* Cricket analysis                                                    */
/* ------------------------------------------------------------------ */

function analyseCricket(events, players, period) {
  const balls = events.filter((e) => e.event_type === 'ball' && !e.is_void);

  let runs = 0;
  let wickets = 0;
  let legalBalls = 0;
  const overs = new Map();          // over number → { runs, wickets, balls }
  const worm = [];                  // cumulative runs after each over
  const fallOfWickets = [];
  const partnerships = [];
  const extras = { wide: 0, 'no ball': 0, bye: 0, 'leg bye': 0, penalty: 0 };
  const wagonWheel = [];
  const pitchMap = [];
  const matchups = new Map();       // "batter|bowler" → { balls, runs, dismissals }
  const bowlers = new Map();
  const batters = new Map();
  let control = { in: 0, out: 0 };

  let partnership = { runs: 0, balls: 0, batters: new Set(), startOver: 0 };

  for (const e of balls) {
    const p = e.payload || {};
    const extraType = String(p.extra_type || '').toLowerCase();
    const isWide = extraType === 'wide';
    const isNoBall = extraType === 'no ball';
    const legal = !isWide && !isNoBall;
    const ballRuns = num(p.runs_batter) + num(p.extras);
    const overNo = Math.floor(num(e.over_number) || 0);

    runs += ballRuns;
    if (legal) legalBalls += 1;
    if (extraType && extras[extraType] !== undefined) extras[extraType] += num(p.extras);

    // Over-by-over
    if (!overs.has(overNo)) overs.set(overNo, { over: overNo + 1, runs: 0, wickets: 0, balls: 0, bowler: nameOf(players, e.secondary_player_id) });
    const over = overs.get(overNo);
    over.runs += ballRuns;
    if (legal) over.balls += 1;

    // Control
    if (p.control !== undefined && p.control !== null && p.control !== '') {
      if (truthy(p.control)) control.in += 1; else control.out += 1;
    }

    // Batter card. When the batter is an opposition player there is no athlete
    // record, so the card is keyed on the name the scorer typed instead.
    const batterId = e.primary_player_id || (e.opponent_name ? `opp:${e.opponent_name}` : null);
    if (batterId) {
      if (!batters.has(batterId)) {
        batters.set(batterId, {
          playerId: typeof batterId === 'number' ? batterId : null,
          opposition: typeof batterId !== 'number',
          name: nameOf(players, e.primary_player_id, e.opponent_name), runs: 0, balls: 0,
          fours: 0, sixes: 0, dots: 0, out: false, dismissal: null, controlled: 0, played: 0,
        });
      }
      const b = batters.get(batterId);
      b.runs += num(p.runs_batter);
      if (!isWide) b.balls += 1;
      if (num(p.runs_batter) === 4) b.fours += 1;
      if (num(p.runs_batter) === 6) b.sixes += 1;
      if (ballRuns === 0 && legal) b.dots += 1;
      if (p.control !== undefined && p.control !== '') {
        b.played += 1;
        if (truthy(p.control)) b.controlled += 1;
      }
    }

    // Bowler card, same treatment.
    const bowlerId = e.secondary_player_id || (!e.primary_player_id ? null : (e.opponent_name ? `opp:${e.opponent_name}` : null));
    if (bowlerId) {
      if (!bowlers.has(bowlerId)) {
        bowlers.set(bowlerId, {
          playerId: typeof bowlerId === 'number' ? bowlerId : null,
          opposition: typeof bowlerId !== 'number',
          name: nameOf(players, e.secondary_player_id, e.opponent_name), balls: 0, runs: 0,
          wickets: 0, dots: 0, fours: 0, sixes: 0, wides: 0, noBalls: 0, maidens: 0, overs: new Set(),
          deviationSum: 0, deviationCount: 0,
        });
      }
      const bw = bowlers.get(bowlerId);
      if (legal) bw.balls += 1;
      if (p.deviation_deg !== undefined && p.deviation_deg !== null && p.deviation_deg !== '') {
        bw.deviationSum += num(p.deviation_deg);
        bw.deviationCount += 1;
      }
      bw.runs += num(p.runs_batter) + (isWide || isNoBall ? num(p.extras) : 0);
      if (ballRuns === 0 && legal) bw.dots += 1;
      if (num(p.runs_batter) === 4) bw.fours += 1;
      if (num(p.runs_batter) === 6) bw.sixes += 1;
      if (isWide) bw.wides += 1;
      if (isNoBall) bw.noBalls += 1;
      bw.overs.add(overNo);
    }

    // Matchup
    // Only a genuine head-to-head — both sides on the club's books — is worth
    // recording as a matchup; against outside opposition there is no second
    // athlete record to compare against.
    if (e.primary_player_id && e.secondary_player_id) {
      const key = `${batterId}|${bowlerId}`;
      if (!matchups.has(key)) {
        matchups.set(key, {
          batterId: e.primary_player_id, bowlerId: e.secondary_player_id,
          batter: nameOf(players, e.primary_player_id), bowler: nameOf(players, e.secondary_player_id),
          balls: 0, runs: 0, dismissals: 0, dots: 0,
        });
      }
      const mu = matchups.get(key);
      if (legal) mu.balls += 1;
      mu.runs += num(p.runs_batter);
      if (ballRuns === 0 && legal) mu.dots += 1;
    }

    // Maps
    if (e.x !== null && e.x !== undefined) {
      wagonWheel.push({
        x: e.x, y: e.y, runs: num(p.runs_batter), shot: p.shot || null,
        batter: nameOf(players, batterId), over: round(overNo + (num(e.ball_in_over) || 0) / 10, 1),
      });
    }
    if (p.length || p.line) {
      pitchMap.push({
        length: p.length || null, line: p.line || null, runs: ballRuns,
        wicket: truthy(p.wicket), bowler: nameOf(players, e.secondary_player_id, e.opponent_name), speed: num(p.speed_kph) || null,
        deviation: num(p.deviation_deg) || null, deliveryType: p.delivery_type || null, beaten: truthy(p.beaten), edge: truthy(p.edge),
      });
    }

    // Partnership
    partnership.runs += ballRuns;
    if (legal) partnership.balls += 1;
    if (batterId) partnership.batters.add(batterId);

    // Wicket
    if (truthy(p.wicket)) {
      wickets += 1;
      over.wickets += 1;
      const dismissedId = p.dismissed_player_id || batterId;
      const dismissedName = nameOf(players, p.dismissed_player_id || e.primary_player_id, e.opponent_name);
      const dismissalKind = String(p.dismissal || '');
      if (bowlerId && bowlers.has(bowlerId) && !['run out', 'retired'].includes(dismissalKind)) {
        bowlers.get(bowlerId).wickets += 1;
      }
      if (dismissedId && batters.has(dismissedId)) {
        const b = batters.get(dismissedId);
        b.out = true;
        b.dismissal = dismissalKind || 'out';
      }
      const muKey = `${batterId}|${bowlerId}`;
      if (matchups.has(muKey)) matchups.get(muKey).dismissals += 1;

      fallOfWickets.push({
        wicket: wickets,
        runs,
        over: oversFromBalls(legalBalls),
        player: dismissedName,
        dismissal: dismissalKind,
        bowler: nameOf(players, e.secondary_player_id, e.opponent_name),
      });
      partnerships.push({
        wicket: wickets,
        runs: partnership.runs,
        balls: partnership.balls,
        batters: [...partnership.batters].map((id) => (typeof id === 'number' ? nameOf(players, id) : String(id).replace('opp:', ''))).filter(Boolean),
        runRate: partnership.balls ? round((partnership.runs / partnership.balls) * 6) : 0,
      });
      partnership = { runs: 0, balls: 0, batters: new Set([batterId]), startOver: overNo };
    }
  }

  // Close the unbroken partnership
  if (partnership.balls > 0) {
    partnerships.push({
      wicket: wickets + 1,
      unbroken: true,
      runs: partnership.runs,
      balls: partnership.balls,
      batters: [...partnership.batters].map((id) => (typeof id === 'number' ? nameOf(players, id) : String(id).replace('opp:', ''))).filter(Boolean),
      runRate: partnership.balls ? round((partnership.runs / partnership.balls) * 6) : 0,
    });
  }

  // Maiden overs
  for (const bw of bowlers.values()) {
    for (const overNo of bw.overs) {
      const overBalls = balls.filter((e) => Math.floor(num(e.over_number)) === overNo
        && (bw.playerId ? e.secondary_player_id === bw.playerId : e.opponent_name && !e.secondary_player_id));
      const conceded = overBalls.reduce((a, e) => a + num((e.payload || {}).runs_batter) + num((e.payload || {}).extras), 0);
      const legalCount = overBalls.filter((e) => !['wide', 'no ball'].includes(String((e.payload || {}).extra_type || '').toLowerCase())).length;
      if (conceded === 0 && legalCount >= 6) bw.maidens += 1;
    }
  }

  const overList = [...overs.values()].sort((a, b) => a.over - b.over);
  let cumulative = 0;
  let cumulativeWickets = 0;
  for (const o of overList) {
    cumulative += o.runs;
    cumulativeWickets += o.wickets;
    worm.push({ over: o.over, runs: cumulative, wickets: cumulativeWickets, runRate: round(cumulative / o.over) });
  }

  const phaseDefs = [
    { key: 'powerplay', label: 'Powerplay (1–6)', from: 0, to: 6 },
    { key: 'middle', label: 'Middle (7–16)', from: 6, to: 16 },
    { key: 'death', label: 'Death (17+)', from: 16, to: 999 },
  ];
  const phases = phaseDefs.map((ph) => {
    const inPhase = overList.filter((o) => o.over > ph.from && o.over <= ph.to);
    const phaseRuns = inPhase.reduce((a, o) => a + o.runs, 0);
    const phaseBalls = inPhase.reduce((a, o) => a + o.balls, 0);
    return {
      ...ph,
      overs: inPhase.length,
      runs: phaseRuns,
      wickets: inPhase.reduce((a, o) => a + o.wickets, 0),
      runRate: phaseBalls ? round((phaseRuns / phaseBalls) * 6) : 0,
    };
  }).filter((ph) => ph.overs > 0);

  const boundaries = balls.filter((e) => [4, 6].includes(num((e.payload || {}).runs_batter))).length;
  const dots = balls.filter((e) => {
    const p = e.payload || {};
    const extra = String(p.extra_type || '').toLowerCase();
    return num(p.runs_batter) + num(p.extras) === 0 && !['wide', 'no ball'].includes(extra);
  }).length;

  return {
    kind: 'cricket',
    summary: {
      runs,
      wickets,
      overs: oversFromBalls(legalBalls),
      balls: legalBalls,
      runRate: legalBalls ? round((runs / legalBalls) * 6) : 0,
      extras: Object.entries(extras).filter(([, v]) => v > 0).map(([k, v]) => ({ type: k, runs: v })),
      extrasTotal: Object.values(extras).reduce((a, b) => a + b, 0),
      boundaries,
      dotBalls: dots,
      dotBallPercent: legalBalls ? round((dots / legalBalls) * 100, 1) : 0,
      boundaryPercent: legalBalls ? round((boundaries / legalBalls) * 100, 1) : 0,
      controlPercent: control.in + control.out ? round((control.in / (control.in + control.out)) * 100, 1) : null,
      target: period?.target ?? null,
      requiredRate: period?.target && period.planned_length
        ? round(((period.target - runs) / Math.max(period.planned_length * 6 - legalBalls, 1)) * 6)
        : null,
    },
    battingCard: [...batters.values()].map((b) => ({
      ...b,
      strikeRate: b.balls ? round((b.runs / b.balls) * 100) : 0,
      controlPercent: b.played ? round((b.controlled / b.played) * 100, 1) : null,
      dotPercent: b.balls ? round((b.dots / b.balls) * 100, 1) : 0,
    })).sort((a, b) => b.runs - a.runs),
    bowlingCard: [...bowlers.values()].map((b) => ({
      playerId: b.playerId,
      name: b.name,
      overs: oversFromBalls(b.balls),
      balls: b.balls,
      maidens: b.maidens,
      runs: b.runs,
      wickets: b.wickets,
      dots: b.dots,
      fours: b.fours,
      sixes: b.sixes,
      wides: b.wides,
      noBalls: b.noBalls,
      economy: b.balls ? round((b.runs / b.balls) * 6) : 0,
      strikeRate: b.wickets ? round(b.balls / b.wickets, 1) : null,
      dotPercent: b.balls ? round((b.dots / b.balls) * 100, 1) : 0,
      avgDeviation: b.deviationCount ? round(b.deviationSum / b.deviationCount, 1) : null,
    })).sort((a, b) => b.wickets - a.wickets || a.economy - b.economy),
    overByOver: overList,
    worm,
    fallOfWickets,
    partnerships,
    phases,
    wagonWheel,
    pitchMap,
    matchups: [...matchups.values()]
      .filter((m) => m.balls > 0)
      .map((m) => ({ ...m, strikeRate: m.balls ? round((m.runs / m.balls) * 100) : 0 }))
      .sort((a, b) => b.balls - a.balls),
  };
}

/* ------------------------------------------------------------------ */
/* Clock sports — football, futsal, basketball                          */
/* ------------------------------------------------------------------ */

function analyseClockSport(events, players, config, sportCode) {
  const live = events.filter((e) => !e.is_void);
  const isBasketball = sportCode === 'basketball';

  const shots = live.filter((e) => e.event_type === 'shot');
  const scoring = shots.filter((e) => truthy((e.payload || {}).goal) || truthy((e.payload || {}).made));

  const shotMap = shots.map((e) => {
    const p = e.payload || {};
    const points = isBasketball ? num(p.points) || 2 : 1;
    return {
      x: e.x, y: e.y,
      scored: truthy(p.goal) || truthy(p.made),
      onTarget: truthy(p.on_target) || truthy(p.made),
      points: (truthy(p.goal) || truthy(p.made)) ? points : 0,
      player: nameOf(players, e.primary_player_id),
      minute: num(e.minute) || null,
      type: p.shot_type || p.body_part || p.situation || null,
    };
  }).filter((s) => s.x !== null && s.x !== undefined);

  // Minute-by-minute scoring, cumulative
  const timeline = live
    .filter((e) => ['shot', 'card', 'substitution', 'foul', 'save', 'turnover', 'rebound', 'note'].includes(e.event_type))
    .map((e) => ({
      id: e.id,
      minute: num(e.minute) || null,
      clock: e.clock || null,
      type: e.event_type,
      outcome: e.outcome,
      player: nameOf(players, e.primary_player_id),
      secondary: nameOf(players, e.secondary_player_id),
      commentary: e.commentary,
      payload: e.payload,
    }))
    .sort((a, b) => (a.minute ?? 0) - (b.minute ?? 0));

  let running = 0;
  const momentum = scoring
    .slice()
    .sort((a, b) => (num(a.minute) || 0) - (num(b.minute) || 0))
    .map((e) => {
      running += isBasketball ? (num((e.payload || {}).points) || 2) : 1;
      return { minute: num(e.minute) || 0, score: running, player: nameOf(players, e.primary_player_id) };
    });

  const phaseDefs = (config.events && config.events.phases) || [];
  const phases = phaseDefs.map((ph) => {
    const inPhase = live.filter((e) => {
      const m = num(e.minute);
      return m > ph.from && m <= ph.to;
    });
    const phaseGoals = inPhase.filter((e) => e.event_type === 'shot' && (truthy((e.payload || {}).goal) || truthy((e.payload || {}).made)));
    return {
      ...ph,
      events: inPhase.length,
      shots: inPhase.filter((e) => e.event_type === 'shot').length,
      scores: phaseGoals.length,
      points: phaseGoals.reduce((a, e) => a + (isBasketball ? (num((e.payload || {}).points) || 2) : 1), 0),
    };
  }).filter((ph) => ph.events > 0);

  // Per-player contribution from the event stream
  const contributions = new Map();
  const bump = (id, key, amount = 1) => {
    if (!id) return;
    if (!contributions.has(id)) contributions.set(id, { playerId: id, name: nameOf(players, id) });
    const c = contributions.get(id);
    c[key] = (c[key] || 0) + amount;
  };
  for (const e of live) {
    const p = e.payload || {};
    if (e.event_type === 'shot') {
      bump(e.primary_player_id, 'shots');
      if (truthy(p.goal) || truthy(p.made)) {
        bump(e.primary_player_id, isBasketball ? 'points' : 'goals', isBasketball ? (num(p.points) || 2) : 1);
        bump(e.secondary_player_id, 'assists');
      }
      if (truthy(p.blocked)) bump(e.tertiary_player_id, 'blocks');
    }
    if (e.event_type === 'defensive') bump(e.primary_player_id, String(p.action || 'actions').replace(/\s/g, '_'));
    if (e.event_type === 'save') bump(e.primary_player_id, 'saves');
    if (e.event_type === 'rebound') bump(e.primary_player_id, `${p.kind || 'total'}_rebounds`);
    if (e.event_type === 'turnover') { bump(e.primary_player_id, 'turnovers'); bump(e.secondary_player_id, 'steals'); }
    if (e.event_type === 'foul') bump(e.primary_player_id, 'fouls');
    if (e.event_type === 'card') bump(e.primary_player_id, `${p.card || 'card'}_cards`.replace(/\s/g, '_'));
    if (e.event_type === 'pass') { bump(e.primary_player_id, 'key_passes'); bump(e.secondary_player_id, 'received'); }
  }

  // Who kept meeting whom
  const matchups = new Map();
  for (const e of live) {
    if (!e.primary_player_id || !e.tertiary_player_id) continue;
    const key = `${e.primary_player_id}|${e.tertiary_player_id}`;
    if (!matchups.has(key)) {
      matchups.set(key, {
        attacker: nameOf(players, e.primary_player_id),
        defender: nameOf(players, e.tertiary_player_id),
        events: 0, scored: 0,
      });
    }
    const mu = matchups.get(key);
    mu.events += 1;
    if (truthy((e.payload || {}).goal) || truthy((e.payload || {}).made)) mu.scored += 1;
  }

  const onTarget = shots.filter((e) => truthy((e.payload || {}).on_target) || truthy((e.payload || {}).made)).length;
  const totalPoints = scoring.reduce((a, e) => a + (isBasketball ? (num((e.payload || {}).points) || 2) : 1), 0);

  return {
    kind: isBasketball ? 'basketball' : 'clock',
    summary: {
      events: live.length,
      shots: shots.length,
      onTarget,
      scores: scoring.length,
      points: totalPoints,
      conversion: shots.length ? round((scoring.length / shots.length) * 100, 1) : 0,
      accuracy: shots.length ? round((onTarget / shots.length) * 100, 1) : 0,
      cards: live.filter((e) => e.event_type === 'card').length,
      fouls: live.filter((e) => e.event_type === 'foul').length,
      saves: live.filter((e) => e.event_type === 'save').length,
      turnovers: live.filter((e) => e.event_type === 'turnover').length,
    },
    shotMap,
    timeline,
    momentum,
    phases,
    contributions: [...contributions.values()],
    matchups: [...matchups.values()].sort((a, b) => b.events - a.events),
  };
}

/* ------------------------------------------------------------------ */
/* Point sports — badminton, table tennis, volleyball                   */
/* ------------------------------------------------------------------ */

function analysePointSport(events, players, config) {
  const points = events.filter((e) => e.event_type === 'point' && !e.is_void);

  let us = 0;
  let them = 0;
  let bestRunUs = 0;
  let bestRunThem = 0;
  let currentRun = 0;
  let currentRunIsUs = null;
  const progression = [];
  const reasons = {};
  const rallyLengths = [];
  const perPlayer = new Map();

  for (const [i, e] of points.entries()) {
    const p = e.payload || {};
    const won = truthy(p.won_by_us);
    if (won) us += 1; else them += 1;

    if (currentRunIsUs === won) currentRun += 1;
    else { currentRun = 1; currentRunIsUs = won; }
    if (won) bestRunUs = Math.max(bestRunUs, currentRun);
    else bestRunThem = Math.max(bestRunThem, currentRun);

    progression.push({ rally: i + 1, us, them, lead: us - them, wonByUs: won });

    const reason = String(p.reason || 'unrecorded');
    if (!reasons[reason]) reasons[reason] = { reason, us: 0, them: 0 };
    if (won) reasons[reason].us += 1; else reasons[reason].them += 1;

    if (p.rally_length) rallyLengths.push(num(p.rally_length));

    const id = e.primary_player_id;
    if (id) {
      if (!perPlayer.has(id)) {
        perPlayer.set(id, { playerId: id, name: nameOf(players, id), won: 0, lost: 0, winners: 0, errors: 0 });
      }
      const s = perPlayer.get(id);
      if (won) s.won += 1; else s.lost += 1;
      if (['winner', 'smash', 'drop', 'service ace', 'kill', 'block', 'ace'].includes(reason)) s.winners += 1;
      if (['unforced error', 'service fault', 'attack error', 'service error', 'reception error'].includes(reason)) s.errors += 1;
    }
  }

  const avgRally = rallyLengths.length
    ? round(rallyLengths.reduce((a, b) => a + b, 0) / rallyLengths.length, 1)
    : null;

  return {
    kind: 'points',
    summary: {
      pointsFor: us,
      pointsAgainst: them,
      total: points.length,
      winPercent: points.length ? round((us / points.length) * 100, 1) : 0,
      longestRunFor: bestRunUs,
      longestRunAgainst: bestRunThem,
      averageRally: avgRally,
      longestRally: rallyLengths.length ? Math.max(...rallyLengths) : null,
      pointsPerSet: config.events?.pointsPerSet ?? null,
    },
    progression,
    momentum: progression.map((p) => ({ rally: p.rally, lead: p.lead })),
    reasons: Object.values(reasons).sort((a, b) => (b.us + b.them) - (a.us + a.them)),
    rallyBuckets: bucketRallies(rallyLengths),
    contributions: [...perPlayer.values()],
  };
}

function bucketRallies(lengths) {
  const buckets = [
    { key: 'short', label: '1–4 shots', from: 1, to: 4, count: 0 },
    { key: 'medium', label: '5–9 shots', from: 5, to: 9, count: 0 },
    { key: 'long', label: '10–19 shots', from: 10, to: 19, count: 0 },
    { key: 'marathon', label: '20+ shots', from: 20, to: 9999, count: 0 },
  ];
  for (const n of lengths) {
    const bucket = buckets.find((b) => n >= b.from && n <= b.to);
    if (bucket) bucket.count += 1;
  }
  return buckets.filter((b) => b.count > 0);
}

/* ------------------------------------------------------------------ */
/* Commentary                                                          */
/* ------------------------------------------------------------------ */

/** A readable line for one event, in the register a scorer would recognise. */
function describeEvent(event, players, sportCode) {
  const p = event.payload || {};
  // When one side of the event is the opposition there is no athlete record to
  // name, so the label the scorer typed stands in.
  const opponent = event.opponent_name || 'the opposition';
  const primary = nameOf(players, event.primary_player_id) || (event.primary_player_id ? 'Unknown' : opponent);
  const secondary = nameOf(players, event.secondary_player_id) || (event.secondary_player_id ? null : (p.opposition_role === 'bowler' ? opponent : null));
  const tertiary = nameOf(players, event.tertiary_player_id);

  if (event.event_type === 'ball') {
    const over = `${Math.floor(num(event.over_number))}.${num(event.ball_in_over)}`;
    const head = `${over} ${secondary || 'Bowler'} to ${primary}`;
    const extra = String(p.extra_type || '');
    if (truthy(p.wicket)) {
      const how = p.dismissal || 'out';
      return `${head} — OUT. ${primary} ${how}${tertiary ? ` (${tertiary})` : ''}.`;
    }
    if (extra === 'wide') return `${head} — wide.`;
    if (extra === 'no ball') return `${head} — no ball.`;
    const r = num(p.runs_batter);
    if (r === 0) return `${head} — no run.${p.beaten ? ' Beaten.' : ''}`;
    if (r === 4) return `${head} — FOUR${p.shot ? `, ${p.shot}` : ''}.`;
    if (r === 6) return `${head} — SIX${p.shot ? `, ${p.shot}` : ''}.`;
    return `${head} — ${r} run${r > 1 ? 's' : ''}${p.shot ? `, ${p.shot}` : ''}.`;
  }

  if (event.event_type === 'shot') {
    const minute = event.minute ? `${Math.round(num(event.minute))}' ` : '';
    if (sportCode === 'basketball') {
      const pts = num(p.points) || 2;
      if (truthy(p.made)) return `${minute}${primary} scores ${pts}${secondary ? `, assisted by ${secondary}` : ''}.`;
      return `${minute}${primary} misses a ${pts}-pointer${tertiary ? `, blocked by ${tertiary}` : ''}.`;
    }
    if (truthy(p.goal)) return `${minute}GOAL — ${primary}${secondary ? `, set up by ${secondary}` : ''}.`;
    if (truthy(p.saved)) return `${minute}${primary} forces a save${tertiary ? ` from ${tertiary}` : ''}.`;
    if (truthy(p.blocked)) return `${minute}${primary}'s shot is blocked.`;
    return `${minute}${primary} shoots off target.`;
  }

  if (event.event_type === 'point') {
    const won = truthy(p.won_by_us);
    return `Rally ${event.sequence}: point ${won ? 'to Karwan' : 'to the opposition'}${p.reason ? ` — ${p.reason}` : ''}${p.rally_length ? ` (${p.rally_length} shots)` : ''}.`;
  }

  const minute = event.minute ? `${Math.round(num(event.minute))}' ` : '';
  if (event.event_type === 'card') return `${minute}${p.card || 'Card'} for ${primary}${p.reason ? ` — ${p.reason}` : ''}.`;
  if (event.event_type === 'substitution') return `${minute}${primary} on for ${secondary || 'a teammate'}.`;
  if (event.event_type === 'save') return `${minute}${primary} saves${p.save_type ? ` — ${p.save_type}` : ''}.`;
  if (event.event_type === 'foul') return `${minute}Foul by ${primary}${secondary ? ` on ${secondary}` : ''}.`;
  if (event.event_type === 'rebound') return `${minute}${primary} takes a ${p.kind || ''} rebound.`.replace('  ', ' ');
  if (event.event_type === 'turnover') return `${minute}${primary} turns it over${secondary ? `, stolen by ${secondary}` : ''}.`;
  if (event.event_type === 'defensive') return `${minute}${primary} — ${p.action || 'defensive action'}.`;
  if (event.event_type === 'pass') return `${minute}${primary} finds ${secondary || 'a teammate'}${p.pass_type ? ` with a ${p.pass_type}` : ''}.`;
  if (event.event_type === 'note') return p.text || 'Note.';
  if (event.event_type === 'over_start') return `Over ${p.over_number}: ${primary} into the attack.`;
  if (event.event_type === 'batter_in') return `${primary} comes to the crease.`;
  return `${primary} — ${event.event_type.replace(/_/g, ' ')}.`;
}

/* ------------------------------------------------------------------ */
/* Entry point                                                         */
/* ------------------------------------------------------------------ */

/**
 * Full analysis for one match.
 * @param {object} sport   sport row with parsed config
 * @param {object[]} events  events with parsed payload, oldest first
 * @param {Map} players    player id → player row
 * @param {object[]} periods
 */
function analyseMatch(sport, events, players, periods = []) {
  const config = sport.config || {};
  const eventsConfig = config.events || {};

  const byPeriod = periods.map((period) => {
    const periodEvents = events.filter((e) => e.period_id === period.id);
    let analysis;
    if (eventsConfig.ballBased) analysis = analyseCricket(periodEvents, players, period);
    else if (eventsConfig.pointBased) analysis = analysePointSport(periodEvents, players, config);
    else analysis = analyseClockSport(periodEvents, players, config, sport.code);
    return {
      period: {
        id: period.id, sequence: period.sequence, label: period.label,
        teamId: period.team_id, teamLabel: period.team_label,
        opponentLabel: period.opponent_label, target: period.target,
        plannedLength: period.planned_length, status: period.status,
      },
      events: periodEvents.length,
      ...analysis,
    };
  });

  // Match totals.
  //
  // For clock and point sports, running the analysis across the whole match is
  // exactly right. For a ball-based sport it is not: over 1 exists in both
  // innings, so merging them would double-count the powerplay and produce a
  // 24-over innings. Cricket totals are therefore summed from the innings
  // rather than recomputed over merged events, and the innings stay the
  // authoritative view.
  let overall;
  if (eventsConfig.ballBased) {
    overall = summariseInnings(byPeriod, events, players);
  } else if (eventsConfig.pointBased) {
    overall = analysePointSport(events, players, config);
  } else {
    overall = analyseClockSport(events, players, config, sport.code);
  }

  const commentary = events
    .slice()
    .reverse()
    .map((e) => ({
      id: e.id,
      sequence: e.sequence,
      periodId: e.period_id,
      over: e.over_number !== null && e.over_number !== undefined
        ? `${Math.floor(num(e.over_number))}.${num(e.ball_in_over)}` : null,
      minute: e.minute ?? null,
      type: e.event_type,
      outcome: e.outcome,
      isVoid: !!e.is_void,
      text: e.commentary || describeEvent(e, players, sport.code),
    }));

  return {
    sport: { id: sport.id, code: sport.code, name: sport.name, color: sport.color },
    config: eventsConfig,
    totalEvents: events.length,
    periods: byPeriod,
    overall,
    commentary,
  };
}

/**
 * Cricket match totals, summed across innings rather than recomputed, so
 * per-over structures are never merged across innings boundaries.
 */
function summariseInnings(byPeriod, events, players) {
  const innings = byPeriod.filter((p) => p.summary);
  const total = (fn) => innings.reduce((a, i) => a + (fn(i) || 0), 0);
  const balls = total((i) => i.summary.balls);
  const runs = total((i) => i.summary.runs);
  const controlled = innings.filter((i) => i.summary.controlPercent !== null);

  // Career-style cards across the whole match: an athlete who bats in one
  // innings and bowls in the other appears once in each list.
  const battingCard = innings.flatMap((i) => i.battingCard).filter((b) => b.playerId);
  const bowlingCard = innings.flatMap((i) => i.bowlingCard).filter((b) => b.playerId);

  return {
    kind: 'cricket-match',
    perInnings: true,
    summary: {
      innings: innings.length,
      runs,
      wickets: total((i) => i.summary.wickets),
      balls,
      overs: oversFromBalls(balls),
      runRate: balls ? round((runs / balls) * 6) : 0,
      boundaries: total((i) => i.summary.boundaries),
      dotBalls: total((i) => i.summary.dotBalls),
      dotBallPercent: balls ? round((total((i) => i.summary.dotBalls) / balls) * 100, 1) : 0,
      extrasTotal: total((i) => i.summary.extrasTotal),
      controlPercent: controlled.length
        ? round(controlled.reduce((a, i) => a + i.summary.controlPercent, 0) / controlled.length, 1)
        : null,
    },
    battingCard: battingCard.sort((a, b) => b.runs - a.runs),
    bowlingCard: bowlingCard.sort((a, b) => b.wickets - a.wickets || a.economy - b.economy),
    wagonWheel: innings.flatMap((i) => i.wagonWheel),
    pitchMap: innings.flatMap((i) => i.pitchMap),
    matchups: innings.flatMap((i) => i.matchups),
    fallOfWickets: innings.flatMap((i) => i.fallOfWickets),
    partnerships: innings.flatMap((i) => i.partnerships),
    phases: [],
    overByOver: [],
    worm: [],
  };
}

module.exports = { analyseMatch, derivePerformances, describeEvent, matches, truthy };
