'use strict';
const express = require('express');
const { z } = require('zod');
const { db, tx } = require('../db');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { audit } = require('../middleware/audit');
const { asyncHandler, ApiError } = require('../middleware/error');
const { requireCricketSport } = require('../lib/cricket-scope');
const { canAccessTeam } = require('../middleware/scope');

const router = express.Router();

/** Resolve a message's scope into the concrete list of recipient player ids. */
function resolveRecipients(scopeType, { teamId, groupId, playerId }) {
  if (scopeType === 'team') {
    return db.prepare(`SELECT player_id FROM team_memberships WHERE team_id = ? AND end_date IS NULL`).all(teamId).map((r) => r.player_id);
  }
  if (scopeType === 'group') {
    return db.prepare('SELECT player_id FROM player_group_members WHERE group_id = ?').all(groupId).map((r) => r.player_id);
  }
  return [playerId];
}

const messageSchema = z.object({
  sport_id: z.coerce.number().int().optional(),
  scope_type: z.enum(['team', 'group', 'player']),
  team_id: z.coerce.number().int().optional().nullable(),
  group_id: z.coerce.number().int().optional().nullable(),
  player_id: z.coerce.number().int().optional().nullable(),
  subject: z.string().optional().nullable(),
  body: z.string().min(1),
});

router.post('/', requirePermission('messages.write'), asyncHandler(async (req, res) => {
  const body = messageSchema.parse(req.body);
  const sport = requireCricketSport(body.sport_id || 'cricket');

  if (body.scope_type === 'team') {
    if (!body.team_id) throw new ApiError(422, 'A team is required for a squad message.');
    if (!canAccessTeam(req.user, body.team_id)) throw new ApiError(403, 'That team is not assigned to you.');
  }
  if (body.scope_type === 'group' && !body.group_id) throw new ApiError(422, 'A group is required.');
  if (body.scope_type === 'player' && !body.player_id) throw new ApiError(422, 'A player is required.');

  const recipientIds = resolveRecipients(body.scope_type, { teamId: body.team_id, groupId: body.group_id, playerId: body.player_id });
  if (!recipientIds.length) throw new ApiError(422, 'That selection has no players to message.');

  const messageId = tx(() => {
    const info = db
      .prepare(`INSERT INTO messages (sport_id, sender_id, scope_type, team_id, group_id, player_id, subject, body)
                VALUES (?,?,?,?,?,?,?,?)`)
      .run(sport.id, req.user.id, body.scope_type, body.team_id ?? null, body.group_id ?? null, body.player_id ?? null,
           body.subject ?? null, body.body);
    const insertRecipient = db.prepare('INSERT OR IGNORE INTO message_recipients (message_id, player_id) VALUES (?,?)');
    for (const playerId of recipientIds) insertRecipient.run(info.lastInsertRowid, playerId);
    return info.lastInsertRowid;
  });

  audit(req, { action: 'create', entity: 'messages', entityId: messageId, summary: `Message sent to ${recipientIds.length} player(s)` });
  res.status(201).json({ message: db.prepare('SELECT * FROM messages WHERE id = ?').get(messageId), recipientCount: recipientIds.length });
}));

/** Messages sent by coaches/admins, most recent first. */
router.get('/sent', requireAuth, (req, res) => {
  const sport = requireCricketSport(req.query.sport || 'cricket');
  const rows = db
    .prepare(`SELECT m.*, u.full_name AS sender_name, t.name AS team_name, g.name AS group_name, p.display_name AS player_name,
                     (SELECT COUNT(*) FROM message_recipients r WHERE r.message_id = m.id) AS recipient_count,
                     (SELECT COUNT(*) FROM message_recipients r WHERE r.message_id = m.id AND r.read_at IS NOT NULL) AS read_count
              FROM messages m
              JOIN users u ON u.id = m.sender_id
              LEFT JOIN teams t ON t.id = m.team_id
              LEFT JOIN player_groups g ON g.id = m.group_id
              LEFT JOIN players p ON p.id = m.player_id
              WHERE m.sport_id = ? ORDER BY m.created_at DESC LIMIT 200`)
    .all(sport.id);
  res.json({ messages: rows });
});

/** The signed-in player/guardian's inbox. */
router.get('/inbox', requireAuth, (req, res) => {
  const linkedIds = req.user.linkedPlayerIds || [];
  if (!linkedIds.length) return res.json({ messages: [] });
  const placeholders = linkedIds.map(() => '?').join(',');
  const rows = db
    .prepare(`SELECT m.*, r.read_at, r.player_id AS recipient_player_id, u.full_name AS sender_name
              FROM message_recipients r
              JOIN messages m ON m.id = r.message_id
              JOIN users u ON u.id = m.sender_id
              WHERE r.player_id IN (${placeholders}) ORDER BY m.created_at DESC LIMIT 200`)
    .all(...linkedIds);
  res.json({ messages: rows });
});

router.post('/:id/read', requireAuth, asyncHandler(async (req, res) => {
  const linkedIds = req.user.linkedPlayerIds || [];
  const schema = z.object({ player_id: z.coerce.number().int().optional() });
  const { player_id } = schema.parse(req.body || {});
  const targetPlayerId = player_id ?? linkedIds[0];
  if (!targetPlayerId || !linkedIds.includes(targetPlayerId)) throw new ApiError(403, 'That is not your message.');
  db.prepare(`UPDATE message_recipients SET read_at = datetime('now') WHERE message_id = ? AND player_id = ? AND read_at IS NULL`)
    .run(req.params.id, targetPlayerId);
  res.json({ ok: true });
}));

module.exports = router;
