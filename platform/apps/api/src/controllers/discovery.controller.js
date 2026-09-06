import { pool } from "../db/postgres.js";
import { neo4jDriver } from "../db/neo4j.js";
import { broadcast } from "../lib/sseManager.js";
import { claimDiscoveryJob, executeDiscoveryJob } from "../discovery/pipeline.js";
import { computeDiscoveryChanges } from "../services/agentDepth.js";
import { writeAudit } from "../services/audit.js";
import { publicErrorMessage } from "../utils/http.js";
import { IS_PROD, sanitizeCollectors } from "../config.js";
import { DEFAULT_COLLECTORS, PRODUCTION_COLLECTORS, ALL_COLLECTOR_IDS } from "../discovery/collectors.js";

const COLLECTOR_IDS = IS_PROD ? PRODUCTION_COLLECTORS : DEFAULT_COLLECTORS;

export async function changes(req, res) {
  try {
    const payload = await computeDiscoveryChanges(pool, req.tenantId, {
      sinceHours: req.query.sinceHours || req.query.hours || 168,
      agentId: req.query.agentId || null,
      limit: Number(req.query.limit) || 100
    });
    res.json(payload);
  } catch (err) {
    res.status(500).json({ error: { message: publicErrorMessage(err, "Discovery changes query failed") } });
  }
}

export async function jobs(req, res) {
  const result = await pool.query(
    `SELECT * FROM discovery_jobs WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 50`,
    [req.tenantId]
  );
  res.json({ jobs: result.rows, items: result.rows, collectors: COLLECTOR_IDS });
}

export async function createJob(req, res) {
  const collectors = sanitizeCollectors(req.body?.collectors, ALL_COLLECTOR_IDS, COLLECTOR_IDS);
  let job;
  try {
    job = await claimDiscoveryJob(pool, {
      tenantId: req.tenantId,
      collectorIds: collectors,
      triggeredBy: req.user.email
    });
  } catch (err) {
    if (err.status === 409) {
      return res.status(409).json({
        error: { message: err.message },
        jobId: err.jobId
      });
    }
    return res.status(500).json({
      error: { message: publicErrorMessage(err, "Failed to start discovery job") }
    });
  }
  res.status(202).json({
    accepted: true,
    message: "Discovery job started",
    jobId: job.id,
    collectors: job.collector_ids || collectors
  });
  writeAudit(pool, {
    tenantId: req.tenantId,
    actorId: req.user.sub,
    actorEmail: req.user.email,
    action: "discovery.job.start",
    resourceType: "discovery_job",
    resourceId: job.id,
    details: { collectors: job.collector_ids || collectors },
    ip: req.ip
  }).catch(() => {});
  executeDiscoveryJob(pool, neo4jDriver, job, {
    tenantId: req.tenantId,
    triggeredBy: req.user.email,
    broadcast
  }).catch((err) => console.error("Discovery job failed:", err));
}

export async function events(req, res) {
  const result = await pool.query(
    `SELECT * FROM discovery_events WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 100`,
    [req.tenantId]
  );
  res.json({ events: result.rows, items: result.rows });
}
