import { pool } from "../db/postgres.js";
import { writeAudit } from "../services/audit.js";
import { publicErrorMessage } from "../utils/http.js";
import {
  PROVIDER_FIELDS,
  listConnectors,
  createConnector,
  getConnector,
  updateConnector,
  deleteConnector,
  testConnector
} from "../services/connectors.js";

export function schema(req, res) {
  res.json({ providers: PROVIDER_FIELDS });
}

export async function list(req, res) {
  const items = await listConnectors(pool, req.tenantId);
  res.json({ connectors: items, items });
}

export async function create(req, res) {
  try {
    const connector = await createConnector(pool, req.tenantId, req.body || {}, req.user.email);
    await pool.query(
      `INSERT INTO discovery_events (tenant_id, event_type, severity, message, payload)
       VALUES ($1,'connector.created','info',$2,$3::jsonb)`,
      [
        req.tenantId,
        `Connector created: ${connector.name}`,
        JSON.stringify({ connectorId: connector.id, provider: connector.provider })
      ]
    );
    await writeAudit(pool, {
      tenantId: req.tenantId,
      actorId: req.user.sub,
      actorEmail: req.user.email,
      action: "connector.create",
      resourceType: "connector",
      resourceId: connector.id,
      details: { provider: connector.provider, name: connector.name },
      ip: req.ip
    });
    res.status(201).json({ connector });
  } catch (err) {
    res.status(err.status || 500).json({
      error: { message: publicErrorMessage(err, "Unable to create connector") }
    });
  }
}

export async function getById(req, res) {
  const connector = await getConnector(pool, req.tenantId, req.params.id);
  if (!connector) return res.status(404).json({ error: { message: "Connector not found" } });
  res.json({ connector });
}

export async function update(req, res) {
  try {
    const connector = await updateConnector(pool, req.tenantId, req.params.id, req.body || {});
    if (!connector) return res.status(404).json({ error: { message: "Connector not found" } });
    await writeAudit(pool, {
      tenantId: req.tenantId,
      actorId: req.user.sub,
      actorEmail: req.user.email,
      action: "connector.update",
      resourceType: "connector",
      resourceId: connector.id,
      details: { provider: connector.provider, name: connector.name },
      ip: req.ip
    });
    res.json({ connector });
  } catch (err) {
    res.status(err.status || 500).json({
      error: { message: publicErrorMessage(err, "Unable to update connector") }
    });
  }
}

export async function remove(req, res) {
  const existing = await getConnector(pool, req.tenantId, req.params.id);
  const ok = await deleteConnector(pool, req.tenantId, req.params.id);
  if (!ok) return res.status(404).json({ error: { message: "Connector not found" } });
  await writeAudit(pool, {
    tenantId: req.tenantId,
    actorId: req.user.sub,
    actorEmail: req.user.email,
    action: "connector.delete",
    resourceType: "connector",
    resourceId: req.params.id,
    details: { name: existing?.name, provider: existing?.provider },
    ip: req.ip
  });
  res.status(204).end();
}

export async function test(req, res) {
  const result = await testConnector(pool, req.tenantId, req.params.id);
  if (!result) return res.status(404).json({ error: { message: "Connector not found" } });
  await writeAudit(pool, {
    tenantId: req.tenantId,
    actorId: req.user.sub,
    actorEmail: req.user.email,
    action: "connector.test",
    resourceType: "connector",
    resourceId: req.params.id,
    details: { ok: result.ok, message: result.message },
    ip: req.ip
  });
  res.json(result);
}
