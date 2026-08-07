export async function purgeDemoInventory(pool, neo4jDriver, tenantId) {
  const { rows } = await pool.query(
    `SELECT id FROM agents WHERE tenant_id=$1 AND metadata->>'demoSeed' = 'true'`,
    [tenantId]
  );
  if (!rows.length) return;
  const ids = rows.map((r) => r.id);
  await pool.query(`DELETE FROM relationships WHERE tenant_id=$1 AND (from_id = ANY($2::uuid[]) OR to_id = ANY($2::uuid[]))`, [
    tenantId,
    ids
  ]);
  await pool.query(`DELETE FROM agent_observations WHERE tenant_id=$1 AND agent_id = ANY($2::uuid[])`, [tenantId, ids]);
  await pool.query(`DELETE FROM agents WHERE tenant_id=$1 AND id = ANY($2::uuid[])`, [tenantId, ids]);
  console.log(`Purged ${ids.length} legacy demo agent(s)`);

  if (neo4jDriver) {
    const session = neo4jDriver.session();
    try {
      await session.run(
        `MATCH (a:Agent {tenantId: $tenantId})
         WHERE a.id IN $ids
         DETACH DELETE a`,
        { tenantId, ids }
      );
    } catch (err) {
      console.warn("Neo4j demo purge:", err.message);
    } finally {
      await session.close();
    }
  }
}

export async function purgeNonAiInventory(pool, neo4jDriver, tenantId) {
  if (process.env.DISCOVERY_AI_ONLY !== "true") return;

  const { rows } = await pool.query(
    `SELECT id FROM agents
     WHERE tenant_id=$1
       AND (metadata->>'aiRelevant' IS NULL OR metadata->>'aiRelevant' != 'true')
       AND category != 'model'
       AND category != 'framework'
       AND category != 'llm'`,
    [tenantId]
  );
  if (!rows.length) return;

  const ids = rows.map((r) => r.id);
  await pool.query(`DELETE FROM relationships WHERE tenant_id=$1 AND (from_id = ANY($2::uuid[]) OR to_id = ANY($2::uuid[]))`, [
    tenantId,
    ids
  ]);
  await pool.query(`DELETE FROM agent_observations WHERE tenant_id=$1 AND agent_id = ANY($2::uuid[])`, [tenantId, ids]);
  await pool.query(`DELETE FROM agents WHERE tenant_id=$1 AND id = ANY($2::uuid[])`, [tenantId, ids]);
  console.log(`Purged ${ids.length} non-AI agent(s) (AI-only discovery mode)`);

  if (neo4jDriver) {
    const session = neo4jDriver.session();
    try {
      await session.run(
        `MATCH (a:Agent {tenantId: $tenantId})
         WHERE a.id IN $ids
         DETACH DELETE a`,
        { tenantId, ids }
      );
    } catch (err) {
      console.warn("Neo4j non-AI purge:", err.message);
    } finally {
      await session.close();
    }
  }
}
