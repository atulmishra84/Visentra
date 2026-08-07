import { pool } from "../db/postgres.js";
import { agentFilters } from "../lib/agentFilters.js";

export async function search(req, res) {
  const q = String(req.query.q || "").trim();
  const { clauses, params } = agentFilters({ ...req.query, q });
  const result = await pool.query(
    `SELECT * FROM agents WHERE tenant_id=$1 ${clauses} ORDER BY confidence_score DESC, last_seen DESC LIMIT 100`,
    [req.tenantId, ...params]
  );

  const facetSql = async (col) => {
    const r = await pool.query(
      `SELECT COALESCE(${col}, 'unknown') AS value, COUNT(*)::int AS count
       FROM agents WHERE tenant_id=$1 ${clauses}
       GROUP BY 1 ORDER BY count DESC LIMIT 20`,
      [req.tenantId, ...params]
    );
    return r.rows;
  };

  const facets = {
    owner: await facetSql("owner"),
    model: await facetSql("model"),
    framework: await facetSql("framework"),
    cloud: await facetSql("cloud_provider"),
    category: await facetSql("category"),
    department: await facetSql("department"),
    ide: await facetSql("ide"),
    language: await facetSql("programming_language")
  };

  res.json({ results: result.rows, items: result.rows, agents: result.rows, facets, q });
}
