// AgentRadar Neo4j constraints and indexes
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

CREATE INDEX agent_name IF NOT EXISTS FOR (a:Agent) ON (a.tenantId, a.name);
CREATE INDEX agent_category IF NOT EXISTS FOR (a:Agent) ON (a.tenantId, a.category);
CREATE INDEX agent_framework IF NOT EXISTS FOR (a:Agent) ON (a.tenantId, a.framework);
