'use strict';

const express = require('express');
const { query } = require('../models/db');
const { requireWriteAccess } = require('../middleware/auth');
const { logAudit } = require('../services/audit');

const router = express.Router();

// Policies
router.get('/policies', async (req, res) => {
  const result = await query(
    `SELECT * FROM policies WHERE tenant_id = $1 ORDER BY created_at`,
    [req.tenantId]
  );
  res.json(result.rows);
});

router.post('/policies', requireWriteAccess, async (req, res) => {
  const name = String(req.body.name || '').trim();
  const condition = String(req.body.condition || '').trim();
  if (!name || !condition) return res.status(400).json({ error: 'name and condition required' });
  const result = await query(
    `INSERT INTO policies (tenant_id, name, condition, action, description)
     VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [
      req.tenantId,
      name,
      condition,
      req.body.action || 'alert',
      req.body.description || null,
    ]
  );
  res.status(201).json(result.rows[0]);
});

router.get('/policy-violations', async (req, res) => {
  const result = await query(
    `SELECT * FROM policy_violations WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 200`,
    [req.tenantId]
  );
  res.json(result.rows);
});

// Approvals
router.get('/approvals', async (req, res) => {
  const result = await query(
    `SELECT * FROM approvals WHERE tenant_id = $1 ORDER BY created_at DESC`,
    [req.tenantId]
  );
  res.json(result.rows);
});

router.post('/approvals', requireWriteAccess, async (req, res) => {
  const title = String(req.body.title || '').trim();
  if (!title) return res.status(400).json({ error: 'title required' });
  const result = await query(
    `INSERT INTO approvals (tenant_id, agent_id, title, requested_by, notes)
     VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [req.tenantId, req.body.agent_id || null, title, req.user.sub, req.body.notes || null]
  );
  res.status(201).json(result.rows[0]);
});

router.patch('/approvals/:id', requireWriteAccess, async (req, res) => {
  const status = req.body.status;
  if (!['approved', 'rejected', 'pending'].includes(status)) {
    return res.status(400).json({ error: 'invalid status' });
  }
  const result = await query(
    `UPDATE approvals SET status=$3, decided_by=$4, decided_at=NOW(), notes=COALESCE($5, notes)
     WHERE id=$1 AND tenant_id=$2 RETURNING *`,
    [req.params.id, req.tenantId, status, req.user.sub, req.body.notes || null]
  );
  if (!result.rows[0]) return res.status(404).json({ error: 'Not found' });
  await logAudit({
    tenantId: req.tenantId,
    actorId: req.user.sub,
    actorEmail: req.user.email,
    action: 'approval_decision',
    detail: { id: req.params.id, status },
  });
  res.json(result.rows[0]);
});

// Playbooks
router.get('/playbooks', async (req, res) => {
  const result = await query(
    `SELECT * FROM playbooks WHERE tenant_id = $1 ORDER BY name`,
    [req.tenantId]
  );
  res.json(result.rows);
});

router.post('/playbooks/:id/run', requireWriteAccess, async (req, res) => {
  const pb = await query(`SELECT * FROM playbooks WHERE id = $1 AND tenant_id = $2`, [
    req.params.id,
    req.tenantId,
  ]);
  if (!pb.rows[0]) return res.status(404).json({ error: 'Playbook not found' });
  const run = await query(
    `INSERT INTO playbook_runs (tenant_id, playbook_id, agent_id, status, result, started_by, finished_at)
     VALUES ($1,$2,$3,'complete',$4,$5,NOW()) RETURNING *`,
    [
      req.tenantId,
      req.params.id,
      req.body.agent_id || null,
      JSON.stringify({ steps_completed: (pb.rows[0].steps || []).length || 0 }),
      req.user.sub,
    ]
  );
  res.status(201).json(run.rows[0]);
});

module.exports = router;
