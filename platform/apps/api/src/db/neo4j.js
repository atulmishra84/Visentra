import neo4j from "neo4j-driver";
import { IS_PROD } from "../config.js";

let neo4jDriver = null;

try {
  if (process.env.NEO4J_URI) {
    if (IS_PROD && !process.env.NEO4J_PASSWORD) {
      throw new Error("NEO4J_PASSWORD is required in production when NEO4J_URI is set");
    }
    neo4jDriver = neo4j.driver(
      process.env.NEO4J_URI,
      neo4j.auth.basic(process.env.NEO4J_USER || "neo4j", process.env.NEO4J_PASSWORD || "agentradar")
    );
  }
} catch (err) {
  console.warn("Neo4j driver init failed:", err.message);
  if (IS_PROD) throw err;
}

export { neo4jDriver };

export async function initNeo4jConstraints() {
  if (!neo4jDriver) return;
  const session = neo4jDriver.session();
  try {
    const statements = [
      "CREATE CONSTRAINT agent_tenant_id IF NOT EXISTS FOR (a:Agent) REQUIRE (a.tenantId, a.id) IS UNIQUE",
      "CREATE CONSTRAINT developer_tenant_id IF NOT EXISTS FOR (d:Developer) REQUIRE (d.tenantId, d.id) IS UNIQUE",
      "CREATE INDEX agent_name IF NOT EXISTS FOR (a:Agent) ON (a.tenantId, a.name)"
    ];
    for (const s of statements) {
      try {
        await session.run(s);
      } catch (err) {
        console.warn("Neo4j constraint:", err.message);
      }
    }
  } finally {
    await session.close();
  }
}
