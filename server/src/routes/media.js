'use strict';
const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const { z } = require('zod');
const { db } = require('../db');
const config = require('../config');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { audit } = require('../middleware/audit');
const { asyncHandler, ApiError } = require('../middleware/error');
const { canAccessPlayer } = require('../middleware/scope');
const { can } = require('../lib/permissions');

const router = express.Router();

fs.mkdirSync(config.uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, config.uploadDir),
  filename: (req, file, cb) => {
    const safe = file.originalname.replace(/[^A-Za-z0-9._-]/g, '_').slice(-60);
    cb(null, `${Date.now()}-${crypto.randomBytes(4).toString('hex')}-${safe}`);
  },
});

const ALLOWED = new Set([
  'image/jpeg', 'image/png', 'image/webp', 'image/gif',
  'video/mp4', 'video/quicktime', 'video/webm',
  'application/pdf',
]);

const upload = multer({
  storage,
  limits: { fileSize: config.maxUploadMb * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED.has(file.mimetype)) {
      return cb(new ApiError(415, `${file.mimetype} files are not accepted. Upload an image, video or PDF.`));
    }
    return cb(null, true);
  },
});

/* ---- Media ---------------------------------------------------------- */
router.get('/', requireAuth, (req, res) => {
  const where = ['1 = 1'];
  const params = [];
  if (req.query.player) { where.push('(m.player_id = ? OR (m.owner_type = \'player\' AND m.owner_id = ?))'); params.push(Number(req.query.player), Number(req.query.player)); }
  if (req.query.ownerType) { where.push('m.owner_type = ?'); params.push(req.query.ownerType); }
  if (req.query.ownerId) { where.push('m.owner_id = ?'); params.push(Number(req.query.ownerId)); }
  if (req.query.kind) { where.push('m.kind = ?'); params.push(req.query.kind); }

  let rows = db.prepare(`SELECT m.* FROM media m WHERE ${where.join(' AND ')} ORDER BY m.created_at DESC LIMIT 200`).all(...params);
  if (!can(req.user, 'media.approve')) rows = rows.filter((m) => m.visibility !== 'private' || m.uploaded_by === req.user.id);
  res.json({ media: rows });
});

router.post('/', requirePermission('media.write'), upload.single('file'), asyncHandler(async (req, res) => {
  const schema = z.object({
    owner_type: z.enum(['player', 'match', 'tournament', 'training', 'achievement', 'team']),
    owner_id: z.coerce.number().int(),
    player_id: z.coerce.number().int().optional().nullable(),
    kind: z.enum(['photo', 'video', 'highlight', 'certificate', 'document', 'link']).default('photo'),
    title: z.string().min(1),
    description: z.string().optional().nullable(),
    external_url: z.string().url().optional().nullable(),
    visibility: z.enum(['public', 'club', 'staff', 'private']).default('club'),
  });
  const body = schema.parse(req.body);
  if (!req.file && !body.external_url) throw new ApiError(422, 'Attach a file or provide a link.');
  if (body.player_id && !canAccessPlayer(req.user, body.player_id)) {
    throw new ApiError(403, 'That athlete is outside your assigned teams.');
  }

  const info = db
    .prepare(`INSERT INTO media (owner_type, owner_id, player_id, kind, title, description, file_path, external_url, mime, size_bytes, visibility, is_approved, uploaded_by)
              VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(body.owner_type, body.owner_id, body.player_id ?? (body.owner_type === 'player' ? body.owner_id : null),
         body.kind, body.title, body.description ?? null,
         req.file ? path.basename(req.file.path) : null, body.external_url ?? null,
         req.file ? req.file.mimetype : null, req.file ? req.file.size : null,
         body.visibility, can(req.user, 'media.approve') ? 1 : 0, req.user.id);

  audit(req, { action: 'create', entity: 'media', entityId: info.lastInsertRowid, summary: `Media uploaded: ${body.title}` });
  res.status(201).json({ media: db.prepare('SELECT * FROM media WHERE id = ?').get(info.lastInsertRowid) });
}));

router.put('/:id/approve', requirePermission('media.approve'), asyncHandler(async (req, res) => {
  const row = db.prepare('SELECT * FROM media WHERE id = ?').get(req.params.id);
  if (!row) throw new ApiError(404, 'That media item does not exist.');
  db.prepare('UPDATE media SET is_approved = ? WHERE id = ?').run(req.body.approved === false ? 0 : 1, row.id);
  audit(req, { action: 'update', entity: 'media', entityId: row.id, summary: `Media ${req.body.approved === false ? 'unapproved' : 'approved'}: ${row.title}` });
  res.json({ ok: true });
}));

/** Files are streamed through the API so permissions apply to downloads too. */
router.get('/:id/file', requireAuth, asyncHandler(async (req, res) => {
  const row = db.prepare('SELECT * FROM media WHERE id = ?').get(req.params.id);
  if (!row || !row.file_path) throw new ApiError(404, 'That file is not available.');
  if (row.visibility === 'private' && !can(req.user, 'media.approve') && row.uploaded_by !== req.user.id) {
    throw new ApiError(403, 'That file is private.');
  }
  if (row.player_id && !canAccessPlayer(req.user, row.player_id)) throw new ApiError(403, 'That file belongs to an athlete outside your teams.');
  const full = path.join(config.uploadDir, path.basename(row.file_path));
  if (!fs.existsSync(full)) throw new ApiError(404, 'The stored file is missing from the server.');
  audit(req, { action: 'download', entity: 'media', entityId: row.id, summary: `File downloaded: ${row.title}` });
  res.sendFile(full);
}));

router.delete('/:id', requirePermission('media.write'), asyncHandler(async (req, res) => {
  const row = db.prepare('SELECT * FROM media WHERE id = ?').get(req.params.id);
  if (!row) throw new ApiError(404, 'That media item does not exist.');
  if (row.uploaded_by !== req.user.id && !can(req.user, 'media.approve')) throw new ApiError(403, 'You can only remove media you uploaded.');
  db.prepare('DELETE FROM media WHERE id = ?').run(row.id);
  if (row.file_path) {
    const full = path.join(config.uploadDir, path.basename(row.file_path));
    if (fs.existsSync(full)) fs.unlinkSync(full);
  }
  audit(req, { action: 'delete', entity: 'media', entityId: row.id, summary: `Media removed: ${row.title}` });
  res.json({ ok: true });
}));

/* ---- Player documents (always restricted) ---------------------------- */
router.get('/documents/:playerId', requirePermission('documents.read'), (req, res) => {
  if (!canAccessPlayer(req.user, Number(req.params.playerId))) throw new ApiError(403, 'That athlete is outside your assigned teams.');
  const documents = db.prepare('SELECT * FROM documents WHERE player_id = ? ORDER BY created_at DESC').all(req.params.playerId);
  res.json({ documents });
});

router.post('/documents', requirePermission('documents.write'), upload.single('file'), asyncHandler(async (req, res) => {
  const schema = z.object({
    player_id: z.coerce.number().int(),
    doc_type: z.enum(['registration', 'identification', 'birth_certificate', 'medical', 'consent', 'certificate', 'photo_id', 'other']),
    title: z.string().min(1),
    issue_date: z.string().optional().nullable(),
    expiry_date: z.string().optional().nullable(),
    visibility: z.enum(['club', 'staff', 'private']).default('staff'),
  });
  const body = schema.parse(req.body);
  if (!req.file) throw new ApiError(422, 'Attach the document file.');
  if (body.expiry_date && body.issue_date && body.expiry_date < body.issue_date) {
    throw new ApiError(422, 'The expiry date cannot be before the issue date.');
  }
  const info = db
    .prepare(`INSERT INTO documents (player_id, doc_type, title, file_path, mime, size_bytes, issue_date, expiry_date, visibility, uploaded_by)
              VALUES (?,?,?,?,?,?,?,?,?,?)`)
    .run(body.player_id, body.doc_type, body.title, path.basename(req.file.path), req.file.mimetype, req.file.size,
         body.issue_date ?? null, body.expiry_date ?? null, body.visibility, req.user.id);
  audit(req, { action: 'create', entity: 'documents', entityId: info.lastInsertRowid, summary: `Document uploaded for athlete #${body.player_id}: ${body.title}` });
  res.status(201).json({ ok: true });
}));

router.get('/documents/:id/file', requirePermission('documents.read'), asyncHandler(async (req, res) => {
  const row = db.prepare('SELECT * FROM documents WHERE id = ?').get(req.params.id);
  if (!row) throw new ApiError(404, 'That document is not available.');
  if (!canAccessPlayer(req.user, row.player_id)) throw new ApiError(403, 'That document belongs to an athlete outside your teams.');
  const full = path.join(config.uploadDir, path.basename(row.file_path));
  if (!fs.existsSync(full)) throw new ApiError(404, 'The stored file is missing from the server.');
  audit(req, { action: 'download', entity: 'documents', entityId: row.id, summary: `Document downloaded: ${row.title}` });
  res.sendFile(full);
}));

module.exports = router;
