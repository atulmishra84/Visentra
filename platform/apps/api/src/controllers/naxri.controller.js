import { pool } from "../db/postgres.js";
import { writeAudit } from "../services/audit.js";
import { publicErrorMessage } from "../utils/http.js";
import {
  getNaxriIntegration,
  upsertNaxriIntegration,
  buildAgentFeed,
  pushAgentsToNaxri,
  testNaxriConnection
} from "../services/naxriFeed.js";

export async function getConfig(req, res) {
  try {
    const integration = await getNaxriIntegration(pool, req.tenantId);
    res.json({ integration: integration || null });
  } catch (err) {
    res.status(500).json({ error: { message: publicErrorMessage(err, "Unable to load NAXRI config") } });
  }
}

export async function putConfig(req, res) {
  try {
    const integration = await upsertNaxriIntegration(pool, req.tenantId, req.body || {});
    await writeAudit(pool, {
      tenantId: req.tenantId,
      actorId: req.user.sub,
      actorEmail: req.user.email,
      action: "integration.naxri.upsert",
      resourceType: "outbound_integration",
      resourceId: integration.id,
      details: {
        enabled: integration.enabled,
        autoPush: integration.autoPush,
        webhookHost: integration.webhookUrl ? new URL(integration.webhookUrl).host : null
      },
      ip: req.ip
    });
    res.json({ integration });
  } catch (err) {
    res.status(err.status || 400).json({
      error: { message: publicErrorMessage(err, "Unable to save NAXRI config") }
    });
  }
}

export async function getFeed(req, res) {
  try {
    const since = req.query.since ? String(req.query.since) : null;
    const limit = Number(req.query.limit) || 5000;
    const feed = await buildAgentFeed(pool, req.tenantId, { since, limit });
    res.json(feed);
  } catch (err) {
    res.status(500).json({ error: { message: publicErrorMessage(err, "Unable to build agent feed") } });
  }
}

export async function syncNow(req, res) {
  try {
    const since = req.body?.since ? String(req.body.since) : null;
    const result = await pushAgentsToNaxri(pool, req.tenantId, { since });
    await writeAudit(pool, {
      tenantId: req.tenantId,
      actorId: req.user.sub,
      actorEmail: req.user.email,
      action: "integration.naxri.sync",
      resourceType: "outbound_integration",
      details: { agentCount: result.agentCount, status: result.status },
      ip: req.ip
    });
    res.json({
      ok: true,
      agentCount: result.agentCount,
      status: result.status,
      feed: { agent_count: result.feed.agent_count, generated_at: result.feed.generated_at }
    });
  } catch (err) {
    res.status(err.status || 500).json({
      error: { message: publicErrorMessage(err, "NAXRI sync failed") }
    });
  }
}

export async function testConnection(req, res) {
  try {
    const result = await testNaxriConnection(pool, req.tenantId);
    res.json(result);
  } catch (err) {
    res.status(err.status || 500).json({
      error: { message: publicErrorMessage(err, "NAXRI connection test failed") }
    });
  }
}
