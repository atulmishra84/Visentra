import { pool } from "../db/postgres.js";
import { neo4jDriver } from "../db/neo4j.js";
import { isUuid } from "./agentFilters.js";

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

  for (const a of agents.rows) {
    nodes.set(a.id, {
      id: a.id,
      type: "Agent",
      label: a.name,
      name: a.name,
      category: a.category,
      framework: a.framework,
      model: a.model,
      provider: a.provider || a.cloud_provider
    });

    // Attribute edges so Topology Map is useful even when SQL relationships are sparse
    const attrs = [
      ["Model", a.model, "INVOKES_MODEL"],
      ["Framework", a.framework, "USES_FRAMEWORK"],
      ["Cloud", a.cloud_provider || (a.provider === "azure" || a.provider === "aws" || a.provider === "gcp" ? a.provider : null), "DEPLOYED_IN"],
      ["IDE", a.ide, "RUNS_IN"],
      ["Provider", a.provider && a.provider !== a.cloud_provider ? a.provider : null, "PROVIDED_BY"]
    ];
    for (const [type, value, rel] of attrs) {
      if (!value) continue;
      const key = `${String(type).toLowerCase()}:${String(value).toLowerCase()}`;
      if (!nodes.has(key) && nodes.size < maxNodes * 2) {
        nodes.set(key, {
          id: key,
          type,
          label: String(value),
          name: String(value),
          category: String(type).toLowerCase()
        });
      }
      if (nodes.has(key)) {
        edges.push({
          id: `${a.id}:${rel}:${key}`,
          source: a.id,
          target: key,
          from: a.id,
          to: key,
          type: rel,
          label: rel
        });
      }
    }
  }

  const agentIds = agents.rows.map((a) => a.id);
  if (!agentIds.length) {
    return { nodes: [], edges: [], meta: { matched: 0, message: "No inventory assets yet. Run discovery first." } };
  }

  const rels = await pool.query(
    `SELECT r.*, a.name AS from_name, s.name AS to_name, s.asset_type
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
    nodes.set(r.to_id, {
      id: r.to_id,
      type: r.to_type || r.asset_type || "Asset",
      label: r.to_name,
      name: r.to_name,
      category: r.asset_type || r.to_type
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
