'use strict';

const express = require('express');
const { query } = require('../models/db');
const { requireWriteAccess } = require('../middleware/auth');
const { logAudit } = require('../services/audit');

const router = express.Router();

router.get('/', async (req, res) => {
  const result = await query(
    `SELECT * FROM risk_acceptances WHERE tenant_id = $1 ORDER BY created_at DESC`,
    [req.tenantId]
  );
  res.json(result.rows);
});

router.post('/', requireWriteAccess, async (req, res) => {
  const justification = String(req.body.justification || '').trim();
  if (!justification) return res.status(400).json({ error: 'justification required' });
  const result = await query(
    `INSERT INTO risk_acceptances (tenant_id, agent_id, framework, justification, expires_at, accepted_by)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [
      req.tenantId,
      req.body.agent_id || null,
      req.body.framework || null,
      justification,
      req.body.expires_at || null,
      req.user.sub,
    ]
  );
  await logAudit({
    tenantId: req.tenantId,
    actorId: req.user.sub,
    actorEmail: req.user.email,
    action: 'risk_accepted',
    detail: { id: result.rows[0].id, agent_id: req.body.agent_id },
  });
  res.status(201).json(result.rows[0]);
});

module.exports = router;
