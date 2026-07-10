'use strict';

const express = require('express');
const { query } = require('../models/db');
const { mapAgentToProd } = require('../services/agentMapper');

const router = express.Router();

router.get('/:agentId', async (req, res) => {
  const agent = await query(`SELECT * FROM agents WHERE id = $1 AND tenant_id = $2`, [
    req.params.agentId,
    req.tenantId,
  ]);
  if (!agent.rows[0]) return res.status(404).json({ error: 'Agent not found' });

  let results = await query(
    `SELECT * FROM compliance_results WHERE agent_id = $1 AND tenant_id = $2 ORDER BY framework`,
    [req.params.agentId, req.tenantId]
  );

  if (!results.rows.length) {
    const mapped = mapAgentToProd(agent.rows[0]);
    const controls = mapped.controls || {};
    const rows = [];
    for (const [framework, status] of Object.entries(controls)) {
      const inserted = await query(
        `INSERT INTO compliance_results (tenant_id, agent_id, framework, status, score)
         VALUES ($1,$2,$3,$4,$5) RETURNING *`,
        [
          req.tenantId,
          req.params.agentId,
          framework,
          status,
          status === 'pass' ? 90 : status === 'warn' ? 60 : status === 'fail' ? 30 : null,
        ]
      );
      rows.push(inserted.rows[0]);
    }
    results = { rows };
  }
  res.json(results.rows);
});

module.exports = router;
