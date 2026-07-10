'use strict';

const { query } = require('../models/db');
const { forwardToLogAnalytics } = require('./siem');

/**
 * Module 6 — Audit Logging & Evidence Generation
 * Writes to PostgreSQL and forwards to Azure Monitor (Module 7).
 */
async function logAudit({
  tenantId = null,
  actorId = null,
  actorEmail = null,
  action,
  detail = {},
  ipAddress = null,
  userAgent = null,
}) {
  const result = await query(
    `INSERT INTO audit_events (tenant_id, actor_id, actor_email, action, detail, ip_address, user_agent)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id, created_at`,
    [tenantId, actorId, actorEmail, action, JSON.stringify(detail), ipAddress, userAgent]
  );
  const event = {
    id: result.rows[0].id,
    tenant_id: tenantId,
    actor_id: actorId,
    actor_email: actorEmail,
    action,
    detail,
    ip_address: ipAddress,
    TimeGenerated: result.rows[0].created_at,
  };
  // Fail-soft SIEM forward
  forwardToLogAnalytics(event).catch((err) => {
    console.warn('SIEM forward failed:', err.message);
  });
  return event;
}

async function listAuditEvents(tenantId, { limit = 100, offset = 0, action } = {}) {
  const params = [tenantId];
  let sql = `SELECT * FROM audit_events WHERE tenant_id = $1`;
  if (action) {
    params.push(action);
    sql += ` AND action = $${params.length}`;
  }
  params.push(limit, offset);
  sql += ` ORDER BY created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`;
  const result = await query(sql, params);
  return result.rows;
}

module.exports = { logAudit, listAuditEvents };
