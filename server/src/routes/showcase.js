'use strict';
const express = require('express');
const { db } = require('../db');
const { asyncHandler, ApiError } = require('../middleware/error');
const { getSport, playerCareer } = require('../lib/repo');

const router = express.Router();

/**
 * A shareable digital resume for a cricket player: identity, career stats,
 * achievements and an assessment summary. No contact details, no video —
 * this is deliberately the "discovery" surface, not the full record.
 */
router.get('/:token', asyncHandler(async (req, res) => {
  const player = db.prepare('SELECT * FROM players WHERE showcase_token = ? AND showcase_enabled = 1').get(req.params.token);
  if (!player) throw new ApiError(404, 'This showcase link is not available.');

  const cricket = getSport('cricket');
  const playsCricket = cricket && db.prepare('SELECT 1 FROM player_sports WHERE player_id = ? AND sport_id = ?').get(player.id, cricket.id);
  if (!playsCricket) throw new ApiError(404, 'This showcase link is not available.');

  const playerSport = db
    .prepare(`SELECT ps.*, t.name AS team_name, t.age_group FROM player_sports ps
              LEFT JOIN team_memberships tm ON tm.player_id = ps.player_id AND tm.end_date IS NULL
              LEFT JOIN teams t ON t.id = tm.team_id AND t.sport_id = ps.sport_id
              WHERE ps.player_id = ? AND ps.sport_id = ? LIMIT 1`)
    .get(player.id, cricket.id);

  const career = playerCareer(player.id, cricket, {});

  const achievements = db
    .prepare(`SELECT title, category, level, awarded_date FROM achievements
              WHERE player_id = ? AND (sport_id IS NULL OR sport_id = ?) ORDER BY awarded_date DESC LIMIT 25`)
    .all(player.id, cricket.id);

  const assessmentSummary = db
    .prepare(`SELECT assessment_date, cycle, age_group, overall_score, recommendation
              FROM assessments WHERE player_id = ? AND sport_id = ? ORDER BY assessment_date DESC LIMIT 5`)
    .all(player.id, cricket.id);

  res.json({
    player: {
      athlete_id: player.athlete_id,
      display_name: player.display_name || `${player.first_name} ${player.last_name}`,
      photo_url: player.photo_url,
      nationality: player.nationality,
      bio: player.bio,
    },
    sport: { name: cricket.name, color: cricket.color },
    position: playerSport ? { key: playerSport.position, role: playerSport.playing_role, team: playerSport.team_name, ageGroup: playerSport.age_group } : null,
    career,
    achievements,
    assessmentSummary,
  });
}));

module.exports = router;
