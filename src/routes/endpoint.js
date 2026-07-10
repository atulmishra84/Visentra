'use strict';

const express = require('express');
const { requireWriteAccess } = require('../middleware/auth');
const { logAudit } = require('../services/audit');
const { query } = require('../models/db');

const router = express.Router();

function stubScan(provider) {
  return async (req, res) => {
    const hits = [
      {
        host: 'demo-endpoint-01',
        process: provider === 'intune' ? 'ollama.exe' : 'python',
        detail: `${provider} demo hit — AI runtime detected`,
        risk: 'medium',
      },
    ];
    await query(
      `INSERT INTO activity_log (tenant_id, user_id, action, detail, severity)
       VALUES ($1,$2,$3,$4,'info')`,
      [req.tenantId, req.user.sub, `endpoint.scan.${provider}`, `Demo scan via ${provider}`]
    );
    await logAudit({
      tenantId: req.tenantId,
      actorId: req.user.sub,
      actorEmail: req.user.email,
      action: 'endpoint_scan',
      detail: { provider, hits: hits.length, demo: true },
    });
    res.json({ ok: true, provider, demo: true, hits });
  };
}

router.post('/scan/cortex', requireWriteAccess, stubScan('cortex'));
router.post('/scan/crowdstrike', requireWriteAccess, stubScan('crowdstrike'));
router.post('/scan/intune', requireWriteAccess, stubScan('intune'));

module.exports = router;
