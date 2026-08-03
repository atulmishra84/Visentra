'use strict';

const express = require('express');
const { query } = require('../models/db');
const { listAuditEvents } = require('../services/audit');
const { generateReport, toCsv } = require('../services/reports');
const { mapAgentToProd } = require('../services/agentMapper');
const { logAudit } = require('../services/audit');

const router = express.Router();

router.get('/export', async (req, res) => {
  const agents = await query(`SELECT * FROM agents WHERE tenant_id = $1`, [req.tenantId]);
  const payload = {
    exported_at: new Date().toISOString(),
    agents: agents.rows.map(mapAgentToProd),
  };
  await logAudit({
    tenantId: req.tenantId,
    actorId: req.user.sub,
    actorEmail: req.user.email,
    action: 'compliance_export',
    detail: { type: 'full_export', count: agents.rows.length },
  });
  res.json(payload);
});

router.get('/audit-log', async (req, res) => {
  const events = await listAuditEvents(req.tenantId, {
    limit: Math.min(parseInt(req.query.limit || '200', 10), 5000),
  });
  res.json(events);
});

router.get('/reports/compliance', async (req, res) => {
  const sinceDays = parseInt(req.query.days || '90', 10);
  const report = await generateReport(req.tenantId, { sinceDays });
  if (req.query.format === 'csv') {
    res.setHeader('Content-Type', 'text/csv');
    return res.send(toCsv(report));
  }
  res.json({ report });
});

module.exports = router;
