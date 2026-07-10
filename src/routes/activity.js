'use strict';

const express = require('express');
const { query } = require('../models/db');
const { logAudit } = require('../services/audit');

const router = express.Router();

router.get('/', async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit || '100', 10), 500);
  const result = await query(
    `SELECT id, action, detail, agent_id, severity, created_at, user_id
     FROM activity_log WHERE tenant_id = $1
     ORDER BY created_at DESC LIMIT $2`,
    [req.tenantId, limit]
  );
  res.json(result.rows);
});

router.post('/', async (req, res) => {
  const action = String(req.body.action || 'event');
  const detail = String(req.body.detail || '');
  const agentId = req.body.agent_id || null;
  const severity = req.body.severity || 'info';
  const result = await query(
    `INSERT INTO activity_log (tenant_id, user_id, action, detail, agent_id, severity, ip_address, user_agent)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [
      req.tenantId,
      req.user.sub,
      action,
      detail,
      agentId,
      severity,
      req.ip,
      req.get('user-agent'),
    ]
  );
  await logAudit({
    tenantId: req.tenantId,
    actorId: req.user.sub,
    actorEmail: req.user.email,
    action: 'activity',
    detail: { action, detail, agentId },
    ipAddress: req.ip,
    userAgent: req.get('user-agent'),
  });
  res.status(201).json(result.rows[0]);
});

module.exports = router;
