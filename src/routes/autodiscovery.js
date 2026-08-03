'use strict';

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { query } = require('../models/db');
const { runDiscovery } = require('../services/discovery');
const { logAudit } = require('../services/audit');
const { requireWriteAccess } = require('../middleware/auth');

const router = express.Router();
const sessions = new Map(); // in-memory progress mirror

router.post('/start', requireWriteAccess, async (req, res) => {
  const sessionId = uuidv4();
  await query(
    `INSERT INTO autodiscovery_sessions (id, tenant_id, status, config, progress, started_by)
     VALUES ($1,$2,'running',$3,$4,$5)`,
    [
      sessionId,
      req.tenantId,
      JSON.stringify(req.body || {}),
      JSON.stringify({ percent: 5, stage: 'starting' }),
      req.user.sub,
    ]
  );
  sessions.set(sessionId, { percent: 5, stage: 'starting', agents_found: 0 });

  // Run discovery async
  setImmediate(async () => {
    try {
      sessions.set(sessionId, { percent: 40, stage: 'scanning', agents_found: 0 });
      await query(
        `UPDATE autodiscovery_sessions SET progress=$2 WHERE id=$1`,
        [sessionId, JSON.stringify({ percent: 40, stage: 'scanning' })]
      );
      const result = await runDiscovery(req.tenantId, {
        userId: req.user.sub,
        actorEmail: req.user.email,
      });
      sessions.set(sessionId, {
        percent: 100,
        stage: 'complete',
        agents_found: result.agents_found,
        demo: result.demo,
      });
      await query(
        `UPDATE autodiscovery_sessions SET status='complete', agents_found=$2, progress=$3, finished_at=NOW()
         WHERE id=$1`,
        [
          sessionId,
          result.agents_found,
          JSON.stringify({ percent: 100, stage: 'complete', agents_found: result.agents_found }),
        ]
      );
      await logAudit({
        tenantId: req.tenantId,
        actorId: req.user.sub,
        actorEmail: req.user.email,
        action: 'autodiscovery_complete',
        detail: { sessionId, agents_found: result.agents_found },
      });
    } catch (err) {
      sessions.set(sessionId, { percent: 100, stage: 'error', error: err.message });
      await query(
        `UPDATE autodiscovery_sessions SET status='error', error=$2, finished_at=NOW() WHERE id=$1`,
        [sessionId, err.message]
      );
    }
  });

  res.json({ sessionId, status: 'running' });
});

router.get('/status/:sessionId', async (req, res) => {
  const mem = sessions.get(req.params.sessionId);
  const db = await query(
    `SELECT * FROM autodiscovery_sessions WHERE id = $1 AND tenant_id = $2`,
    [req.params.sessionId, req.tenantId]
  );
  if (!db.rows[0] && !mem) return res.status(404).json({ error: 'Session not found' });
  const row = db.rows[0] || {};
  const progress = mem || row.progress || {};
  res.json({
    sessionId: req.params.sessionId,
    status: row.status || (progress.stage === 'complete' ? 'complete' : 'running'),
    progress,
    agents_found: row.agents_found || progress.agents_found || 0,
    error: row.error || progress.error || null,
  });
});

router.get('/history', async (req, res) => {
  const result = await query(
    `SELECT id, status, agents_found, started_at, finished_at, error
     FROM autodiscovery_sessions WHERE tenant_id = $1
     ORDER BY started_at DESC LIMIT 50`,
    [req.tenantId]
  );
  res.json(result.rows);
});

module.exports = router;
