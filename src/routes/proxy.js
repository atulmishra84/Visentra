'use strict';

const express = require('express');
const { requireWriteAccess } = require('../middleware/auth');
const { logAudit } = require('../services/audit');
const { query } = require('../models/db');

const router = express.Router();

const AI_DOMAINS = [
  'api.openai.com',
  'api.anthropic.com',
  'api.cohere.ai',
  'api.groq.com',
  'generativelanguage.googleapis.com',
];

router.get('/domains', (_req, res) => {
  res.json({ domains: AI_DOMAINS });
});

router.get('/config/:type', (req, res) => {
  const type = req.params.type;
  if (type === 'zscaler') {
    return res.json({
      type: 'zscaler',
      blocklist: AI_DOMAINS,
      sample_policy: 'Block unsanctioned generative AI destinations',
    });
  }
  res.json({ type, domains: AI_DOMAINS });
});

router.post('/ingest', requireWriteAccess, async (req, res) => {
  const events = Array.isArray(req.body) ? req.body : req.body.events || [req.body];
  await query(
    `INSERT INTO activity_log (tenant_id, user_id, action, detail, severity)
     VALUES ($1,$2,'proxy.ingest',$3,'info')`,
    [req.tenantId, req.user.sub, `Ingested ${events.length} proxy events`]
  );
  await logAudit({
    tenantId: req.tenantId,
    actorId: req.user.sub,
    actorEmail: req.user.email,
    action: 'proxy_ingest',
    detail: { count: events.length },
  });
  res.json({ ok: true, ingested: events.length });
});

module.exports = router;
