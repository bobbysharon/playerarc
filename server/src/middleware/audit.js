'use strict';
const { db } = require('../db');

const insert = db.prepare(`
  INSERT INTO audit_logs (user_id, user_email, action, entity, entity_id, summary, before_json, after_json, ip, user_agent)
  VALUES (@user_id, @user_email, @action, @entity, @entity_id, @summary, @before_json, @after_json, @ip, @user_agent)
`);

/** Record a mutation. Audit failures never break the request. */
function audit(req, { action, entity, entityId = null, summary = null, before = null, after = null }) {
  try {
    insert.run({
      user_id: req.user ? req.user.id : null,
      user_email: req.user ? req.user.email : null,
      action,
      entity,
      entity_id: entityId,
      summary,
      before_json: before ? JSON.stringify(before) : null,
      after_json: after ? JSON.stringify(after) : null,
      ip: req.ip || null,
      user_agent: req.headers['user-agent'] || null,
    });
  } catch (err) {
    console.error('[audit] failed to record entry:', err.message);
  }
}

module.exports = { audit };
