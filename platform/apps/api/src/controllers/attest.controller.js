import { pool } from "../db/postgres.js";
import { writeAudit } from "../services/audit.js";
import { publicErrorMessage } from "../utils/http.js";
import {
  buildAttestFeed,
  getAttestIntegration,
  pushFeedToAttest,
  testAttestConnection,
  upsertAttestIntegration
} from "../services/attestDecisions.js";

export async function getConfig(req, res) {
  try {
    const integration = await getAttestIntegration(pool, req.tenantId);
    res.json({ integration: integration || null });
  } catch (err) {
    res.status(500).json({ error: { message: publicErrorMessage(err, "Unable to load Attest config") } });
  }
}

export async function putConfig(req, res) {
  try {
    const integration = await upsertAttestIntegration(pool, req.tenantId, req.body || {});
    await writeAudit(pool, {
      tenantId: req.tenantId,
      actorId: req.user.sub,
      actorEmail: req.user.email,
      action: "integration.attest.upsert",
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
      error: { message: publicErrorMessage(err, "Unable to save Attest config") }
    });
  }
}

export async function getFeed(req, res) {
  try {
    const feed = await buildAttestFeed(pool, req.tenantId);
    res.json({
      agent_count: feed.agents.length,
      decision_count: feed.requests.length,
      agents: feed.agents,
      decisions: feed.requests
    });
  } catch (err) {
    res.status(500).json({ error: { message: publicErrorMessage(err, "Unable to build Attest feed") } });
  }
}

export async function syncNow(req, res) {
  try {
    const result = await pushFeedToAttest(pool, req.tenantId);
    await writeAudit(pool, {
      tenantId: req.tenantId,
      actorId: req.user.sub,
      actorEmail: req.user.email,
      action: "integration.attest.sync",
      resourceType: "outbound_integration",
      details: { agentCount: result.agentCount, decisionCount: result.decisionCount, ok: result.ok },
      ip: req.ip
    });
    res.json(result);
  } catch (err) {
    res.status(err.status || 500).json({
      error: { message: publicErrorMessage(err, "Attest sync failed") }
    });
  }
}

export async function testConnection(req, res) {
  try {
    const result = await testAttestConnection(pool, req.tenantId);
    res.json(result);
  } catch (err) {
    res.status(err.status || 500).json({
      error: { message: publicErrorMessage(err, "Attest connection test failed") }
    });
  }
}
