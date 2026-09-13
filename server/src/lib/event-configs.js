'use strict';
/**
 * Event definitions — the ball-by-ball layer, one block per sport.
 *
 * These are merged into each sport's config_json under `events`. Like match
 * statistics, they are data rather than code: the capture console renders its
 * buttons and fields from `types`, and the analysis screen reads `charts` to
 * know what it can draw.
 *
 * The important part is `derive`. Every per-player match statistic that can be
 * worked out from events is declared here, so a scorer who records deliveries
 * never types a scorecard — runs, balls faced, wickets, economy, goals,
 * assists, points and rebounds all fall out of the events themselves. Enter a
 * match ball by ball and the scorecard, the career record, the ratings and the
 * leaderboards all follow from it.
 *
 * derive rule shape
 * -----------------
 *   stat      the match statistic key it feeds (must exist in matchStats)
 *   event     which event_type to read
 *   role      primary | secondary | tertiary — which player it credits
 *   sum       add up this payload field
 *   count     add 1 per matching event
 *   when      { field, eq | gte | truthy | in } — only count matching events
 *   unless    payload flags that disqualify the event (e.g. wides)
 *   value     a fixed number to add instead of a payload field
 */

/* ------------------------------------------------------------------ */
/* Cricket — the deepest of them: every delivery, fully described       */
/* ------------------------------------------------------------------ */
const CRICKET_EVENTS = {
  periodLabel: 'Innings',
  periodNoun: 'innings',
  defaultPeriods: 2,
  progressUnit: 'over',
  surface: 'cricket',
  ballBased: true,
  types: [
    {
      key: 'ball',
      label: 'Delivery',
      primaryLabel: 'Striker',
      secondaryLabel: 'Bowler',
      tertiaryLabel: 'Fielder',
      isProgress: true,
      fields: [
        { key: 'runs_batter', label: 'Runs off the bat', type: 'int', min: 0, max: 6, default: 0 },
        { key: 'extras', label: 'Extras', type: 'int', min: 0, max: 7, default: 0 },
        {
          key: 'extra_type', label: 'Extra type', type: 'select',
          options: ['wide', 'no ball', 'bye', 'leg bye', 'penalty'],
        },
        {
          key: 'shot', label: 'Shot played', type: 'select',
          options: ['defence', 'drive', 'cut', 'pull', 'hook', 'sweep', 'reverse sweep',
            'flick', 'glance', 'loft', 'ramp', 'leave', 'no shot'],
        },
        {
          key: 'length', label: 'Length', type: 'select',
          options: ['yorker', 'full toss', 'full', 'good', 'back of a length', 'short'],
        },
        {
          key: 'line', label: 'Line', type: 'select',
          options: ['wide outside off', 'outside off', 'off stump', 'middle', 'leg stump', 'down leg'],
        },
        {
          key: 'delivery_type', label: 'Delivery', type: 'select',
          options: ['seam', 'swing away', 'swing in', 'cutter', 'slower ball', 'bouncer',
            'off break', 'leg break', 'googly', 'arm ball', 'carrom ball', 'doosra'],
        },
        { key: 'speed_kph', label: 'Speed (kph)', type: 'dec', min: 40, max: 170 },
        { key: 'control', label: 'In control', type: 'bool', default: 1, help: 'Did the batter middle it?' },
        { key: 'beaten', label: 'Beaten', type: 'bool' },
        { key: 'edge', label: 'Edged', type: 'bool' },
        { key: 'appeal', label: 'Appeal', type: 'bool' },
        { key: 'dropped', label: 'Dropped catch', type: 'bool' },
        { key: 'wicket', label: 'Wicket falls', type: 'bool' },
        {
          key: 'dismissal', label: 'How out', type: 'select',
          options: ['bowled', 'caught', 'lbw', 'run out', 'stumped', 'hit wicket',
            'caught behind', 'caught and bowled'],
        },
        { key: 'boundary', label: 'Boundary', type: 'bool', derived: true },
      ],
      outcomes: [
        { key: 'dot', label: '•', tone: 'ink', set: { runs_batter: 0, extras: 0 } },
        { key: 'single', label: '1', tone: 'ink', set: { runs_batter: 1 } },
        { key: 'two', label: '2', tone: 'ink', set: { runs_batter: 2 } },
        { key: 'three', label: '3', tone: 'ink', set: { runs_batter: 3 } },
        { key: 'four', label: '4', tone: 'sky', set: { runs_batter: 4 } },
        { key: 'six', label: '6', tone: 'violet', set: { runs_batter: 6 } },
        { key: 'wide', label: 'Wd', tone: 'gold', set: { extras: 1, extra_type: 'wide' } },
        { key: 'noball', label: 'Nb', tone: 'gold', set: { extras: 1, extra_type: 'no ball' } },
        { key: 'bye', label: 'B', tone: 'gold', set: { extras: 1, extra_type: 'bye' } },
        { key: 'legbye', label: 'Lb', tone: 'gold', set: { extras: 1, extra_type: 'leg bye' } },
        { key: 'wicket', label: 'W', tone: 'alert', set: { wicket: 1 } },
      ],
      // A delivery counts towards the over unless it is a wide or a no ball.
      countsAsBall: { unless: ['wide', 'no ball'] },
      coordinates: { label: 'Where the ball went', legend: 'Wagon wheel' },
      pitchMap: { label: 'Where it pitched', fields: ['length', 'line'] },
    },
    {
      key: 'over_start',
      label: 'New over',
      primaryLabel: 'Bowler',
      fields: [{ key: 'over_number', label: 'Over', type: 'int', min: 1, max: 120 }],
    },
    {
      key: 'batter_in',
      label: 'Batter to the crease',
      primaryLabel: 'Batter',
      fields: [{ key: 'position', label: 'Batting position', type: 'int', min: 1, max: 11 }],
    },
    {
      key: 'note',
      label: 'Note',
      fields: [{ key: 'text', label: 'Note', type: 'text' }],
    },
  ],
  derive: [
    // Batting
    { stat: 'batted', event: 'ball', role: 'primary', value: 1, max: 1 },
    { stat: 'runs', event: 'ball', role: 'primary', sum: 'runs_batter' },
    { stat: 'balls_faced', event: 'ball', role: 'primary', count: true, unless: ['wide'] },
    { stat: 'fours', event: 'ball', role: 'primary', count: true, when: { field: 'runs_batter', eq: 4 } },
    { stat: 'sixes', event: 'ball', role: 'primary', count: true, when: { field: 'runs_batter', eq: 6 } },
    // Bowling
    { stat: 'bowled_spell', event: 'ball', role: 'secondary', value: 1, max: 1 },
    { stat: 'balls_bowled', event: 'ball', role: 'secondary', count: true, unless: ['wide', 'no ball'] },
    { stat: 'runs_conceded', event: 'ball', role: 'secondary', sum: 'runs_batter' },
    { stat: 'runs_conceded', event: 'ball', role: 'secondary', sum: 'extras', onlyExtras: ['wide', 'no ball'] },
    {
      stat: 'wickets', event: 'ball', role: 'secondary', count: true,
      when: { field: 'wicket', truthy: true },
      unlessDismissal: ['run out', 'retired'],
    },
    // Fielding
    {
      stat: 'catches', event: 'ball', role: 'tertiary', count: true,
      when: { field: 'dismissal', in: ['caught', 'caught behind', 'caught and bowled'] },
    },
    { stat: 'run_outs', event: 'ball', role: 'tertiary', count: true, when: { field: 'dismissal', eq: 'run out' } },
    { stat: 'stumpings', event: 'ball', role: 'tertiary', count: true, when: { field: 'dismissal', eq: 'stumped' } },
    { stat: 'drops', event: 'ball', role: 'tertiary', count: true, when: { field: 'dropped', truthy: true } },
  ],
  charts: ['manhattan', 'worm', 'partnerships', 'fall_of_wickets', 'wagon_wheel', 'pitch_map',
    'run_rate', 'phases', 'bowling_spells', 'matchups', 'control', 'commentary'],
  phases: [
    { key: 'powerplay', label: 'Powerplay', from: 0, to: 6 },
    { key: 'middle', label: 'Middle overs', from: 6, to: 16 },
    { key: 'death', label: 'Death overs', from: 16, to: 999 },
  ],
};

/* ------------------------------------------------------------------ */
/* Football                                                            */
/* ------------------------------------------------------------------ */
const FOOTBALL_EVENTS = {
  periodLabel: 'Half',
  periodNoun: 'half',
  defaultPeriods: 2,
  progressUnit: 'minute',
  surface: 'football',
  clockBased: true,
  types: [
    {
      key: 'shot',
      label: 'Shot',
      primaryLabel: 'Shooter',
      secondaryLabel: 'Assisted by',
      tertiaryLabel: 'Goalkeeper',
      fields: [
        { key: 'on_target', label: 'On target', type: 'bool' },
        { key: 'goal', label: 'Goal', type: 'bool' },
        { key: 'body_part', label: 'Body part', type: 'select', options: ['right foot', 'left foot', 'head', 'other'] },
        { key: 'situation', label: 'Situation', type: 'select', options: ['open play', 'counter', 'corner', 'free kick', 'penalty', 'throw-in'] },
        { key: 'blocked', label: 'Blocked', type: 'bool' },
        { key: 'saved', label: 'Saved', type: 'bool' },
        { key: 'big_chance', label: 'Big chance', type: 'bool' },
      ],
      outcomes: [
        { key: 'goal', label: 'Goal', tone: 'pitch', set: { goal: 1, on_target: 1 } },
        { key: 'saved', label: 'Saved', tone: 'sky', set: { on_target: 1, saved: 1 } },
        { key: 'blocked', label: 'Blocked', tone: 'ink', set: { blocked: 1 } },
        { key: 'off_target', label: 'Off target', tone: 'ink', set: { on_target: 0 } },
        { key: 'woodwork', label: 'Woodwork', tone: 'gold', set: { on_target: 0 } },
      ],
      coordinates: { label: 'Shot location', legend: 'Shot map' },
    },
    {
      key: 'pass',
      label: 'Key pass',
      primaryLabel: 'Passer',
      secondaryLabel: 'Receiver',
      fields: [
        { key: 'completed', label: 'Completed', type: 'bool', default: 1 },
        { key: 'pass_type', label: 'Type', type: 'select', options: ['through ball', 'cross', 'long ball', 'switch', 'cut-back'] },
      ],
      coordinates: { label: 'From', legend: 'Pass map', hasEnd: true },
    },
    {
      key: 'defensive',
      label: 'Defensive action',
      primaryLabel: 'Defender',
      fields: [
        { key: 'action', label: 'Action', type: 'select', options: ['tackle', 'interception', 'clearance', 'block', 'recovery', 'duel won', 'duel lost'] },
        { key: 'successful', label: 'Successful', type: 'bool', default: 1 },
      ],
      coordinates: { label: 'Location' },
    },
    {
      key: 'save',
      label: 'Save',
      primaryLabel: 'Goalkeeper',
      fields: [{ key: 'save_type', label: 'Type', type: 'select', options: ['catch', 'parry', 'tip over', 'one on one', 'penalty'] }],
      coordinates: { label: 'Location' },
    },
    {
      key: 'card',
      label: 'Card',
      primaryLabel: 'Player',
      fields: [
        { key: 'card', label: 'Card', type: 'select', options: ['yellow', 'second yellow', 'red'] },
        { key: 'reason', label: 'Reason', type: 'text' },
      ],
      outcomes: [
        { key: 'yellow', label: 'Yellow', tone: 'gold', set: { card: 'yellow' } },
        { key: 'red', label: 'Red', tone: 'alert', set: { card: 'red' } },
      ],
    },
    {
      key: 'substitution',
      label: 'Substitution',
      primaryLabel: 'Coming on',
      secondaryLabel: 'Going off',
      fields: [{ key: 'reason', label: 'Reason', type: 'select', options: ['tactical', 'injury', 'rest'] }],
    },
    {
      key: 'foul',
      label: 'Foul',
      primaryLabel: 'Offender',
      secondaryLabel: 'Fouled',
      fields: [{ key: 'won_free_kick', label: 'Free kick awarded', type: 'bool', default: 1 }],
      coordinates: { label: 'Location' },
    },
    { key: 'note', label: 'Note', fields: [{ key: 'text', label: 'Note', type: 'text' }] },
  ],
  derive: [
    { stat: 'shots', event: 'shot', role: 'primary', count: true },
    { stat: 'shots_on_target', event: 'shot', role: 'primary', count: true, when: { field: 'on_target', truthy: true } },
    { stat: 'goals', event: 'shot', role: 'primary', count: true, when: { field: 'goal', truthy: true } },
    { stat: 'assists', event: 'shot', role: 'secondary', count: true, when: { field: 'goal', truthy: true } },
    { stat: 'key_passes', event: 'pass', role: 'primary', count: true },
    { stat: 'passes', event: 'pass', role: 'primary', count: true },
    { stat: 'passes_completed', event: 'pass', role: 'primary', count: true, when: { field: 'completed', truthy: true } },
    { stat: 'tackles', event: 'defensive', role: 'primary', count: true, when: { field: 'action', eq: 'tackle' } },
    { stat: 'interceptions', event: 'defensive', role: 'primary', count: true, when: { field: 'action', eq: 'interception' } },
    { stat: 'clearances', event: 'defensive', role: 'primary', count: true, when: { field: 'action', eq: 'clearance' } },
    { stat: 'duels_won', event: 'defensive', role: 'primary', count: true, when: { field: 'action', eq: 'duel won' } },
    { stat: 'saves', event: 'save', role: 'primary', count: true },
    { stat: 'goals_conceded', event: 'shot', role: 'tertiary', count: true, when: { field: 'goal', truthy: true } },
    { stat: 'fouls', event: 'foul', role: 'primary', count: true },
    { stat: 'yellow_cards', event: 'card', role: 'primary', count: true, when: { field: 'card', eq: 'yellow' } },
    { stat: 'red_cards', event: 'card', role: 'primary', count: true, when: { field: 'card', in: ['red', 'second yellow'] } },
  ],
  charts: ['timeline', 'shot_map', 'momentum', 'phases', 'matchups', 'commentary', 'pass_map'],
  phases: [
    { key: 'first15', label: '0–15', from: 0, to: 15 },
    { key: 'to30', label: '15–30', from: 15, to: 30 },
    { key: 'to45', label: '30–45', from: 30, to: 45 },
    { key: 'to60', label: '45–60', from: 45, to: 60 },
    { key: 'to75', label: '60–75', from: 60, to: 75 },
    { key: 'to90', label: '75–90', from: 75, to: 999 },
  ],
};

/* ------------------------------------------------------------------ */
/* Basketball                                                          */
/* ------------------------------------------------------------------ */
const BASKETBALL_EVENTS = {
  periodLabel: 'Quarter',
  periodNoun: 'quarter',
  defaultPeriods: 4,
  progressUnit: 'minute',
  surface: 'basketball',
  clockBased: true,
  types: [
    {
      key: 'shot',
      label: 'Shot',
      primaryLabel: 'Shooter',
      secondaryLabel: 'Assisted by',
      tertiaryLabel: 'Blocked by',
      fields: [
        { key: 'points', label: 'Points', type: 'select', options: ['1', '2', '3'] },
        { key: 'made', label: 'Made', type: 'bool' },
        { key: 'shot_type', label: 'Shot type', type: 'select', options: ['layup', 'dunk', 'jump shot', 'floater', 'hook', 'step back', 'free throw'] },
        { key: 'blocked', label: 'Blocked', type: 'bool' },
        { key: 'fastbreak', label: 'Fast break', type: 'bool' },
      ],
      outcomes: [
        { key: 'made2', label: '2 pts', tone: 'pitch', set: { points: '2', made: 1 } },
        { key: 'made3', label: '3 pts', tone: 'violet', set: { points: '3', made: 1 } },
        { key: 'ft', label: 'Free throw', tone: 'sky', set: { points: '1', made: 1, shot_type: 'free throw' } },
        { key: 'miss2', label: 'Miss 2', tone: 'ink', set: { points: '2', made: 0 } },
        { key: 'miss3', label: 'Miss 3', tone: 'ink', set: { points: '3', made: 0 } },
      ],
      coordinates: { label: 'Shot location', legend: 'Shot chart' },
    },
    {
      key: 'rebound',
      label: 'Rebound',
      primaryLabel: 'Rebounder',
      fields: [{ key: 'kind', label: 'Kind', type: 'select', options: ['offensive', 'defensive'] }],
    },
    {
      key: 'turnover',
      label: 'Turnover',
      primaryLabel: 'Lost by',
      secondaryLabel: 'Stolen by',
      fields: [{ key: 'kind', label: 'Kind', type: 'select', options: ['bad pass', 'lost ball', 'travel', 'offensive foul', 'shot clock'] }],
    },
    {
      key: 'foul',
      label: 'Foul',
      primaryLabel: 'Offender',
      secondaryLabel: 'Drawn by',
      fields: [{ key: 'kind', label: 'Kind', type: 'select', options: ['personal', 'shooting', 'offensive', 'technical'] }],
    },
    {
      key: 'substitution',
      label: 'Substitution',
      primaryLabel: 'Coming on',
      secondaryLabel: 'Going off',
      fields: [],
    },
    { key: 'note', label: 'Note', fields: [{ key: 'text', label: 'Note', type: 'text' }] },
  ],
  derive: [
    { stat: 'fga', event: 'shot', role: 'primary', count: true, whenNot: { field: 'shot_type', eq: 'free throw' } },
    { stat: 'fgm', event: 'shot', role: 'primary', count: true, when: { field: 'made', truthy: true }, whenNot: { field: 'shot_type', eq: 'free throw' } },
    { stat: 'tpa', event: 'shot', role: 'primary', count: true, when: { field: 'points', eq: '3' } },
    { stat: 'tpm', event: 'shot', role: 'primary', count: true, when: { field: 'points', eq: '3' }, andWhen: { field: 'made', truthy: true } },
    { stat: 'fta', event: 'shot', role: 'primary', count: true, when: { field: 'shot_type', eq: 'free throw' } },
    { stat: 'ftm', event: 'shot', role: 'primary', count: true, when: { field: 'shot_type', eq: 'free throw' }, andWhen: { field: 'made', truthy: true } },
    { stat: 'assists', event: 'shot', role: 'secondary', count: true, when: { field: 'made', truthy: true } },
    { stat: 'blocks', event: 'shot', role: 'tertiary', count: true },
    { stat: 'oreb', event: 'rebound', role: 'primary', count: true, when: { field: 'kind', eq: 'offensive' } },
    { stat: 'dreb', event: 'rebound', role: 'primary', count: true, when: { field: 'kind', eq: 'defensive' } },
    { stat: 'turnovers', event: 'turnover', role: 'primary', count: true },
    { stat: 'steals', event: 'turnover', role: 'secondary', count: true },
    { stat: 'fouls', event: 'foul', role: 'primary', count: true },
  ],
  charts: ['timeline', 'shot_map', 'momentum', 'quarter_scoring', 'matchups', 'commentary'],
  phases: [
    { key: 'q1', label: 'Q1', from: 0, to: 10 },
    { key: 'q2', label: 'Q2', from: 10, to: 20 },
    { key: 'q3', label: 'Q3', from: 20, to: 30 },
    { key: 'q4', label: 'Q4', from: 30, to: 999 },
  ],
};

/* ------------------------------------------------------------------ */
/* Racket sports — point by point                                      */
/* ------------------------------------------------------------------ */
function racketEvents(pointsPerSet) {
  return {
    periodLabel: 'Set',
    periodNoun: 'set',
    defaultPeriods: 3,
    progressUnit: 'rally',
    surface: 'court',
    pointBased: true,
    pointsPerSet,
    types: [
      {
        key: 'point',
        label: 'Point',
        primaryLabel: 'Won by',
        secondaryLabel: 'Lost by',
        isProgress: true,
        fields: [
          { key: 'won_by_us', label: 'Point to Karwan', type: 'bool', default: 1 },
          { key: 'reason', label: 'How', type: 'select', options: ['winner', 'smash', 'drop', 'net', 'forced error', 'unforced error', 'service ace', 'service fault', 'let'] },
          { key: 'rally_length', label: 'Shots in the rally', type: 'int', min: 1, max: 120 },
          { key: 'serving', label: 'Serving', type: 'bool' },
          { key: 'duration_seconds', label: 'Rally length (s)', type: 'int', min: 1, max: 300 },
        ],
        outcomes: [
          { key: 'won', label: 'Point won', tone: 'pitch', set: { won_by_us: 1 } },
          { key: 'lost', label: 'Point lost', tone: 'alert', set: { won_by_us: 0 } },
          { key: 'ace', label: 'Ace', tone: 'violet', set: { won_by_us: 1, reason: 'service ace', serving: 1 } },
          { key: 'winner', label: 'Winner', tone: 'sky', set: { won_by_us: 1, reason: 'winner' } },
          { key: 'unforced', label: 'Unforced error', tone: 'gold', set: { won_by_us: 0, reason: 'unforced error' } },
        ],
        coordinates: { label: 'Where it landed', legend: 'Court map' },
      },
      { key: 'note', label: 'Note', fields: [{ key: 'text', label: 'Note', type: 'text' }] },
    ],
    derive: [
      { stat: 'points_scored', event: 'point', role: 'primary', count: true, when: { field: 'won_by_us', truthy: true } },
      { stat: 'points_conceded', event: 'point', role: 'primary', count: true, when: { field: 'won_by_us', falsy: true } },
      { stat: 'winners', event: 'point', role: 'primary', count: true, when: { field: 'reason', in: ['winner', 'smash', 'drop', 'service ace'] } },
      { stat: 'unforced_errors', event: 'point', role: 'primary', count: true, when: { field: 'reason', in: ['unforced error', 'service fault'] } },
    ],
    charts: ['point_progression', 'momentum', 'rally_lengths', 'point_reasons', 'commentary'],
    phases: [],
  };
}

/* ------------------------------------------------------------------ */
/* Futsal and volleyball                                               */
/* ------------------------------------------------------------------ */
const FUTSAL_EVENTS = {
  ...FOOTBALL_EVENTS,
  periodLabel: 'Half',
  defaultPeriods: 2,
  surface: 'futsal',
  phases: [
    { key: 'first10', label: '0–10', from: 0, to: 10 },
    { key: 'to20', label: '10–20', from: 10, to: 20 },
    { key: 'to30', label: '20–30', from: 20, to: 30 },
    { key: 'to40', label: '30–40', from: 30, to: 999 },
  ],
  charts: ['timeline', 'shot_map', 'momentum', 'matchups', 'commentary'],
};

const VOLLEYBALL_EVENTS = {
  periodLabel: 'Set',
  periodNoun: 'set',
  defaultPeriods: 5,
  progressUnit: 'rally',
  surface: 'court',
  pointBased: true,
  pointsPerSet: 25,
  types: [
    {
      key: 'point',
      label: 'Rally',
      primaryLabel: 'Decided by',
      secondaryLabel: 'Set up by',
      isProgress: true,
      fields: [
        { key: 'won_by_us', label: 'Point to Karwan', type: 'bool', default: 1 },
        { key: 'reason', label: 'How', type: 'select', options: ['kill', 'block', 'ace', 'attack error', 'service error', 'reception error', 'opponent error'] },
        { key: 'rally_length', label: 'Contacts in the rally', type: 'int', min: 1, max: 60 },
      ],
      outcomes: [
        { key: 'kill', label: 'Kill', tone: 'pitch', set: { won_by_us: 1, reason: 'kill' } },
        { key: 'block', label: 'Block', tone: 'sky', set: { won_by_us: 1, reason: 'block' } },
        { key: 'ace', label: 'Ace', tone: 'violet', set: { won_by_us: 1, reason: 'ace' } },
        { key: 'error', label: 'Our error', tone: 'alert', set: { won_by_us: 0, reason: 'attack error' } },
        { key: 'lost', label: 'Point lost', tone: 'ink', set: { won_by_us: 0 } },
      ],
      coordinates: { label: 'Where it landed', legend: 'Court map' },
    },
    { key: 'note', label: 'Note', fields: [{ key: 'text', label: 'Note', type: 'text' }] },
  ],
  derive: [
    { stat: 'kills', event: 'point', role: 'primary', count: true, when: { field: 'reason', eq: 'kill' } },
    { stat: 'blocks', event: 'point', role: 'primary', count: true, when: { field: 'reason', eq: 'block' } },
    { stat: 'aces', event: 'point', role: 'primary', count: true, when: { field: 'reason', eq: 'ace' } },
    { stat: 'attack_errors', event: 'point', role: 'primary', count: true, when: { field: 'reason', eq: 'attack error' } },
    { stat: 'service_errors', event: 'point', role: 'primary', count: true, when: { field: 'reason', eq: 'service error' } },
    { stat: 'assists', event: 'point', role: 'secondary', count: true },
  ],
  charts: ['point_progression', 'momentum', 'point_reasons', 'commentary'],
  phases: [],
};

module.exports = {
  cricket: CRICKET_EVENTS,
  football: FOOTBALL_EVENTS,
  basketball: BASKETBALL_EVENTS,
  badminton: racketEvents(21),
  table_tennis: racketEvents(11),
  futsal: FUTSAL_EVENTS,
  volleyball: VOLLEYBALL_EVENTS,
};
