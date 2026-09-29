import { createHash } from "crypto";
import {
  ASSURANCE_CONTROLS,
  detectDrift,
  evaluateControl,
  getAssuranceControl,
  permissionFingerprint,
  postureFromSnapshot
} from "./effectiveness.js";

const SAMPLE_MAX = 80;

function httpError(message, status = 400) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function boolMap(input) {
  const source = asObject(input);
  const coverage = {};
  for (const key of ["authorization", "database", "api", "runtime"]) {
    if (source[key] === true) coverage[key] = true;
    else if (source[key] === false) coverage[key] = false;
  }
  return coverage;
}

export function sanitizeRuntimeEvent(input) {
  const row = asObject(input);
  const sample = String(row.redactedSample || row.redacted_sample || "").slice(0, SAMPLE_MAX);
  const leaked = /\b\d{3}-\d{2}-\d{4}\b|social security|diagnosis text|patient note/i.test(sample);
  return {
    occurredAt: row.occurredAt || row.occurred_at || new Date().toISOString(),
    source: String(row.source || "operator").slice(0, 80),
    action: String(row.action || "").slice(0, 40),
    operation: String(row.operation || row.action || "").slice(0, 40),
    resource: String(row.resource || "").slice(0, 240),
    kind: String(row.kind || "").slice(0, 40),
    dataClass: String(row.dataClass || row.data_class || "none").slice(0, 32).toLowerCase(),
    decision: String(row.decision || "allowed").slice(0, 32).toLowerCase(),
    identity: row.identity ? String(row.identity).slice(0, 160) : null,
    destructive: row.destructive === true,
    fieldNames: Array.isArray(row.fieldNames) ? row.fieldNames.map((name) => String(name).slice(0, 80)).slice(0, 20) : [],
    contentHash: row.contentHash ? String(row.contentHash).slice(0, 128) : null,
    redactedSample: leaked ? null : sample || null
  };
}

export function sanitizeCapabilities(input) {
  if (!Array.isArray(input)) return [];
  return input.slice(0, 100).map((row) => {
    const item = asObject(row);
    return {
      kind: String(item.kind || "role").slice(0, 40),
      operation: String(item.operation || "").slice(0, 40),
      resource: String(item.resource || "").slice(0, 240),
      dataClass: item.dataClass ? String(item.dataClass).slice(0, 32).toLowerCase() : null,
      allowed: item.allowed !== false,
      destructive: item.destructive === true
    };
  });
}

export function sanitizeChain(input) {
  if (!Array.isArray(input)) return [];
  return input.slice(0, 20).map((row) => {
    const item = asObject(row);
    return {
      step: String(item.step || item.kind || "step").slice(0, 40),
      name: String(item.name || "").slice(0, 160)
    };
  });
}

async function requireAgent(pool, tenantId, agentId) {
  const res = await pool.query(`SELECT id, name, tools, mcp_connections FROM agents WHERE tenant_id=$1 AND id=$2`, [
    tenantId,
    agentId
  ]);
  if (!res.rows[0]) throw httpError("Agent not found", 404);
  return res.rows[0];
}

function countsFrom(tools, mcp) {
  return {
    toolCount: Array.isArray(tools) ? tools.length : 0,
    mcpCount: Array.isArray(mcp) ? mcp.length : 0
  };
}

export async function assuranceSummary(pool, tenantId) {
  const agents = await pool.query(
    `SELECT a.id, a.name, a.model, a.provider, a.cloud_provider, a.category,
            COALESCE(json_agg(DISTINCT s.control_id) FILTER (WHERE s.control_id IS NOT NULL), '[]'::json) AS controls
     FROM agents a
     LEFT JOIN assurance_assignments s ON s.tenant_id=a.tenant_id AND s.agent_id=a.id
     WHERE a.tenant_id=$1
     GROUP BY a.id
     ORDER BY a.last_seen DESC
     LIMIT 200`,
    [tenantId]
  );
  const evaluations = await pool.query(
    `SELECT DISTINCT ON (agent_id, control_id) agent_id, control_id, status, evaluated_at
     FROM control_evaluations
     WHERE tenant_id=$1
     ORDER BY agent_id, control_id, evaluated_at DESC`,
    [tenantId]
  );
  const drift = await pool.query(
    `SELECT DISTINCT ON (agent_id) agent_id, severity, detected_at
     FROM assurance_drift
     WHERE tenant_id=$1
     ORDER BY agent_id, detected_at DESC`,
    [tenantId]
  );
  const byAgent = new Map();
  for (const row of evaluations.rows) {
    const bucket = byAgent.get(row.agent_id) || {};
    bucket[row.status] = (bucket[row.status] || 0) + 1;
    byAgent.set(row.agent_id, bucket);
  }
  const driftByAgent = new Map(drift.rows.map((row) => [row.agent_id, row]));
  return {
    controls: ASSURANCE_CONTROLS,
    agents: agents.rows.map((agent) => ({
      id: agent.id,
      name: agent.name,
      model: agent.model,
      provider: agent.provider || agent.cloud_provider,
      category: agent.category,
      assigned: agent.controls || [],
      results: byAgent.get(agent.id) || {},
      drift: driftByAgent.get(agent.id) || null
    }))
  };
}

export async function getAgentAssurance(pool, tenantId, agentId) {
  const agent = await requireAgent(pool, tenantId, agentId);
  const [assignments, snapshot, events, evaluations, baseline, drift] = await Promise.all([
    pool.query(
      `SELECT * FROM assurance_assignments WHERE tenant_id=$1 AND agent_id=$2 ORDER BY control_id`,
      [tenantId, agentId]
    ),
    pool.query(
      `SELECT * FROM permission_snapshots WHERE tenant_id=$1 AND agent_id=$2 ORDER BY captured_at DESC LIMIT 1`,
      [tenantId, agentId]
    ),
    pool.query(
      `SELECT * FROM runtime_events WHERE tenant_id=$1 AND agent_id=$2 ORDER BY occurred_at DESC LIMIT 100`,
      [tenantId, agentId]
    ),
    pool.query(
      `SELECT DISTINCT ON (control_id) * FROM control_evaluations
       WHERE tenant_id=$1 AND agent_id=$2
       ORDER BY control_id, evaluated_at DESC`,
      [tenantId, agentId]
    ),
    pool.query(
      `SELECT * FROM assurance_baselines WHERE tenant_id=$1 AND agent_id=$2 ORDER BY created_at DESC LIMIT 1`,
      [tenantId, agentId]
    ),
    pool.query(
      `SELECT * FROM assurance_drift WHERE tenant_id=$1 AND agent_id=$2 ORDER BY detected_at DESC LIMIT 10`,
      [tenantId, agentId]
    )
  ]);
  const assignedIds = new Set(assignments.rows.map((row) => row.control_id));
  const latest = new Map(evaluations.rows.map((row) => [row.control_id, row]));
  return {
    agent: { id: agent.id, name: agent.name },
    controls: ASSURANCE_CONTROLS.map((control) => ({
      ...control,
      assigned: assignedIds.has(control.id),
      parameters: assignments.rows.find((row) => row.control_id === control.id)?.parameters || {},
      evaluation: latest.get(control.id) || null
    })),
    snapshot: snapshot.rows[0] || null,
    events: events.rows,
    baseline: baseline.rows[0] || null,
    drift: drift.rows
  };
}

export async function assignControl(pool, tenantId, agentId, body, actor) {
  const control = getAssuranceControl(body.controlId);
  if (!control) throw httpError("Unknown control");
  await requireAgent(pool, tenantId, agentId);
  const parameters = {};
  if (Array.isArray(body.parameters?.apiAllowlist)) {
    parameters.apiAllowlist = body.parameters.apiAllowlist.map((item) => String(item).slice(0, 200)).slice(0, 50);
  } else if (typeof body.parameters?.apiAllowlist === "string") {
    parameters.apiAllowlist = body.parameters.apiAllowlist
      .split(/[\n,]/)
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, 50);
  }
  const res = await pool.query(
    `INSERT INTO assurance_assignments (tenant_id, agent_id, control_id, framework, parameters, assigned_by)
     VALUES ($1,$2,$3,$4,$5::jsonb,$6)
     ON CONFLICT (tenant_id, agent_id, control_id)
     DO UPDATE SET parameters=EXCLUDED.parameters, assigned_by=EXCLUDED.assigned_by, updated_at=NOW()
     RETURNING *`,
    [tenantId, agentId, control.id, control.framework, JSON.stringify(parameters), actor || null]
  );
  return res.rows[0];
}

export async function unassignControl(pool, tenantId, agentId, controlId) {
  await requireAgent(pool, tenantId, agentId);
  await pool.query(`DELETE FROM assurance_assignments WHERE tenant_id=$1 AND agent_id=$2 AND control_id=$3`, [
    tenantId,
    agentId,
    controlId
  ]);
}

export async function recordPermissionSnapshot(pool, tenantId, agentId, body, actor) {
  const agent = await requireAgent(pool, tenantId, agentId);
  const counts = countsFrom(agent.tools, agent.mcp_connections);
  const capabilities = sanitizeCapabilities(body.capabilities);
  const chain = sanitizeChain(body.chain);
  const coverage = boolMap(body.coverage);
  if (!Object.values(coverage).some(Boolean)) {
    throw httpError("Mark at least one plane that was actually read: authorization, database, api, or runtime");
  }
  const fingerprint = createHash("sha256").update(permissionFingerprint(capabilities)).digest("hex").slice(0, 16);
  const res = await pool.query(
    `INSERT INTO permission_snapshots
       (tenant_id, agent_id, source, chain, capabilities, coverage, fingerprint, tool_count, mcp_count, recorded_by)
     VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,$6::jsonb,$7,$8,$9,$10)
     RETURNING *`,
    [
      tenantId,
      agentId,
      String(body.source || "operator").slice(0, 80),
      JSON.stringify(chain),
      JSON.stringify(capabilities),
      JSON.stringify(coverage),
      fingerprint,
      counts.toolCount,
      counts.mcpCount,
      actor || null
    ]
  );
  return res.rows[0];
}

export async function recordRuntimeEvents(pool, tenantId, agentId, body) {
  await requireAgent(pool, tenantId, agentId);
  const events = Array.isArray(body.events) ? body.events : [body];
  if (!events.length) throw httpError("At least one runtime event is required");
  const saved = [];
  for (const raw of events.slice(0, 50)) {
    const event = sanitizeRuntimeEvent(raw);
    if (!event.resource && !event.operation) throw httpError("Runtime event needs an operation or resource");
    const res = await pool.query(
      `INSERT INTO runtime_events
         (tenant_id, agent_id, occurred_at, source, action, operation, resource, kind, data_class, decision, identity, destructive, field_names, content_hash, redacted_sample)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14,$15)
       RETURNING *`,
      [
        tenantId,
        agentId,
        event.occurredAt,
        event.source,
        event.action,
        event.operation,
        event.resource,
        event.kind,
        event.dataClass,
        event.decision,
        event.identity,
        event.destructive,
        JSON.stringify(event.fieldNames),
        event.contentHash,
        event.redactedSample
      ]
    );
    saved.push(res.rows[0]);
  }
  return saved;
}

export async function evaluateAgent(pool, tenantId, agentId) {
  const agent = await requireAgent(pool, tenantId, agentId);
  const assignments = await pool.query(
    `SELECT * FROM assurance_assignments WHERE tenant_id=$1 AND agent_id=$2`,
    [tenantId, agentId]
  );
  if (!assignments.rows.length) throw httpError("Assign at least one control before evaluation");
  const snapshotRes = await pool.query(
    `SELECT * FROM permission_snapshots WHERE tenant_id=$1 AND agent_id=$2 ORDER BY captured_at DESC LIMIT 1`,
    [tenantId, agentId]
  );
  const eventRes = await pool.query(
    `SELECT * FROM runtime_events WHERE tenant_id=$1 AND agent_id=$2 ORDER BY occurred_at DESC LIMIT 500`,
    [tenantId, agentId]
  );
  const snapshot = snapshotRes.rows[0] || null;
  const events = eventRes.rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    action: row.action,
    operation: row.operation,
    resource: row.resource,
    dataClass: row.data_class,
    decision: row.decision,
    destructive: row.destructive,
    occurredAt: row.occurred_at
  }));
  const evaluations = [];
  for (const assignment of assignments.rows) {
    const control = getAssuranceControl(assignment.control_id);
    if (!control) continue;
    const result = evaluateControl({
      control,
      parameters: assignment.parameters || {},
      snapshot: snapshot
        ? {
            id: snapshot.id,
            source: snapshot.source,
            coverage: snapshot.coverage,
            capabilities: snapshot.capabilities,
            chain: snapshot.chain
          }
        : null,
      events
    });
    const saved = await pool.query(
      `INSERT INTO control_evaluations
         (tenant_id, agent_id, control_id, status, summary, requirement, effective_permission, evidence, missing, snapshot_id)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8::jsonb,$9::jsonb,$10)
       RETURNING *`,
      [
        tenantId,
        agentId,
        control.id,
        result.status,
        result.summary,
        JSON.stringify(result.requirement),
        JSON.stringify(result.effectivePermission),
        JSON.stringify(result.evidence),
        JSON.stringify(result.missing),
        snapshot?.id || null
      ]
    );
    evaluations.push(saved.rows[0]);
  }

  const baselineRes = await pool.query(
    `SELECT * FROM assurance_baselines WHERE tenant_id=$1 AND agent_id=$2 ORDER BY created_at DESC LIMIT 1`,
    [tenantId, agentId]
  );
  let drift = null;
  if (baselineRes.rows[0] && snapshot) {
    const counts = countsFrom(agent.tools, agent.mcp_connections);
    const current = {
      ...postureFromSnapshot({
        coverage: snapshot.coverage,
        capabilities: snapshot.capabilities,
        toolCount: counts.toolCount,
        mcpCount: counts.mcpCount
      }),
      toolCount: counts.toolCount,
      mcpCount: counts.mcpCount
    };
    const found = detectDrift(baselineRes.rows[0].snapshot || {}, current);
    if (found.drifted) {
      const saved = await pool.query(
        `INSERT INTO assurance_drift (tenant_id, agent_id, severity, baseline, current, changes, evaluation_id)
         VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,$6::jsonb,$7)
         RETURNING *`,
        [
          tenantId,
          agentId,
          found.severity,
          JSON.stringify(baselineRes.rows[0].snapshot),
          JSON.stringify(current),
          JSON.stringify(found.changes),
          evaluations[0]?.id || null
        ]
      );
      drift = saved.rows[0];
    }
  }
  return { evaluations, drift };
}

export async function approveBaseline(pool, tenantId, agentId, actor) {
  const agent = await requireAgent(pool, tenantId, agentId);
  const snapshotRes = await pool.query(
    `SELECT * FROM permission_snapshots WHERE tenant_id=$1 AND agent_id=$2 ORDER BY captured_at DESC LIMIT 1`,
    [tenantId, agentId]
  );
  if (!snapshotRes.rows[0]) throw httpError("Record a permission snapshot before approving a baseline");
  const counts = countsFrom(agent.tools, agent.mcp_connections);
  const posture = postureFromSnapshot({
    coverage: snapshotRes.rows[0].coverage,
    capabilities: snapshotRes.rows[0].capabilities,
    toolCount: counts.toolCount,
    mcpCount: counts.mcpCount
  });
  const snapshot = { ...posture, toolCount: counts.toolCount, mcpCount: counts.mcpCount };
  const res = await pool.query(
    `INSERT INTO assurance_baselines (tenant_id, agent_id, snapshot, approved_by)
     VALUES ($1,$2,$3::jsonb,$4)
     RETURNING *`,
    [tenantId, agentId, JSON.stringify(snapshot), actor || null]
  );
  return res.rows[0];
}
