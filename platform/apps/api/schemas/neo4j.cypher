// Visentra Neo4j constraints, indexes, and relationship model
// Source of truth aligned with docs/blueprint/10-graph-schema.md

// --- Uniqueness constraints (tenant-scoped) ---
CREATE CONSTRAINT agent_tenant_id IF NOT EXISTS FOR (a:Agent) REQUIRE (a.tenantId, a.id) IS UNIQUE;
CREATE CONSTRAINT developer_tenant_id IF NOT EXISTS FOR (d:Developer) REQUIRE (d.tenantId, d.id) IS UNIQUE;
CREATE CONSTRAINT device_tenant_id IF NOT EXISTS FOR (d:Device) REQUIRE (d.tenantId, d.id) IS UNIQUE;
CREATE CONSTRAINT ide_tenant_id IF NOT EXISTS FOR (i:IDE) REQUIRE (i.tenantId, i.id) IS UNIQUE;
CREATE CONSTRAINT model_tenant_id IF NOT EXISTS FOR (m:Model) REQUIRE (m.tenantId, m.id) IS UNIQUE;
CREATE CONSTRAINT provider_tenant_id IF NOT EXISTS FOR (p:Provider) REQUIRE (p.tenantId, p.id) IS UNIQUE;
CREATE CONSTRAINT tool_tenant_id IF NOT EXISTS FOR (t:Tool) REQUIRE (t.tenantId, t.id) IS UNIQUE;
CREATE CONSTRAINT mcp_tenant_id IF NOT EXISTS FOR (m:MCPServer) REQUIRE (m.tenantId, m.id) IS UNIQUE;
CREATE CONSTRAINT database_tenant_id IF NOT EXISTS FOR (d:Database) REQUIRE (d.tenantId, d.id) IS UNIQUE;
CREATE CONSTRAINT cloud_tenant_id IF NOT EXISTS FOR (c:CloudResource) REQUIRE (c.tenantId, c.id) IS UNIQUE;
CREATE CONSTRAINT api_tenant_id IF NOT EXISTS FOR (a:API) REQUIRE (a.tenantId, a.id) IS UNIQUE;
CREATE CONSTRAINT external_tenant_id IF NOT EXISTS FOR (e:ExternalService) REQUIRE (e.tenantId, e.id) IS UNIQUE;
CREATE CONSTRAINT repo_tenant_id IF NOT EXISTS FOR (r:Repository) REQUIRE (r.tenantId, r.id) IS UNIQUE;
CREATE CONSTRAINT container_tenant_id IF NOT EXISTS FOR (c:Container) REQUIRE (c.tenantId, c.id) IS UNIQUE;
CREATE CONSTRAINT cluster_tenant_id IF NOT EXISTS FOR (c:Cluster) REQUIRE (c.tenantId, c.id) IS UNIQUE;

// --- Indexes ---
CREATE INDEX agent_name IF NOT EXISTS FOR (a:Agent) ON (a.tenantId, a.name);
CREATE INDEX agent_category IF NOT EXISTS FOR (a:Agent) ON (a.tenantId, a.category);
CREATE INDEX agent_framework IF NOT EXISTS FOR (a:Agent) ON (a.tenantId, a.framework);
CREATE INDEX agent_last_seen IF NOT EXISTS FOR (a:Agent) ON (a.tenantId, a.lastSeen);

// --- Relationship types (documented; created at write time by the pipeline) ---
// OWNS            Developer → Agent
// USES_IDE        Developer → IDE
// RUNS_IN         Agent → IDE
// RUNS_ON         Agent → Device
// INVOKES_MODEL   Agent → Model
// PROVIDED_BY     Model → Provider
// USES_TOOL       Agent → Tool
// CONNECTS_MCP    Agent → MCPServer
// EXPOSES_TOOL    MCPServer → Tool
// READS_WRITES    Agent → Database
// DEPLOYED_IN     Agent → CloudResource | Container | Cluster
// CALLS           Agent → API
// ACCESSES        Agent → ExternalService
// SOURCED_FROM    Agent → Repository

// --- Sample MERGE pattern (reference for collectors / relationship worker) ---
// MERGE (a:Agent {tenantId: $tenantId, id: $agentId})
//   ON CREATE SET a.createdAt = datetime()
//   ON MATCH SET a.lastSeen = datetime()
// SET a.name = $name, a.category = $category, a.framework = $framework,
//     a.confidence = $confidence, a.sourceCollectors = $collectors
// WITH a
// MERGE (m:Model {tenantId: $tenantId, id: $modelKey})
//   ON CREATE SET m.createdAt = datetime()
// SET m.name = $modelName, m.lastSeen = datetime()
// MERGE (a)-[r:INVOKES_MODEL]->(m)
// SET r.confidence = $relConfidence, r.lastSeen = datetime(), r.source = $source

// --- Edge decay (relationship worker) ---
// MATCH ()-[r]->()
// WHERE r.lastSeen < datetime() - duration('P30D') AND coalesce(r.confidence, 1.0) < 0.4
// DELETE r
