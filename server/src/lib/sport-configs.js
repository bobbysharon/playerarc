'use strict';
/**
 * Sport definitions.
 *
 * Everything sport-specific lives here as data, not code: positions, the
 * statistics captured per match, how those statistics roll up into a career
 * record, and how a performance rating is composed. These objects are written
 * into sports.config_json at seed time and are editable afterwards from
 * Settings → Sports, so adding volleyball or handball later is a new row —
 * not a rebuild.
 *
 * Field reference
 * ---------------
 * matchStats[]   Captured per player per match.
 *   key, label, group, type: int|dec|bool|select|text
 *   min/max      Validation bounds enforced server-side.
 *   positions[]  Restrict the field to certain positions (a goalkeeper's
 *                saves are not asked of a striker).
 *   derivedFrom  Formula — value is calculated, never typed by a user.
 *
 * career[]       Rolled up from every performance, in order.
 *   agg: sum | max | min | count | count_if | best_bowling
 *   field        Which matchStat to aggregate.
 *   whenFormula  For count_if — counted when the formula is non-zero.
 *   formula      For calculated entries, evaluated against earlier keys.
 *   format: int | 1dp | 2dp | pct | overs | text
 *
 * ratingModel    Weighted 0–100 components, each a formula over career keys.
 * leaderboards[] Ranking definitions surfaced in Rankings.
 */

const CRICKET = {
  category: 'team',
  color: '#1F7A5A',
  squadSize: 11,
  matchFormats: ['T20', 'T10', '40-over', '50-over', 'Two-day', 'Friendly'],
  positions: [
    { key: 'batter', label: 'Batter' },
    { key: 'opening_batter', label: 'Opening Batter' },
    { key: 'wicket_keeper', label: 'Wicket Keeper' },
    { key: 'all_rounder', label: 'All-rounder' },
    { key: 'fast_bowler', label: 'Fast Bowler' },
    { key: 'medium_pacer', label: 'Medium Pacer' },
    { key: 'spinner', label: 'Spin Bowler' },
  ],
  roles: ['Top order', 'Middle order', 'Finisher', 'New ball', 'Death overs', 'Powerplay'],
  statGroups: [
    { key: 'batting', label: 'Batting' },
    { key: 'bowling', label: 'Bowling' },
    { key: 'fielding', label: 'Fielding' },
  ],
  matchStats: [
    { key: 'batted', label: 'Batted', group: 'batting', type: 'bool' },
    { key: 'runs', label: 'Runs', group: 'batting', type: 'int', min: 0, max: 500 },
    { key: 'balls_faced', label: 'Balls faced', group: 'batting', type: 'int', min: 0, max: 500 },
    { key: 'fours', label: '4s', group: 'batting', type: 'int', min: 0, max: 100 },
    { key: 'sixes', label: '6s', group: 'batting', type: 'int', min: 0, max: 100 },
    { key: 'not_out', label: 'Not out', group: 'batting', type: 'bool' },
    {
      key: 'dismissal',
      label: 'Dismissal',
      group: 'batting',
      type: 'select',
      options: ['bowled', 'caught', 'lbw', 'run out', 'stumped', 'hit wicket', 'retired', 'not out'],
    },
    { key: 'bowled_spell', label: 'Bowled', group: 'bowling', type: 'bool' },
    { key: 'balls_bowled', label: 'Balls bowled', group: 'bowling', type: 'int', min: 0, max: 300, help: 'Six balls to an over' },
    { key: 'maidens', label: 'Maidens', group: 'bowling', type: 'int', min: 0, max: 50 },
    { key: 'runs_conceded', label: 'Runs conceded', group: 'bowling', type: 'int', min: 0, max: 400 },
    { key: 'wickets', label: 'Wickets', group: 'bowling', type: 'int', min: 0, max: 10 },
    { key: 'catches', label: 'Catches', group: 'fielding', type: 'int', min: 0, max: 10 },
    { key: 'run_outs', label: 'Run outs', group: 'fielding', type: 'int', min: 0, max: 10 },
    { key: 'stumpings', label: 'Stumpings', group: 'fielding', type: 'int', min: 0, max: 10, positions: ['wicket_keeper'] },
    { key: 'drops', label: 'Drops', group: 'fielding', type: 'int', min: 0, max: 10 },
  ],
  matchDerived: [
    { key: 'strike_rate', label: 'SR', group: 'batting', formula: 'div(runs, balls_faced) * 100', format: '2dp' },
    { key: 'overs', label: 'Overs', group: 'bowling', formula: 'balls_bowled', format: 'overs' },
    { key: 'economy', label: 'Econ', group: 'bowling', formula: 'div(runs_conceded, div(balls_bowled, 6))', format: '2dp' },
  ],
  career: [
    { key: 'matches', label: 'Matches', group: 'batting', agg: 'count', format: 'int' },
    { key: 'innings', label: 'Innings', group: 'batting', agg: 'count_if', whenFormula: 'batted', format: 'int' },
    { key: 'runs', label: 'Runs', group: 'batting', agg: 'sum', field: 'runs', format: 'int' },
    { key: 'balls_faced', label: 'Balls faced', group: 'batting', agg: 'sum', field: 'balls_faced', format: 'int' },
    { key: 'not_outs', label: 'Not outs', group: 'batting', agg: 'sum', field: 'not_out', format: 'int' },
    { key: 'highest_score', label: 'Highest score', group: 'batting', agg: 'max', field: 'runs', format: 'int' },
    { key: 'fours', label: '4s', group: 'batting', agg: 'sum', field: 'fours', format: 'int' },
    { key: 'sixes', label: '6s', group: 'batting', agg: 'sum', field: 'sixes', format: 'int' },
    { key: 'ducks', label: 'Ducks', group: 'batting', agg: 'count_if', whenFormula: 'batted * (1 - not_out) * (1 - gt(runs, 0))', format: 'int' },
    { key: 'thirties', label: '30s', group: 'batting', agg: 'count_if', whenFormula: 'gte(runs, 30) * lt(runs, 50)', format: 'int' },
    { key: 'fifties', label: '50s', group: 'batting', agg: 'count_if', whenFormula: 'gte(runs, 50) * lt(runs, 100)', format: 'int' },
    { key: 'hundreds', label: '100s', group: 'batting', agg: 'count_if', whenFormula: 'gte(runs, 100)', format: 'int' },
    { key: 'dismissals', label: 'Dismissals', group: 'batting', formula: 'max(innings - not_outs, 0)', format: 'int', hidden: true },
    { key: 'batting_average', label: 'Batting avg', group: 'batting', formula: 'div(runs, dismissals)', format: '2dp' },
    { key: 'strike_rate', label: 'Strike rate', group: 'batting', formula: 'div(runs, balls_faced) * 100', format: '2dp' },
    { key: 'bowling_innings', label: 'Innings bowled', group: 'bowling', agg: 'count_if', whenFormula: 'bowled_spell', format: 'int' },
    { key: 'balls_bowled', label: 'Balls bowled', group: 'bowling', agg: 'sum', field: 'balls_bowled', format: 'int', hidden: true },
    { key: 'overs', label: 'Overs', group: 'bowling', formula: 'balls_bowled', format: 'overs' },
    { key: 'maidens', label: 'Maidens', group: 'bowling', agg: 'sum', field: 'maidens', format: 'int' },
    { key: 'runs_conceded', label: 'Runs conceded', group: 'bowling', agg: 'sum', field: 'runs_conceded', format: 'int' },
    { key: 'wickets', label: 'Wickets', group: 'bowling', agg: 'sum', field: 'wickets', format: 'int' },
    { key: 'best_bowling', label: 'Best bowling', group: 'bowling', agg: 'best_bowling', format: 'text' },
    { key: 'three_wickets', label: '3-wicket hauls', group: 'bowling', agg: 'count_if', whenFormula: 'gte(wickets, 3)', format: 'int' },
    { key: 'four_wickets', label: '4-wicket hauls', group: 'bowling', agg: 'count_if', whenFormula: 'gte(wickets, 4)', format: 'int' },
    { key: 'five_wickets', label: '5-wicket hauls', group: 'bowling', agg: 'count_if', whenFormula: 'gte(wickets, 5)', format: 'int' },
    { key: 'economy', label: 'Economy', group: 'bowling', formula: 'div(runs_conceded, div(balls_bowled, 6))', format: '2dp' },
    { key: 'bowling_average', label: 'Bowling avg', group: 'bowling', formula: 'div(runs_conceded, wickets)', format: '2dp' },
    { key: 'bowling_strike_rate', label: 'Bowling SR', group: 'bowling', formula: 'div(balls_bowled, wickets)', format: '2dp' },
    { key: 'catches', label: 'Catches', group: 'fielding', agg: 'sum', field: 'catches', format: 'int' },
    { key: 'run_outs', label: 'Run outs', group: 'fielding', agg: 'sum', field: 'run_outs', format: 'int' },
    { key: 'stumpings', label: 'Stumpings', group: 'fielding', agg: 'sum', field: 'stumpings', format: 'int' },
    { key: 'fielding_dismissals', label: 'Fielding dismissals', group: 'fielding', formula: 'catches + run_outs + stumpings', format: 'int' },
  ],
  headline: ['matches', 'runs', 'batting_average', 'wickets', 'economy'],
  ratingModel: {
    scale: 100,
    note: 'Weights are configurable. Each component returns 0–100.',
    components: [
      { key: 'batting', label: 'Batting', weight: 0.3, formula: 'clamp(scale(batting_average, 45) * 0.6 + scale(strike_rate, 150) * 0.4, 0, 100)' },
      { key: 'bowling', label: 'Bowling', weight: 0.3, formula: 'clamp(scale(wickets, 40) * 0.5 + ifpos(economy, clamp(100 - (economy - 4) * 12, 0, 100), 0) * 0.5, 0, 100)' },
      { key: 'fielding', label: 'Fielding', weight: 0.15, formula: 'clamp(scale(fielding_dismissals, 25), 0, 100)' },
      { key: 'consistency', label: 'Consistency', weight: 0.15, formula: 'clamp(scale(fifties + hundreds * 2 + three_wickets, 10), 0, 100)' },
      { key: 'availability', label: 'Availability', weight: 0.1, formula: 'clamp(scale(matches, 30), 0, 100)' },
    ],
  },
  leaderboards: [
    { key: 'most_runs', label: 'Most runs', metric: 'runs', order: 'desc', format: 'int' },
    { key: 'batting_average', label: 'Batting average', metric: 'batting_average', order: 'desc', format: '2dp', qualifier: { metric: 'innings', min: 3 } },
    { key: 'strike_rate', label: 'Strike rate', metric: 'strike_rate', order: 'desc', format: '2dp', qualifier: { metric: 'balls_faced', min: 60 } },
    { key: 'most_wickets', label: 'Most wickets', metric: 'wickets', order: 'desc', format: 'int' },
    { key: 'best_economy', label: 'Best economy', metric: 'economy', order: 'asc', format: '2dp', qualifier: { metric: 'balls_bowled', min: 60 } },
    { key: 'fielding', label: 'Fielding dismissals', metric: 'fielding_dismissals', order: 'desc', format: 'int' },
  ],
};

const FOOTBALL = {
  category: 'team',
  color: '#2563A8',
  squadSize: 11,
  matchFormats: ['90 minutes', '11-a-side', '7-a-side', 'Friendly'],
  positions: [
    { key: 'GK', label: 'Goalkeeper', group: 'goalkeeper' },
    { key: 'CB', label: 'Centre Back', group: 'defence' },
    { key: 'LB', label: 'Left Back', group: 'defence' },
    { key: 'RB', label: 'Right Back', group: 'defence' },
    { key: 'DM', label: 'Defensive Midfielder', group: 'midfield' },
    { key: 'CM', label: 'Central Midfielder', group: 'midfield' },
    { key: 'AM', label: 'Attacking Midfielder', group: 'midfield' },
    { key: 'LW', label: 'Left Wing', group: 'attack' },
    { key: 'RW', label: 'Right Wing', group: 'attack' },
    { key: 'ST', label: 'Striker', group: 'attack' },
  ],
  roles: ['Playmaker', 'Target man', 'Ball-playing defender', 'Sweeper keeper', 'Box-to-box', 'Inverted winger'],
  statGroups: [
    { key: 'attacking', label: 'Attacking' },
    { key: 'passing', label: 'Passing' },
    { key: 'defending', label: 'Defending' },
    { key: 'goalkeeping', label: 'Goalkeeping' },
    { key: 'discipline', label: 'Discipline' },
  ],
  matchStats: [
    { key: 'started', label: 'Started', group: 'attacking', type: 'bool' },
    { key: 'minutes', label: 'Minutes played', group: 'attacking', type: 'int', min: 0, max: 130 },
    { key: 'goals', label: 'Goals', group: 'attacking', type: 'int', min: 0, max: 15 },
    { key: 'assists', label: 'Assists', group: 'attacking', type: 'int', min: 0, max: 15 },
    { key: 'shots', label: 'Shots', group: 'attacking', type: 'int', min: 0, max: 30 },
    { key: 'shots_on_target', label: 'Shots on target', group: 'attacking', type: 'int', min: 0, max: 30 },
    { key: 'passes', label: 'Passes', group: 'passing', type: 'int', min: 0, max: 250 },
    { key: 'passes_completed', label: 'Passes completed', group: 'passing', type: 'int', min: 0, max: 250 },
    { key: 'key_passes', label: 'Key passes', group: 'passing', type: 'int', min: 0, max: 30 },
    { key: 'tackles', label: 'Tackles', group: 'defending', type: 'int', min: 0, max: 30 },
    { key: 'interceptions', label: 'Interceptions', group: 'defending', type: 'int', min: 0, max: 30 },
    { key: 'clearances', label: 'Clearances', group: 'defending', type: 'int', min: 0, max: 40 },
    { key: 'duels_won', label: 'Duels won', group: 'defending', type: 'int', min: 0, max: 50 },
    { key: 'saves', label: 'Saves', group: 'goalkeeping', type: 'int', min: 0, max: 30, positions: ['GK'] },
    { key: 'goals_conceded', label: 'Goals conceded', group: 'goalkeeping', type: 'int', min: 0, max: 20, positions: ['GK'] },
    { key: 'clean_sheet', label: 'Clean sheet', group: 'goalkeeping', type: 'bool', positions: ['GK', 'CB', 'LB', 'RB'] },
    { key: 'fouls', label: 'Fouls', group: 'discipline', type: 'int', min: 0, max: 20 },
    { key: 'yellow_cards', label: 'Yellow cards', group: 'discipline', type: 'int', min: 0, max: 2 },
    { key: 'red_cards', label: 'Red cards', group: 'discipline', type: 'int', min: 0, max: 1 },
    { key: 'coach_rating', label: 'Coach rating (0–10)', group: 'discipline', type: 'dec', min: 0, max: 10 },
  ],
  matchDerived: [
    { key: 'pass_accuracy', label: 'Pass %', group: 'passing', formula: 'div(passes_completed, passes) * 100', format: 'pct' },
    { key: 'goal_contributions', label: 'G+A', group: 'attacking', formula: 'goals + assists', format: 'int' },
  ],
  career: [
    { key: 'matches', label: 'Matches', group: 'attacking', agg: 'count', format: 'int' },
    { key: 'starts', label: 'Starts', group: 'attacking', agg: 'sum', field: 'started', format: 'int' },
    { key: 'minutes', label: 'Minutes', group: 'attacking', agg: 'sum', field: 'minutes', format: 'int' },
    { key: 'goals', label: 'Goals', group: 'attacking', agg: 'sum', field: 'goals', format: 'int' },
    { key: 'assists', label: 'Assists', group: 'attacking', agg: 'sum', field: 'assists', format: 'int' },
    { key: 'goal_contributions', label: 'Goals + assists', group: 'attacking', formula: 'goals + assists', format: 'int' },
    { key: 'shots', label: 'Shots', group: 'attacking', agg: 'sum', field: 'shots', format: 'int' },
    { key: 'shots_on_target', label: 'Shots on target', group: 'attacking', agg: 'sum', field: 'shots_on_target', format: 'int' },
    { key: 'shot_accuracy', label: 'Shot accuracy', group: 'attacking', formula: 'div(shots_on_target, shots) * 100', format: 'pct' },
    { key: 'goals_per_90', label: 'Goals per 90', group: 'attacking', formula: 'div(goals, div(minutes, 90))', format: '2dp' },
    { key: 'hat_tricks', label: 'Hat-tricks', group: 'attacking', agg: 'count_if', whenFormula: 'gte(goals, 3)', format: 'int' },
    { key: 'passes', label: 'Passes', group: 'passing', agg: 'sum', field: 'passes', format: 'int' },
    { key: 'passes_completed', label: 'Passes completed', group: 'passing', agg: 'sum', field: 'passes_completed', format: 'int', hidden: true },
    { key: 'pass_accuracy', label: 'Pass accuracy', group: 'passing', formula: 'div(passes_completed, passes) * 100', format: 'pct' },
    { key: 'key_passes', label: 'Key passes', group: 'passing', agg: 'sum', field: 'key_passes', format: 'int' },
    { key: 'tackles', label: 'Tackles', group: 'defending', agg: 'sum', field: 'tackles', format: 'int' },
    { key: 'interceptions', label: 'Interceptions', group: 'defending', agg: 'sum', field: 'interceptions', format: 'int' },
    { key: 'clearances', label: 'Clearances', group: 'defending', agg: 'sum', field: 'clearances', format: 'int' },
    { key: 'duels_won', label: 'Duels won', group: 'defending', agg: 'sum', field: 'duels_won', format: 'int' },
    { key: 'saves', label: 'Saves', group: 'goalkeeping', agg: 'sum', field: 'saves', format: 'int' },
    { key: 'goals_conceded', label: 'Goals conceded', group: 'goalkeeping', agg: 'sum', field: 'goals_conceded', format: 'int' },
    { key: 'clean_sheets', label: 'Clean sheets', group: 'goalkeeping', agg: 'sum', field: 'clean_sheet', format: 'int' },
    { key: 'save_percentage', label: 'Save %', group: 'goalkeeping', formula: 'div(saves, saves + goals_conceded) * 100', format: 'pct' },
    { key: 'fouls', label: 'Fouls', group: 'discipline', agg: 'sum', field: 'fouls', format: 'int' },
    { key: 'yellow_cards', label: 'Yellow cards', group: 'discipline', agg: 'sum', field: 'yellow_cards', format: 'int' },
    { key: 'red_cards', label: 'Red cards', group: 'discipline', agg: 'sum', field: 'red_cards', format: 'int' },
    { key: 'avg_rating', label: 'Average rating', group: 'discipline', agg: 'avg', field: 'coach_rating', format: '2dp' },
  ],
  headline: ['matches', 'goals', 'assists', 'pass_accuracy', 'avg_rating'],
  ratingModel: {
    scale: 100,
    components: [
      { key: 'technical', label: 'Technical', weight: 0.25, formula: 'clamp(scale(pass_accuracy, 90) * 0.5 + scale(shot_accuracy, 60) * 0.5, 0, 100)' },
      { key: 'attacking', label: 'Attacking output', weight: 0.25, formula: 'clamp(scale(goal_contributions, 25), 0, 100)' },
      { key: 'defensive', label: 'Defensive work', weight: 0.2, formula: 'clamp(scale(tackles + interceptions + clearances + saves, 80), 0, 100)' },
      { key: 'match_performance', label: 'Match performance', weight: 0.2, formula: 'clamp(avg_rating * 10, 0, 100)' },
      { key: 'discipline', label: 'Discipline', weight: 0.1, formula: 'clamp(100 - yellow_cards * 5 - red_cards * 20, 0, 100)' },
    ],
  },
  leaderboards: [
    { key: 'top_scorers', label: 'Top scorers', metric: 'goals', order: 'desc', format: 'int' },
    { key: 'top_assists', label: 'Most assists', metric: 'assists', order: 'desc', format: 'int' },
    { key: 'contributions', label: 'Goals + assists', metric: 'goal_contributions', order: 'desc', format: 'int' },
    { key: 'clean_sheets', label: 'Clean sheets', metric: 'clean_sheets', order: 'desc', format: 'int' },
    { key: 'pass_accuracy', label: 'Pass accuracy', metric: 'pass_accuracy', order: 'desc', format: 'pct', qualifier: { metric: 'passes', min: 100 } },
    { key: 'avg_rating', label: 'Average rating', metric: 'avg_rating', order: 'desc', format: '2dp', qualifier: { metric: 'matches', min: 3 } },
  ],
};

const BASKETBALL = {
  category: 'team',
  color: '#D97706',
  squadSize: 5,
  matchFormats: ['4x10 minutes', '4x12 minutes', '3x3', 'Friendly'],
  positions: [
    { key: 'PG', label: 'Point Guard' },
    { key: 'SG', label: 'Shooting Guard' },
    { key: 'SF', label: 'Small Forward' },
    { key: 'PF', label: 'Power Forward' },
    { key: 'C', label: 'Centre' },
  ],
  roles: ['Floor general', 'Sharpshooter', 'Slasher', 'Rim protector', 'Sixth man'],
  statGroups: [
    { key: 'scoring', label: 'Scoring' },
    { key: 'rebounding', label: 'Rebounding' },
    { key: 'playmaking', label: 'Playmaking' },
    { key: 'defence', label: 'Defence' },
  ],
  matchStats: [
    { key: 'started', label: 'Started', group: 'scoring', type: 'bool' },
    { key: 'minutes', label: 'Minutes', group: 'scoring', type: 'int', min: 0, max: 60 },
    { key: 'fgm', label: 'Field goals made', group: 'scoring', type: 'int', min: 0, max: 40 },
    { key: 'fga', label: 'Field goals attempted', group: 'scoring', type: 'int', min: 0, max: 60 },
    { key: 'tpm', label: '3-pointers made', group: 'scoring', type: 'int', min: 0, max: 20 },
    { key: 'tpa', label: '3-pointers attempted', group: 'scoring', type: 'int', min: 0, max: 30 },
    { key: 'ftm', label: 'Free throws made', group: 'scoring', type: 'int', min: 0, max: 30 },
    { key: 'fta', label: 'Free throws attempted', group: 'scoring', type: 'int', min: 0, max: 30 },
    { key: 'oreb', label: 'Offensive rebounds', group: 'rebounding', type: 'int', min: 0, max: 30 },
    { key: 'dreb', label: 'Defensive rebounds', group: 'rebounding', type: 'int', min: 0, max: 30 },
    { key: 'assists', label: 'Assists', group: 'playmaking', type: 'int', min: 0, max: 30 },
    { key: 'turnovers', label: 'Turnovers', group: 'playmaking', type: 'int', min: 0, max: 20 },
    { key: 'steals', label: 'Steals', group: 'defence', type: 'int', min: 0, max: 15 },
    { key: 'blocks', label: 'Blocks', group: 'defence', type: 'int', min: 0, max: 15 },
    { key: 'fouls', label: 'Fouls', group: 'defence', type: 'int', min: 0, max: 6 },
    { key: 'plus_minus', label: 'Plus / minus', group: 'defence', type: 'int', min: -80, max: 80 },
  ],
  matchDerived: [
    { key: 'points', label: 'Points', group: 'scoring', formula: '(fgm - tpm) * 2 + tpm * 3 + ftm', format: 'int' },
    { key: 'rebounds', label: 'Rebounds', group: 'rebounding', formula: 'oreb + dreb', format: 'int' },
  ],
  career: [
    { key: 'games', label: 'Games', group: 'scoring', agg: 'count', format: 'int' },
    { key: 'starts', label: 'Starts', group: 'scoring', agg: 'sum', field: 'started', format: 'int' },
    { key: 'minutes', label: 'Minutes', group: 'scoring', agg: 'sum', field: 'minutes', format: 'int' },
    { key: 'fgm', label: 'FG made', group: 'scoring', agg: 'sum', field: 'fgm', format: 'int' },
    { key: 'fga', label: 'FG attempted', group: 'scoring', agg: 'sum', field: 'fga', format: 'int' },
    { key: 'tpm', label: '3P made', group: 'scoring', agg: 'sum', field: 'tpm', format: 'int' },
    { key: 'tpa', label: '3P attempted', group: 'scoring', agg: 'sum', field: 'tpa', format: 'int' },
    { key: 'ftm', label: 'FT made', group: 'scoring', agg: 'sum', field: 'ftm', format: 'int' },
    { key: 'fta', label: 'FT attempted', group: 'scoring', agg: 'sum', field: 'fta', format: 'int' },
    { key: 'points', label: 'Points', group: 'scoring', formula: '(fgm - tpm) * 2 + tpm * 3 + ftm', format: 'int' },
    { key: 'ppg', label: 'PPG', group: 'scoring', formula: 'div(points, games)', format: '1dp' },
    { key: 'fg_pct', label: 'FG%', group: 'scoring', formula: 'div(fgm, fga) * 100', format: 'pct' },
    { key: 'tp_pct', label: '3P%', group: 'scoring', formula: 'div(tpm, tpa) * 100', format: 'pct' },
    { key: 'ft_pct', label: 'FT%', group: 'scoring', formula: 'div(ftm, fta) * 100', format: 'pct' },
    { key: 'oreb', label: 'Offensive rebounds', group: 'rebounding', agg: 'sum', field: 'oreb', format: 'int' },
    { key: 'dreb', label: 'Defensive rebounds', group: 'rebounding', agg: 'sum', field: 'dreb', format: 'int' },
    { key: 'rebounds', label: 'Rebounds', group: 'rebounding', formula: 'oreb + dreb', format: 'int' },
    { key: 'rpg', label: 'RPG', group: 'rebounding', formula: 'div(rebounds, games)', format: '1dp' },
    { key: 'assists', label: 'Assists', group: 'playmaking', agg: 'sum', field: 'assists', format: 'int' },
    { key: 'apg', label: 'APG', group: 'playmaking', formula: 'div(assists, games)', format: '1dp' },
    { key: 'turnovers', label: 'Turnovers', group: 'playmaking', agg: 'sum', field: 'turnovers', format: 'int' },
    { key: 'assist_turnover', label: 'AST / TO', group: 'playmaking', formula: 'div(assists, turnovers)', format: '2dp' },
    { key: 'steals', label: 'Steals', group: 'defence', agg: 'sum', field: 'steals', format: 'int' },
    { key: 'blocks', label: 'Blocks', group: 'defence', agg: 'sum', field: 'blocks', format: 'int' },
    { key: 'spg', label: 'SPG', group: 'defence', formula: 'div(steals, games)', format: '1dp' },
    { key: 'bpg', label: 'BPG', group: 'defence', formula: 'div(blocks, games)', format: '1dp' },
    { key: 'fouls', label: 'Fouls', group: 'defence', agg: 'sum', field: 'fouls', format: 'int' },
    { key: 'plus_minus', label: 'Plus / minus', group: 'defence', agg: 'sum', field: 'plus_minus', format: 'int' },
    { key: 'double_doubles', label: 'Double-doubles', group: 'scoring', agg: 'count_if', whenFormula: 'gte(gte((fgm - tpm) * 2 + tpm * 3 + ftm, 10) + gte(oreb + dreb, 10) + gte(assists, 10), 2)', format: 'int' },
  ],
  headline: ['games', 'ppg', 'rpg', 'apg', 'fg_pct'],
  ratingModel: {
    scale: 100,
    components: [
      { key: 'scoring', label: 'Scoring', weight: 0.3, formula: 'clamp(scale(ppg, 25) * 0.7 + scale(fg_pct, 55) * 0.3, 0, 100)' },
      { key: 'defence', label: 'Defence', weight: 0.2, formula: 'clamp(scale(spg + bpg, 4), 0, 100)' },
      { key: 'playmaking', label: 'Playmaking', weight: 0.2, formula: 'clamp(scale(apg, 8) * 0.7 + scale(assist_turnover, 3) * 0.3, 0, 100)' },
      { key: 'physical', label: 'Rebounding', weight: 0.15, formula: 'clamp(scale(rpg, 10), 0, 100)' },
      { key: 'team_contribution', label: 'Team contribution', weight: 0.15, formula: 'clamp(50 + plus_minus, 0, 100)' },
    ],
  },
  leaderboards: [
    { key: 'ppg', label: 'Points per game', metric: 'ppg', order: 'desc', format: '1dp', qualifier: { metric: 'games', min: 3 } },
    { key: 'total_points', label: 'Total points', metric: 'points', order: 'desc', format: 'int' },
    { key: 'rpg', label: 'Rebounds per game', metric: 'rpg', order: 'desc', format: '1dp', qualifier: { metric: 'games', min: 3 } },
    { key: 'apg', label: 'Assists per game', metric: 'apg', order: 'desc', format: '1dp', qualifier: { metric: 'games', min: 3 } },
    { key: 'fg_pct', label: 'Field goal %', metric: 'fg_pct', order: 'desc', format: 'pct', qualifier: { metric: 'fga', min: 20 } },
  ],
};

/** Badminton and table tennis share a racket-sport shape. */
function racketSport({ color, formats, pointsPerSet, positions }) {
  return {
    category: 'racket',
    color,
    squadSize: 2,
    matchFormats: formats,
    positions,
    roles: ['Singles specialist', 'Doubles specialist', 'Mixed doubles'],
    statGroups: [
      { key: 'result', label: 'Result' },
      { key: 'scoring', label: 'Scoring' },
    ],
    matchStats: [
      { key: 'won', label: 'Won the match', group: 'result', type: 'bool' },
      { key: 'sets_won', label: 'Sets won', group: 'result', type: 'int', min: 0, max: 5 },
      { key: 'sets_lost', label: 'Sets lost', group: 'result', type: 'int', min: 0, max: 5 },
      { key: 'points_scored', label: 'Points scored', group: 'scoring', type: 'int', min: 0, max: 200 },
      { key: 'points_conceded', label: 'Points conceded', group: 'scoring', type: 'int', min: 0, max: 200 },
      { key: 'unforced_errors', label: 'Unforced errors', group: 'scoring', type: 'int', min: 0, max: 100 },
      { key: 'winners', label: 'Winners', group: 'scoring', type: 'int', min: 0, max: 100 },
      { key: 'duration', label: 'Duration (minutes)', group: 'result', type: 'int', min: 0, max: 240 },
      { key: 'round_reached', label: 'Round', group: 'result', type: 'select', options: ['Group', 'Round of 32', 'Round of 16', 'Quarter-final', 'Semi-final', 'Final'] },
      { key: 'ranking_points', label: 'Ranking points', group: 'result', type: 'int', min: 0, max: 5000 },
      { key: 'coach_rating', label: 'Coach rating (0–10)', group: 'result', type: 'dec', min: 0, max: 10 },
    ],
    matchDerived: [
      { key: 'point_ratio', label: 'Point ratio', group: 'scoring', formula: 'div(points_scored, points_conceded)', format: '2dp' },
    ],
    career: [
      { key: 'matches', label: 'Matches', group: 'result', agg: 'count', format: 'int' },
      { key: 'wins', label: 'Wins', group: 'result', agg: 'sum', field: 'won', format: 'int' },
      { key: 'losses', label: 'Losses', group: 'result', formula: 'matches - wins', format: 'int' },
      { key: 'win_percentage', label: 'Win %', group: 'result', formula: 'div(wins, matches) * 100', format: 'pct' },
      { key: 'sets_won', label: 'Sets won', group: 'result', agg: 'sum', field: 'sets_won', format: 'int' },
      { key: 'sets_lost', label: 'Sets lost', group: 'result', agg: 'sum', field: 'sets_lost', format: 'int' },
      { key: 'set_ratio', label: 'Set ratio', group: 'result', formula: 'div(sets_won, sets_lost)', format: '2dp' },
      { key: 'points_scored', label: 'Points scored', group: 'scoring', agg: 'sum', field: 'points_scored', format: 'int' },
      { key: 'points_conceded', label: 'Points conceded', group: 'scoring', agg: 'sum', field: 'points_conceded', format: 'int' },
      { key: 'points_per_set', label: 'Points per set', group: 'scoring', formula: 'div(points_scored, sets_won + sets_lost)', format: '1dp' },
      { key: 'winners', label: 'Winners', group: 'scoring', agg: 'sum', field: 'winners', format: 'int' },
      { key: 'unforced_errors', label: 'Unforced errors', group: 'scoring', agg: 'sum', field: 'unforced_errors', format: 'int' },
      { key: 'winner_error_ratio', label: 'Winners / errors', group: 'scoring', formula: 'div(winners, unforced_errors)', format: '2dp' },
      { key: 'ranking_points', label: 'Ranking points', group: 'result', agg: 'sum', field: 'ranking_points', format: 'int' },
      { key: 'avg_rating', label: 'Average rating', group: 'result', agg: 'avg', field: 'coach_rating', format: '2dp' },
      { key: 'straight_set_wins', label: 'Straight-set wins', group: 'result', agg: 'count_if', whenFormula: 'won * (1 - gt(sets_lost, 0))', format: 'int' },
    ],
    headline: ['matches', 'wins', 'win_percentage', 'set_ratio', 'ranking_points'],
    ratingModel: {
      scale: 100,
      pointsPerSet,
      components: [
        { key: 'results', label: 'Results', weight: 0.4, formula: 'clamp(win_percentage, 0, 100)' },
        { key: 'dominance', label: 'Set dominance', weight: 0.25, formula: 'clamp(scale(set_ratio, 3), 0, 100)' },
        { key: 'shot_quality', label: 'Shot quality', weight: 0.2, formula: 'clamp(scale(winner_error_ratio, 2), 0, 100)' },
        { key: 'coach_assessment', label: 'Coach assessment', weight: 0.15, formula: 'clamp(avg_rating * 10, 0, 100)' },
      ],
    },
    leaderboards: [
      { key: 'wins', label: 'Most wins', metric: 'wins', order: 'desc', format: 'int' },
      { key: 'win_pct', label: 'Win percentage', metric: 'win_percentage', order: 'desc', format: 'pct', qualifier: { metric: 'matches', min: 5 } },
      { key: 'ranking_points', label: 'Ranking points', metric: 'ranking_points', order: 'desc', format: 'int' },
      { key: 'set_ratio', label: 'Set ratio', metric: 'set_ratio', order: 'desc', format: '2dp', qualifier: { metric: 'matches', min: 5 } },
    ],
  };
}

const BADMINTON = racketSport({
  color: '#7C3AED',
  formats: ['Best of 3 (21 points)', 'Best of 5 (11 points)', 'Exhibition'],
  pointsPerSet: 21,
  positions: [
    { key: 'singles', label: 'Singles' },
    { key: 'doubles', label: 'Doubles' },
    { key: 'mixed_doubles', label: 'Mixed Doubles' },
  ],
});

const TABLE_TENNIS = racketSport({
  color: '#0891B2',
  formats: ['Best of 5 (11 points)', 'Best of 7 (11 points)', 'Exhibition'],
  pointsPerSet: 11,
  positions: [
    { key: 'singles', label: 'Singles' },
    { key: 'doubles', label: 'Doubles' },
    { key: 'mixed_doubles', label: 'Mixed Doubles' },
  ],
});

const FUTSAL = {
  category: 'indoor',
  color: '#DB2777',
  squadSize: 5,
  matchFormats: ['2x20 minutes', '2x25 minutes', 'Friendly'],
  positions: [
    { key: 'GK', label: 'Goalkeeper' },
    { key: 'FIXO', label: 'Fixo (Defender)' },
    { key: 'ALA_L', label: 'Left Winger' },
    { key: 'ALA_R', label: 'Right Winger' },
    { key: 'PIVO', label: 'Pivot' },
  ],
  roles: ['Target pivot', 'Flying keeper', 'Universal'],
  statGroups: [
    { key: 'attacking', label: 'Attacking' },
    { key: 'defending', label: 'Defending' },
    { key: 'discipline', label: 'Discipline' },
  ],
  matchStats: [
    { key: 'started', label: 'Started', group: 'attacking', type: 'bool' },
    { key: 'minutes', label: 'Minutes', group: 'attacking', type: 'int', min: 0, max: 60 },
    { key: 'goals', label: 'Goals', group: 'attacking', type: 'int', min: 0, max: 20 },
    { key: 'assists', label: 'Assists', group: 'attacking', type: 'int', min: 0, max: 20 },
    { key: 'shots', label: 'Shots', group: 'attacking', type: 'int', min: 0, max: 40 },
    { key: 'tackles', label: 'Tackles', group: 'defending', type: 'int', min: 0, max: 30 },
    { key: 'saves', label: 'Saves', group: 'defending', type: 'int', min: 0, max: 40, positions: ['GK'] },
    { key: 'goals_conceded', label: 'Goals conceded', group: 'defending', type: 'int', min: 0, max: 30, positions: ['GK'] },
    { key: 'fouls', label: 'Fouls', group: 'discipline', type: 'int', min: 0, max: 20 },
    { key: 'yellow_cards', label: 'Yellow cards', group: 'discipline', type: 'int', min: 0, max: 2 },
    { key: 'red_cards', label: 'Red cards', group: 'discipline', type: 'int', min: 0, max: 1 },
    { key: 'coach_rating', label: 'Coach rating (0–10)', group: 'discipline', type: 'dec', min: 0, max: 10 },
  ],
  matchDerived: [{ key: 'goal_contributions', label: 'G+A', group: 'attacking', formula: 'goals + assists', format: 'int' }],
  career: [
    { key: 'matches', label: 'Matches', group: 'attacking', agg: 'count', format: 'int' },
    { key: 'starts', label: 'Starts', group: 'attacking', agg: 'sum', field: 'started', format: 'int' },
    { key: 'minutes', label: 'Minutes', group: 'attacking', agg: 'sum', field: 'minutes', format: 'int' },
    { key: 'goals', label: 'Goals', group: 'attacking', agg: 'sum', field: 'goals', format: 'int' },
    { key: 'assists', label: 'Assists', group: 'attacking', agg: 'sum', field: 'assists', format: 'int' },
    { key: 'goal_contributions', label: 'Goals + assists', group: 'attacking', formula: 'goals + assists', format: 'int' },
    { key: 'shots', label: 'Shots', group: 'attacking', agg: 'sum', field: 'shots', format: 'int' },
    { key: 'tackles', label: 'Tackles', group: 'defending', agg: 'sum', field: 'tackles', format: 'int' },
    { key: 'saves', label: 'Saves', group: 'defending', agg: 'sum', field: 'saves', format: 'int' },
    { key: 'goals_conceded', label: 'Goals conceded', group: 'defending', agg: 'sum', field: 'goals_conceded', format: 'int' },
    { key: 'fouls', label: 'Fouls', group: 'discipline', agg: 'sum', field: 'fouls', format: 'int' },
    { key: 'yellow_cards', label: 'Yellow cards', group: 'discipline', agg: 'sum', field: 'yellow_cards', format: 'int' },
    { key: 'red_cards', label: 'Red cards', group: 'discipline', agg: 'sum', field: 'red_cards', format: 'int' },
    { key: 'avg_rating', label: 'Average rating', group: 'discipline', agg: 'avg', field: 'coach_rating', format: '2dp' },
  ],
  headline: ['matches', 'goals', 'assists', 'avg_rating'],
  ratingModel: {
    scale: 100,
    components: [
      { key: 'attacking', label: 'Attacking output', weight: 0.35, formula: 'clamp(scale(goal_contributions, 20), 0, 100)' },
      { key: 'defensive', label: 'Defensive work', weight: 0.25, formula: 'clamp(scale(tackles + saves, 40), 0, 100)' },
      { key: 'match_performance', label: 'Match performance', weight: 0.3, formula: 'clamp(avg_rating * 10, 0, 100)' },
      { key: 'discipline', label: 'Discipline', weight: 0.1, formula: 'clamp(100 - yellow_cards * 5 - red_cards * 20, 0, 100)' },
    ],
  },
  leaderboards: [
    { key: 'goals', label: 'Top scorers', metric: 'goals', order: 'desc', format: 'int' },
    { key: 'assists', label: 'Most assists', metric: 'assists', order: 'desc', format: 'int' },
  ],
};

const VOLLEYBALL = {
  category: 'team',
  color: '#0F766E',
  squadSize: 6,
  matchFormats: ['Best of 5 (25 points)', 'Best of 3 (25 points)', 'Friendly'],
  positions: [
    { key: 'OH', label: 'Outside Hitter' },
    { key: 'OPP', label: 'Opposite' },
    { key: 'MB', label: 'Middle Blocker' },
    { key: 'S', label: 'Setter' },
    { key: 'L', label: 'Libero' },
  ],
  roles: ['Primary passer', 'Serve specialist', 'Blocker'],
  statGroups: [
    { key: 'attack', label: 'Attack' },
    { key: 'defence', label: 'Defence' },
    { key: 'serve', label: 'Serve' },
  ],
  matchStats: [
    { key: 'started', label: 'Started', group: 'attack', type: 'bool' },
    { key: 'sets_played', label: 'Sets played', group: 'attack', type: 'int', min: 0, max: 5 },
    { key: 'kills', label: 'Kills', group: 'attack', type: 'int', min: 0, max: 60 },
    { key: 'attack_attempts', label: 'Attack attempts', group: 'attack', type: 'int', min: 0, max: 120 },
    { key: 'attack_errors', label: 'Attack errors', group: 'attack', type: 'int', min: 0, max: 40 },
    { key: 'blocks', label: 'Blocks', group: 'defence', type: 'int', min: 0, max: 30 },
    { key: 'digs', label: 'Digs', group: 'defence', type: 'int', min: 0, max: 60 },
    { key: 'reception_errors', label: 'Reception errors', group: 'defence', type: 'int', min: 0, max: 30 },
    { key: 'assists', label: 'Set assists', group: 'attack', type: 'int', min: 0, max: 80 },
    { key: 'aces', label: 'Aces', group: 'serve', type: 'int', min: 0, max: 20 },
    { key: 'service_errors', label: 'Service errors', group: 'serve', type: 'int', min: 0, max: 20 },
    { key: 'coach_rating', label: 'Coach rating (0–10)', group: 'serve', type: 'dec', min: 0, max: 10 },
  ],
  matchDerived: [
    { key: 'points', label: 'Points', group: 'attack', formula: 'kills + blocks + aces', format: 'int' },
    { key: 'hitting_pct', label: 'Hitting %', group: 'attack', formula: 'div(kills - attack_errors, attack_attempts) * 100', format: 'pct' },
  ],
  career: [
    { key: 'matches', label: 'Matches', group: 'attack', agg: 'count', format: 'int' },
    { key: 'sets_played', label: 'Sets played', group: 'attack', agg: 'sum', field: 'sets_played', format: 'int' },
    { key: 'kills', label: 'Kills', group: 'attack', agg: 'sum', field: 'kills', format: 'int' },
    { key: 'attack_attempts', label: 'Attack attempts', group: 'attack', agg: 'sum', field: 'attack_attempts', format: 'int' },
    { key: 'attack_errors', label: 'Attack errors', group: 'attack', agg: 'sum', field: 'attack_errors', format: 'int' },
    { key: 'hitting_pct', label: 'Hitting %', group: 'attack', formula: 'div(kills - attack_errors, attack_attempts) * 100', format: 'pct' },
    { key: 'assists', label: 'Set assists', group: 'attack', agg: 'sum', field: 'assists', format: 'int' },
    { key: 'blocks', label: 'Blocks', group: 'defence', agg: 'sum', field: 'blocks', format: 'int' },
    { key: 'digs', label: 'Digs', group: 'defence', agg: 'sum', field: 'digs', format: 'int' },
    { key: 'aces', label: 'Aces', group: 'serve', agg: 'sum', field: 'aces', format: 'int' },
    { key: 'service_errors', label: 'Service errors', group: 'serve', agg: 'sum', field: 'service_errors', format: 'int' },
    { key: 'points', label: 'Points', group: 'attack', formula: 'kills + blocks + aces', format: 'int' },
    { key: 'points_per_set', label: 'Points per set', group: 'attack', formula: 'div(points, sets_played)', format: '1dp' },
    { key: 'avg_rating', label: 'Average rating', group: 'serve', agg: 'avg', field: 'coach_rating', format: '2dp' },
  ],
  headline: ['matches', 'points', 'kills', 'blocks', 'hitting_pct'],
  ratingModel: {
    scale: 100,
    components: [
      { key: 'attack', label: 'Attack', weight: 0.35, formula: 'clamp(scale(points_per_set, 6) * 0.6 + scale(hitting_pct, 40) * 0.4, 0, 100)' },
      { key: 'defence', label: 'Defence', weight: 0.25, formula: 'clamp(scale(div(digs + blocks, max(sets_played,1)), 6), 0, 100)' },
      { key: 'serve', label: 'Serve', weight: 0.2, formula: 'clamp(scale(aces, 25) - service_errors, 0, 100)' },
      { key: 'coach_assessment', label: 'Coach assessment', weight: 0.2, formula: 'clamp(avg_rating * 10, 0, 100)' },
    ],
  },
  leaderboards: [
    { key: 'points', label: 'Most points', metric: 'points', order: 'desc', format: 'int' },
    { key: 'kills', label: 'Most kills', metric: 'kills', order: 'desc', format: 'int' },
    { key: 'blocks', label: 'Most blocks', metric: 'blocks', order: 'desc', format: 'int' },
  ],
};

const EVENTS = require('./event-configs');

const SPORTS = [
  { code: 'cricket', name: 'Cricket', icon: 'cricket', sort_order: 10, config: CRICKET },
  { code: 'football', name: 'Football', icon: 'football', sort_order: 20, config: FOOTBALL },
  { code: 'basketball', name: 'Basketball', icon: 'basketball', sort_order: 30, config: BASKETBALL },
  { code: 'badminton', name: 'Badminton', icon: 'badminton', sort_order: 40, config: BADMINTON },
  { code: 'table_tennis', name: 'Table Tennis', icon: 'table-tennis', sort_order: 50, config: TABLE_TENNIS },
  { code: 'futsal', name: 'Futsal', icon: 'futsal', sort_order: 60, config: FUTSAL },
  { code: 'volleyball', name: 'Volleyball', icon: 'volleyball', sort_order: 70, config: VOLLEYBALL },
];

// The ball-by-ball layer is defined alongside the statistics layer, so a sport
// remains one self-contained block of configuration.
for (const sport of SPORTS) {
  sport.config.events = EVENTS[sport.code] || null;
}

module.exports = { SPORTS, CRICKET, FOOTBALL, BASKETBALL, BADMINTON, TABLE_TENNIS, FUTSAL, VOLLEYBALL };
