import { randomUUID } from "crypto";
import { runCollectors, DEFAULT_COLLECTORS } from "./collectors.js";
import { applyShadowAiToObservation } from "../services/shadowAi.js";

function asArray(v) {
  if (!v) return [];
  if (Array.isArray(v)) return v;
  return [v];
}

async function upsertAsset(client, tenantId, assetType, externalKey, name, attributes = {}) {
  const res = await client.query(
    `INSERT INTO assets (tenant_id, asset_type, name, external_key, attributes, last_seen, updated_at)
     VALUES ($1,$2,$3,$4,$5,NOW(),NOW())
     ON CONFLICT (tenant_id, asset_type, external_key)
     DO UPDATE SET name = EXCLUDED.name, attributes = assets.attributes || EXCLUDED.attributes,
                   last_seen = NOW(), updated_at = NOW()
     RETURNING id`,
    [tenantId, assetType, name, externalKey, JSON.stringify(attributes)]
  );
  return res.rows[0].id;
}

async function projectNeo4j(neo4j, tenantId, agent, assetIdsByKey, relationships) {
  if (!neo4j) return;
  const session = neo4j.session();
  try {
    await session.run(
      `MERGE (a:Agent {tenantId: $tenantId, id: $id})
       SET a.name = $name, a.category = $category, a.framework = $framework,
           a.model = $model, a.confidence = $confidence, a.lastSeen = datetime()`,
      {
        tenantId,
        id: agent.id,
        name: agent.name,
        category: agent.category,
        framework: agent.framework || null,
        model: agent.model || null,
        confidence: Number(agent.confidence_score) || 0.5
      }
    );

    for (const rel of relationships) {
      const toId = assetIdsByKey[`${rel.to_type}:${rel.to_key}`];
      if (!toId) continue;
      const label = rel.to_type;
      await session.run(
        `MERGE (n:${label} {tenantId: $tenantId, id: $toId})
         SET n.name = $toName, n.lastSeen = datetime()
         WITH n
         MATCH (a:Agent {tenantId: $tenantId, id: $agentId})
         MERGE (a)-[r:${rel.rel_type}]->(n)
         SET r.confidence = $confidence, r.lastSeen = datetime()`,
        {
          tenantId,
          toId,
          toName: rel.to_name || rel.to_key,
          agentId: agent.id,
          confidence: Number(rel.confidence) || Number(agent.confidence_score) || 0.5
        }
      );
    }
  } finally {
    await session.close();
  }
}

/** Connector health/scan rows — not AI agents; keep out of inventory. */
const CONNECTOR_META_CLASSES = new Set([
  "connector_scan",
  "edr_connector",
  "saas_connector",
  "kubernetes_connector",
  "source_connector",
  "identity_connector"
]);

export function isConnectorMetaObservation(obs) {
  const meta = obs?.metadata || {};
  const inventoryClass = String(meta.inventoryClass || "");
  if (CONNECTOR_META_CLASSES.has(inventoryClass)) return true;
  const fingerprint = String(obs?.fingerprint || "");
  if (/-connector-scan:/.test(fingerprint)) return true;
  if (/-connector-error:/.test(fingerprint)) return true;
  if (/^edr-connector:/.test(fingerprint)) return true;
  if (/^saas-connector:/.test(fingerprint)) return true;
  if (/^saas:.*:connector:/.test(fingerprint)) return true;
  // Names like "Azure scan — <connector name>" / "Azure connector error — …"
  const name = String(obs?.name || "");
  if (/\b(scan|connector error)\s+[—-]\s+/i.test(name) && meta.connectorId) return true;
  return false;
}

export async function ingestObservations(pool, neo4j, tenantId, jobId, observations, emitEvent) {
  let agentsFound = 0;
  const client = await pool.connect();
  try {
    for (const rawObs of observations) {
      if (isConnectorMetaObservation(rawObs)) {
        // Scan/health evidence stays in discovery_events from collectors — do not invent fake agents.
        continue;
      }
      const obs = applyShadowAiToObservation(rawObs);
      await client.query("BEGIN");
      try {
        const fingerprint = obs.fingerprint || `anon:${randomUUID()}`;
        const agentRes = await client.query(
          `INSERT INTO agents (
             tenant_id, fingerprint, name, owner, device, hostname, ip, operating_system,
             department, business_unit, location, repository, framework, programming_language,
             model, provider, version, deployment_type, cloud_provider, region, container, vm,
             endpoint, ide, creation_time, last_modified, last_seen, running_status,
             memory_usage_mb, cpu_usage_pct, api_keys_detected, secrets_detected,
             mcp_connections, tools, prompt_templates, memory_store, vector_database,
             connected_applications, identity_used, permissions, internet_access,
             filesystem_access, database_access, github_access, slack_access, email_access,
             calendar_access, browser_access, execution_capability, risk_indicators,
             confidence_score, category, metadata, source_collectors, updated_at
           ) VALUES (
             $1,$2,$3,$4,$5,$6,$7::inet,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,
             $23,$24,$25,$26,NOW(),$27,$28,$29,$30,$31,$32::jsonb,$33::jsonb,$34::jsonb,$35,$36,
             $37::jsonb,$38,$39::jsonb,$40,$41,$42,$43,$44,$45,$46,$47,$48,$49::jsonb,$50,$51,
             $52::jsonb,ARRAY[$53]::text[],NOW()
           )
           ON CONFLICT (tenant_id, fingerprint) DO UPDATE SET
             name = EXCLUDED.name,
             owner = COALESCE(EXCLUDED.owner, agents.owner),
             hostname = COALESCE(EXCLUDED.hostname, agents.hostname),
             device = COALESCE(EXCLUDED.device, agents.device),
             operating_system = COALESCE(EXCLUDED.operating_system, agents.operating_system),
             framework = COALESCE(EXCLUDED.framework, agents.framework),
             model = COALESCE(EXCLUDED.model, agents.model),
             provider = COALESCE(EXCLUDED.provider, agents.provider),
             deployment_type = COALESCE(EXCLUDED.deployment_type, agents.deployment_type),
             cloud_provider = COALESCE(EXCLUDED.cloud_provider, agents.cloud_provider),
             region = COALESCE(EXCLUDED.region, agents.region),
             category = COALESCE(EXCLUDED.category, agents.category),
             last_seen = NOW(),
             running_status = EXCLUDED.running_status,
             tools = EXCLUDED.tools,
             mcp_connections = EXCLUDED.mcp_connections,
             risk_indicators = EXCLUDED.risk_indicators,
             confidence_score = GREATEST(agents.confidence_score, EXCLUDED.confidence_score),
             metadata = agents.metadata || EXCLUDED.metadata,
             source_collectors = (SELECT ARRAY(SELECT DISTINCT unnest(agents.source_collectors || EXCLUDED.source_collectors))),
             updated_at = NOW()
           RETURNING *`,
          [
            tenantId,
            fingerprint,
            obs.name || fingerprint,
            obs.owner || null,
            obs.device || null,
            obs.hostname || null,
            obs.ip || null,
            obs.operating_system || null,
            obs.department || null,
            obs.business_unit || null,
            obs.location || null,
            obs.repository || null,
            obs.framework || null,
            obs.programming_language || null,
            obs.model || null,
            obs.provider || null,
            obs.version || null,
            obs.deployment_type || null,
            obs.cloud_provider || null,
            obs.region || null,
            obs.container || null,
            obs.vm || null,
            obs.endpoint || null,
            obs.ide || null,
            obs.creation_time || null,
            obs.last_modified || null,
            obs.running_status || "unknown",
            obs.memory_usage_mb ?? null,
            obs.cpu_usage_pct ?? null,
            Boolean(obs.api_keys_detected),
            Boolean(obs.secrets_detected),
            JSON.stringify(asArray(obs.mcp_connections)),
            JSON.stringify(asArray(obs.tools)),
            JSON.stringify(asArray(obs.prompt_templates)),
            obs.memory_store || null,
            obs.vector_database || null,
            JSON.stringify(asArray(obs.connected_applications)),
            obs.identity_used || null,
            JSON.stringify(asArray(obs.permissions)),
            Boolean(obs.internet_access),
            Boolean(obs.filesystem_access),
            Boolean(obs.database_access),
            Boolean(obs.github_access),
            Boolean(obs.slack_access),
            Boolean(obs.email_access),
            Boolean(obs.calendar_access),
            Boolean(obs.browser_access),
            obs.execution_capability || null,
            JSON.stringify(asArray(obs.risk_indicators)),
            Number(obs.confidence_score) || 0.5,
            obs.category || "unknown",
            JSON.stringify(obs.metadata || {}),
            obs.collector_id || "unknown"
          ]
        );

        const agent = agentRes.rows[0];
        agentsFound += 1;

        await client.query(
          `INSERT INTO agent_observations (tenant_id, collector_id, job_id, payload, fingerprint_hint, agent_id)
           VALUES ($1,$2,$3,$4::jsonb,$5,$6)`,
          [tenantId, obs.collector_id || "unknown", jobId, JSON.stringify(obs), fingerprint, agent.id]
        );

        const assetIdsByKey = {};
        const rels = obs.relationships || [];
        for (const rel of rels) {
          const assetId = await upsertAsset(
            client,
            tenantId,
            rel.to_type,
            rel.to_key,
            rel.to_name || rel.to_key,
            { from_agent: agent.id }
          );
          assetIdsByKey[`${rel.to_type}:${rel.to_key}`] = assetId;
          await client.query(
            `INSERT INTO relationships (tenant_id, from_type, from_id, to_type, to_id, rel_type, confidence, evidence, last_seen)
             VALUES ($1,'Agent',$2,$3,$4,$5,$6,$7::jsonb,NOW())
             ON CONFLICT (tenant_id, from_type, from_id, to_type, to_id, rel_type)
             DO UPDATE SET confidence = EXCLUDED.confidence, last_seen = NOW(), evidence = EXCLUDED.evidence`,
            [
              tenantId,
              agent.id,
              rel.to_type,
              assetId,
              rel.rel_type,
              Number(rel.confidence) || Number(agent.confidence_score) || 0.5,
              JSON.stringify({ collector: obs.collector_id, to_key: rel.to_key })
            ]
          );
        }

        await client.query("COMMIT");
        await projectNeo4j(neo4j, tenantId, agent, assetIdsByKey, rels);
        emitEvent?.({ type: "inventory.agent.updated", agentId: agent.id });
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      }
    }
  } finally {
    client.release();
  }
  return agentsFound;
}

/**
 * Atomically claim one running discovery job per tenant (advisory lock + insert).
 * Throws err.status=409 if a job is already running.
 */
export async function claimDiscoveryJob(pool, { tenantId, collectorIds, triggeredBy }) {
  const collectors = collectorIds?.length ? collectorIds : DEFAULT_COLLECTORS;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Serialize claim attempts per tenant (key namespace 872314 = "AgentRadar discovery")
    await client.query(`SELECT pg_advisory_xact_lock(872314, hashtext($1::text))`, [tenantId]);
    const running = await client.query(
      `SELECT id FROM discovery_jobs WHERE tenant_id=$1 AND status='running' ORDER BY created_at DESC LIMIT 1`,
      [tenantId]
    );
    if (running.rows.length) {
      const err = new Error("A discovery job is already running for this tenant");
      err.status = 409;
      err.jobId = running.rows[0].id;
      throw err;
    }
    const jobRes = await client.query(
      `INSERT INTO discovery_jobs (tenant_id, collector_ids, status, triggered_by, started_at)
       VALUES ($1,$2,'running',$3,NOW()) RETURNING *`,
      [tenantId, collectors, triggeredBy || "system"]
    );
    await client.query("COMMIT");
    return jobRes.rows[0];
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    // Unique partial index race (concurrent claim across API replicas)
    if (err?.code === "23505") {
      const running = await pool.query(
        `SELECT id FROM discovery_jobs WHERE tenant_id=$1 AND status='running' ORDER BY created_at DESC LIMIT 1`,
        [tenantId]
      );
      const conflict = new Error("A discovery job is already running for this tenant");
      conflict.status = 409;
      conflict.jobId = running.rows[0]?.id;
      throw conflict;
    }
    throw err;
  } finally {
    client.release();
  }
}

export async function executeDiscoveryJob(pool, neo4j, job, { tenantId, triggeredBy, broadcast }) {
  const collectors = job.collector_ids || DEFAULT_COLLECTORS;
  // Brief hold so concurrent claims observe status='running' (unique index is the hard guard).
  const startDelayMs = Number(process.env.DISCOVERY_JOB_START_DELAY_MS || 250);
  if (startDelayMs > 0) {
    await new Promise((r) => setTimeout(r, startDelayMs));
  }
  await pool.query(
    `INSERT INTO discovery_events (tenant_id, event_type, severity, message, payload)
     VALUES ($1,'job.started','info',$2,$3::jsonb)`,
    [tenantId, `Discovery job started`, JSON.stringify({ jobId: job.id, collectors })]
  );

  try {
    const observations = await runCollectors(collectors, { tenantId, ownerHint: triggeredBy, pool });
    const agentsFound = await ingestObservations(
      pool,
      neo4j,
      tenantId,
      job.id,
      observations,
      (evt) => broadcast?.(tenantId, evt)
    );

    await pool.query(
      `UPDATE discovery_jobs SET status='complete', agents_found=$2, finished_at=NOW() WHERE id=$1`,
      [job.id, agentsFound]
    );
    await pool.query(
      `INSERT INTO discovery_events (tenant_id, event_type, severity, message, payload)
       VALUES ($1,'job.completed','info',$2,$3::jsonb)`,
      [tenantId, `Discovery job completed — ${agentsFound} agents`, JSON.stringify({ jobId: job.id, agentsFound })]
    );
    broadcast?.(tenantId, { type: "graph.updated", jobId: job.id });
    return { ...job, status: "complete", agents_found: agentsFound };
  } catch (err) {
    await pool.query(
      `UPDATE discovery_jobs SET status='error', error=$2, finished_at=NOW() WHERE id=$1`,
      [job.id, String(err.message || err)]
    );
    await pool.query(
      `INSERT INTO discovery_events (tenant_id, event_type, severity, message, payload)
       VALUES ($1,'job.error','error',$2,$3::jsonb)`,
      [tenantId, String(err.message || err), JSON.stringify({ jobId: job.id })]
    );
    throw err;
  }
}

export async function runDiscoveryJob(pool, neo4j, { tenantId, collectorIds, triggeredBy, broadcast }) {
  const job = await claimDiscoveryJob(pool, { tenantId, collectorIds, triggeredBy });
  return executeDiscoveryJob(pool, neo4j, job, { tenantId, triggeredBy, broadcast });
}
