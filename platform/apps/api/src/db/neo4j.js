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

/** Cypher node labels / relationship types. Returns null when the token is unsafe to interpolate. */
export function cypherIdent(value) {
  const s = String(value || "");
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(s) ? s : null;
}

const SCHEMA_STATEMENTS = [
  "CREATE CONSTRAINT agent_tenant_id IF NOT EXISTS FOR (a:Agent) REQUIRE (a.tenantId, a.id) IS UNIQUE",
  "CREATE CONSTRAINT developer_tenant_id IF NOT EXISTS FOR (d:Developer) REQUIRE (d.tenantId, d.id) IS UNIQUE",
  "CREATE CONSTRAINT device_tenant_id IF NOT EXISTS FOR (d:Device) REQUIRE (d.tenantId, d.id) IS UNIQUE",
  "CREATE CONSTRAINT ide_tenant_id IF NOT EXISTS FOR (i:IDE) REQUIRE (i.tenantId, i.id) IS UNIQUE",
  "CREATE CONSTRAINT model_tenant_id IF NOT EXISTS FOR (m:Model) REQUIRE (m.tenantId, m.id) IS UNIQUE",
  "CREATE CONSTRAINT provider_tenant_id IF NOT EXISTS FOR (p:Provider) REQUIRE (p.tenantId, p.id) IS UNIQUE",
  "CREATE CONSTRAINT tool_tenant_id IF NOT EXISTS FOR (t:Tool) REQUIRE (t.tenantId, t.id) IS UNIQUE",
  "CREATE CONSTRAINT mcp_tenant_id IF NOT EXISTS FOR (m:MCPServer) REQUIRE (m.tenantId, m.id) IS UNIQUE",
  "CREATE CONSTRAINT database_tenant_id IF NOT EXISTS FOR (d:Database) REQUIRE (d.tenantId, d.id) IS UNIQUE",
  "CREATE CONSTRAINT cloud_tenant_id IF NOT EXISTS FOR (c:CloudResource) REQUIRE (c.tenantId, c.id) IS UNIQUE",
  "CREATE CONSTRAINT api_tenant_id IF NOT EXISTS FOR (a:API) REQUIRE (a.tenantId, a.id) IS UNIQUE",
  "CREATE CONSTRAINT external_tenant_id IF NOT EXISTS FOR (e:ExternalService) REQUIRE (e.tenantId, e.id) IS UNIQUE",
  "CREATE CONSTRAINT repo_tenant_id IF NOT EXISTS FOR (r:Repository) REQUIRE (r.tenantId, r.id) IS UNIQUE",
  "CREATE CONSTRAINT container_tenant_id IF NOT EXISTS FOR (c:Container) REQUIRE (c.tenantId, c.id) IS UNIQUE",
  "CREATE CONSTRAINT cluster_tenant_id IF NOT EXISTS FOR (c:Cluster) REQUIRE (c.tenantId, c.id) IS UNIQUE",
  "CREATE INDEX agent_name IF NOT EXISTS FOR (a:Agent) ON (a.tenantId, a.name)",
  "CREATE INDEX agent_category IF NOT EXISTS FOR (a:Agent) ON (a.tenantId, a.category)",
  "CREATE INDEX agent_framework IF NOT EXISTS FOR (a:Agent) ON (a.tenantId, a.framework)",
  "CREATE INDEX agent_last_seen IF NOT EXISTS FOR (a:Agent) ON (a.tenantId, a.lastSeen)"
];

export async function waitForNeo4j({ attempts = 30, delayMs = 2000 } = {}) {
  if (!neo4jDriver) return;
  let ready = false;
  let lastError = null;
  for (let i = 0; i < attempts; i++) {
    const session = neo4jDriver.session();
    try {
      await session.run("RETURN 1 AS ok");
      ready = true;
      break;
    } catch (err) {
      lastError = err;
      await new Promise((r) => setTimeout(r, delayMs));
    } finally {
      await session.close();
    }
  }
  if (!ready) {
    const detail = lastError?.message ? `: ${lastError.message}` : "";
    throw new Error(`Neo4j unavailable after ${(attempts * delayMs) / 1000}s (NEO4J_URI is set)${detail}`);
  }
}

export async function initNeo4jConstraints() {
  if (!neo4jDriver) return;
  const session = neo4jDriver.session();
  try {
    for (const s of SCHEMA_STATEMENTS) {
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
