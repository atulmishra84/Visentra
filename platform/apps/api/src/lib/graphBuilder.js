import { pool } from "../db/postgres.js";
import { neo4jDriver } from "../db/neo4j.js";
import { isUuid } from "./agentFilters.js";
import { classifyShadowAi } from "../services/shadowAi.js";

function asMeta(row) {
  const meta = row?.metadata;
  if (!meta) return {};
  if (typeof meta === "string") {
    try {
      return JSON.parse(meta) || {};
    } catch {
      return {};
    }
  }
  return typeof meta === "object" ? meta : {};
}

function agentGraphNode(a) {
  const meta = asMeta(a);
  const awsType = meta.awsType || null;
  const agentStatus = meta.agentStatus || null;
  const shadow = classifyShadowAi({ ...a, metadata: meta });
  return {
    id: a.id,
    type: "Agent",
    label: a.name,
    name: a.name,
    category: a.category,
    framework: a.framework,
    model: a.model,
    owner: a.owner || meta.owner || null,
    provider: a.provider || a.cloud_provider,
    cloudProvider: a.cloud_provider || null,
    region: a.region || null,
    runningStatus: a.running_status || null,
    awsType,
    agentStatus,
    awsLifecycleStatus: meta.awsLifecycleStatus || null,
    accountId: meta.accountId || null,
    connectorId: meta.connectorId || null,
    connectorName: meta.connectorName || null,
    managedCloudAgent: Boolean(meta.managedCloudAgent),
    aliases: Array.isArray(meta.aliases) ? meta.aliases : null,
    knowledgeBaseIds: Array.isArray(meta.knowledgeBaseIds) ? meta.knowledgeBaseIds : null,
    kindLabel: awsType || a.framework || a.category || "Agent",
    shadowAi: shadow.isShadow,
    shadowAiScore: shadow.score,
    shadowAiReasons: shadow.reasons,
    shadowAiTags: shadow.tags
  };
}

export async function resolveSeedAgents(tenantId, seed) {
  const q = String(seed || "").trim();
  if (!q) return [];

  if (isUuid(q)) {
    const byId = await pool.query(`SELECT * FROM agents WHERE tenant_id=$1 AND id=$2`, [tenantId, q]);
    if (byId.rows.length) return byId.rows;
  }

  const byKey = await pool.query(
    `SELECT * FROM agents
     WHERE tenant_id=$1
       AND (fingerprint = $2 OR lower(name) = lower($2))
     ORDER BY last_seen DESC
     LIMIT 5`,
    [tenantId, q]
  );
  if (byKey.rows.length) return byKey.rows;

  const fuzzy = await pool.query(
    `SELECT * FROM agents
     WHERE tenant_id=$1
       AND (name ILIKE $2 OR fingerprint ILIKE $2 OR framework ILIKE $2 OR category ILIKE $2)
     ORDER BY last_seen DESC
     LIMIT 12`,
    [tenantId, `%${q}%`]
  );
  return fuzzy.rows;
}

function pushAttrEdge(nodes, edges, agent, type, value, rel, maxNodes) {
  if (!value) return;
  const key = `${String(type).toLowerCase()}:${String(value).toLowerCase()}`;
  if (!nodes.has(key) && nodes.size < maxNodes * 2) {
    nodes.set(key, {
      id: key,
      type,
      label: String(value),
      name: String(value),
      category: String(type).toLowerCase(),
      kindLabel: type
    });
  }
  if (nodes.has(key)) {
    edges.push({
      id: `${agent.id}:${rel}:${key}`,
      source: agent.id,
      target: key,
      from: agent.id,
      to: key,
      type: rel,
      label: rel
    });
  }
}

function linkBedrockAgentsToKnowledgeBases(nodes, edges, agentRows) {
  const kbById = new Map();
  for (const row of agentRows) {
    const meta = asMeta(row);
    if (meta.awsType === "BedrockKnowledgeBase" && meta.knowledgeBaseId) {
      kbById.set(String(meta.knowledgeBaseId), row.id);
    }
  }
  for (const row of agentRows) {
    const meta = asMeta(row);
    if (meta.awsType !== "BedrockAgent") continue;
    const kbIds = Array.isArray(meta.knowledgeBaseIds) ? meta.knowledgeBaseIds : [];
    for (const kbId of kbIds) {
      const targetId = kbById.get(String(kbId));
      if (!targetId || !nodes.has(row.id) || !nodes.has(targetId)) continue;
      edges.push({
        id: `${row.id}:USES_KNOWLEDGE_BASE:${targetId}`,
        source: row.id,
        target: targetId,
        from: row.id,
        to: targetId,
        type: "USES_KNOWLEDGE_BASE",
        label: "USES_KNOWLEDGE_BASE"
      });
    }
  }
}

function linkAliasesFromMetadata(nodes, edges, agentRows, maxNodes) {
  const agentsWithAliasEdges = new Set(
    edges.filter((e) => e.type === "EXPOSES_ALIAS").map((e) => String(e.source || e.from))
  );
  for (const row of agentRows) {
    if (agentsWithAliasEdges.has(String(row.id))) continue;
    const meta = asMeta(row);
    const aliases = Array.isArray(meta.aliases) ? meta.aliases : [];
    const agentId = meta.agentId || row.id;
    for (const alias of aliases.slice(0, 6)) {
      const aliasName = String(alias || "").trim();
      if (!aliasName) continue;
      const key = `aws-alias:${agentId}:${aliasName}`;
      if (!nodes.has(key) && nodes.size < maxNodes * 2) {
        nodes.set(key, {
          id: key,
          type: "AgentAlias",
          label: aliasName,
          name: aliasName,
          category: "agentalias",
          kindLabel: "AgentAlias"
        });
      }
      if (nodes.has(key) && nodes.has(row.id)) {
        edges.push({
          id: `${row.id}:EXPOSES_ALIAS:${key}`,
          source: row.id,
          target: key,
          from: row.id,
          to: key,
          type: "EXPOSES_ALIAS",
          label: "EXPOSES_ALIAS"
        });
      }
    }
  }
}

export async function graphFromSql(tenantId, { agentId, depth = 2, limit = 60 } = {}) {
  const nodes = new Map();
  const edges = [];
  const maxNodes = Math.min(Math.max(Number(limit) || 60, 10), 200);
  const hopDepth = Math.min(Math.max(Number(depth) || 2, 1), 3);

  let agents;
  let seedMode = Boolean(agentId);

  if (agentId) {
    agents = { rows: await resolveSeedAgents(tenantId, agentId) };
    if (!agents.rows.length) {
      return {
        nodes: [],
        edges: [],
        meta: {
          seed: agentId,
          matched: 0,
          message: `No inventory match for "${agentId}". Try an agent UUID, fingerprint, or name from Inventory.`
        }
      };
    }
  } else {
    // Prefer agents that already have relationships so the explorer is never empty/sparse
    agents = await pool.query(
      `SELECT a.*
       FROM agents a
       WHERE a.tenant_id=$1
         AND EXISTS (
           SELECT 1 FROM relationships r
           WHERE r.tenant_id=a.tenant_id AND r.from_id=a.id
         )
       ORDER BY a.last_seen DESC
       LIMIT $2`,
      [tenantId, maxNodes]
    );
    if (!agents.rows.length) {
      agents = await pool.query(
        `SELECT * FROM agents WHERE tenant_id=$1 ORDER BY last_seen DESC LIMIT $2`,
        [tenantId, maxNodes]
      );
    }
  }

  // When seeding on a Bedrock agent, pull sibling AWS agents in the same account for KB links
  if (seedMode && agents.rows.length) {
    const seedMeta = asMeta(agents.rows[0]);
    if (seedMeta.accountId && seedMeta.awsType) {
      const siblings = await pool.query(
        `SELECT * FROM agents
         WHERE tenant_id=$1
           AND cloud_provider='aws'
           AND metadata->>'accountId'=$2
         ORDER BY last_seen DESC
         LIMIT 80`,
        [tenantId, String(seedMeta.accountId)]
      );
      const byId = new Map(agents.rows.map((r) => [r.id, r]));
      for (const row of siblings.rows) byId.set(row.id, row);
      agents = { rows: [...byId.values()] };
    }
  }

  for (const a of agents.rows) {
    const meta = asMeta(a);
    nodes.set(a.id, agentGraphNode(a));

    // Attribute edges so Topology Map is useful even when SQL relationships are sparse
    pushAttrEdge(nodes, edges, a, "Model", a.model, "INVOKES_MODEL", maxNodes);
    pushAttrEdge(nodes, edges, a, "Framework", meta.awsType || a.framework, "USES_FRAMEWORK", maxNodes);
    pushAttrEdge(
      nodes,
      edges,
      a,
      "Cloud",
      a.cloud_provider ||
        (a.provider === "azure" || a.provider === "aws" || a.provider === "gcp" ? a.provider : null),
      "DEPLOYED_IN",
      maxNodes
    );
    pushAttrEdge(nodes, edges, a, "IDE", a.ide, "RUNS_IN", maxNodes);
    pushAttrEdge(
      nodes,
      edges,
      a,
      "Provider",
      a.provider && a.provider !== a.cloud_provider ? a.provider : null,
      "PROVIDED_BY",
      maxNodes
    );
    if (meta.accountId) {
      pushAttrEdge(nodes, edges, a, "CloudAccount", `AWS ${meta.accountId}`, "DEPLOYED_IN", maxNodes);
    }
    if (meta.connectorName || meta.connectorId) {
      pushAttrEdge(
        nodes,
        edges,
        a,
        "Connector",
        meta.connectorName || meta.connectorId,
        "OBSERVED_BY",
        maxNodes
      );
    }
  }

  linkBedrockAgentsToKnowledgeBases(nodes, edges, agents.rows);

  const agentIds = agents.rows.map((a) => a.id);
  if (!agentIds.length) {
    return { nodes: [], edges: [], meta: { matched: 0, message: "No inventory assets yet. Run discovery first." } };
  }

  const rels = await pool.query(
    `SELECT r.*, a.name AS from_name, s.name AS to_name, s.asset_type, s.external_key
     FROM relationships r
     JOIN agents a ON a.id = r.from_id
     JOIN assets s ON s.id = r.to_id
     WHERE r.tenant_id=$1 AND r.from_id = ANY($2::uuid[])
     ORDER BY r.last_seen DESC
     LIMIT 500`,
    [tenantId, agentIds]
  );

  for (const r of rels.rows) {
    if (nodes.size >= maxNodes * 2 && !nodes.has(r.to_id)) continue;
    const assetType = r.to_type || r.asset_type || "Asset";
    nodes.set(r.to_id, {
      id: r.to_id,
      type: assetType,
      label: r.to_name,
      name: r.to_name,
      category: r.asset_type || r.to_type,
      kindLabel: assetType,
      externalKey: r.external_key || null
    });
    edges.push({
      id: r.id,
      source: r.from_id,
      target: r.to_id,
      from: r.from_id,
      to: r.to_id,
      type: r.rel_type,
      label: r.rel_type,
      confidence: r.confidence
    });
  }

  // Fallback aliases only when discovery has not yet projected EXPOSES_ALIAS assets
  linkAliasesFromMetadata(nodes, edges, agents.rows, maxNodes);

  // Optional Neo4j enrichment (SQL graph is primary for MVP)
  if (neo4jDriver && seedMode && hopDepth > 1 && agentIds.length === 1) {
    const session = neo4jDriver.session();
    try {
      await session.run(
        `MATCH (a:Agent {tenantId: $tenantId, id: $agentId})-[*1..2]-(n)
         WHERE n.tenantId = $tenantId
         RETURN count(n) AS c`,
        { tenantId, agentId: agentIds[0] }
      );
    } catch (err) {
      console.warn("Neo4j graph query:", err.message);
    } finally {
      await session.close();
    }
  }

  // Deduplicate edges by source|target|type
  const seen = new Set();
  const uniqueEdges = [];
  for (const edge of edges) {
    const key = `${edge.source}|${edge.target}|${edge.type}`;
    if (seen.has(key)) continue;
    seen.add(key);
    uniqueEdges.push(edge);
  }

  return {
    nodes: [...nodes.values()],
    edges: uniqueEdges,
    meta: {
      seed: agentId || null,
      matched: agents.rows.length,
      nodeCount: nodes.size,
      edgeCount: uniqueEdges.length,
      depth: hopDepth,
      message: seedMode
        ? `Neighborhood for ${agents.rows.length} seed agent(s)`
        : `Overview of ${agents.rows.length} connected agents`
    }
  };
}
