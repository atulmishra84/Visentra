# 10 — Graph Database Schema (Neo4j)

Canonical graph model for Visentra topology. Source of truth: [`platform/schemas/neo4j.cypher`](../../platform/schemas/neo4j.cypher).

Related: [09-database-schema.md](./09-database-schema.md), [14-relationship-engine.md](./14-relationship-engine.md), [13-visibility-engine.md](./13-visibility-engine.md), [13-graph-data-model.md](./13-graph-data-model.md).

## Purpose

Persist clickable, auto-updating relationships:

```
Developer → IDE → Agent → Model → Tool → MCP Server → Database → Cloud → API → External Services
```

Neo4j is the system of record for multi-hop topology. PostgreSQL mirrors edges for tabular export and inventory joins.

## Node labels

| Label | Key properties | Description |
|-------|----------------|-------------|
| `Tenant` | `id` | Isolation root |
| `Developer` | `id`, `email`, `name`, `department`, `businessUnit` | Human owner/operator |
| `Device` | `id`, `hostname`, `os`, `ip` | Endpoint / workstation |
| `IDE` | `id`, `name`, `version` | Cursor, VS Code, JetBrains, … |
| `Agent` | `id`, `name`, `category`, `framework`, `confidence` | Discovered AI agent |
| `Model` | `id`, `name`, `provider`, `version` | LLM / embedding model |
| `Provider` | `id`, `name` | openai, anthropic, azure, … |
| `Tool` | `id`, `name` | Function/tool the agent can invoke |
| `MCPServer` | `id`, `name`, `transport` | MCP server endpoint |
| `MCPClient` | `id`, `name` | MCP client host |
| `Database` | `id`, `name`, `engine` | Vector or operational DB |
| `CloudResource` | `id`, `name`, `provider`, `region`, `resourceType` | Cloud AI / compute |
| `API` | `id`, `name`, `baseUrl` | HTTP API dependency |
| `ExternalService` | `id`, `name`, `category` | Slack, GitHub, SaaS |
| `Repository` | `id`, `name`, `url` | Source repo |
| `Container` | `id`, `name`, `image` | Container workload |
| `Cluster` | `id`, `name`, `provider` | K8s / OpenShift / Nomad |

All nodes include: `tenantId`, `lastSeen`, `createdAt`, `sourceCollectors` (list).

## Relationship types

| Type | From → To | Meaning |
|------|-----------|---------|
| `OWNS` | Developer → Agent | Ownership |
| `USES_IDE` | Developer → IDE | Developer uses IDE |
| `RUNS_IN` | Agent → IDE | Agent hosted in IDE |
| `RUNS_ON` | Agent → Device | Agent process on device |
| `INVOKES_MODEL` | Agent → Model | Model calls |
| `PROVIDED_BY` | Model → Provider | Model vendor |
| `USES_TOOL` | Agent → Tool | Tool use |
| `CONNECTS_MCP` | Agent → MCPServer | MCP connection |
| `EXPOSES_TOOL` | MCPServer → Tool | MCP tool surface |
| `READS_WRITES` | Agent → Database | Data access |
| `DEPLOYED_IN` | Agent → CloudResource / Container / Cluster | Deployment |
| `CALLS` | Agent → API | Outbound API |
| `ACCESSES` | Agent → ExternalService | SaaS / external |
| `SOURCED_FROM` | Agent → Repository | Code origin |
| `CONTAINS` | Cluster → Container | Orchestration |

Relationship properties: `confidence` (0–1), `lastSeen`, `evidence` (JSON string), `jobId`.

## Constraints & indexes

```cypher
CREATE CONSTRAINT agent_id IF NOT EXISTS FOR (a:Agent) REQUIRE (a.tenantId, a.id) IS UNIQUE;
CREATE CONSTRAINT developer_id IF NOT EXISTS FOR (d:Developer) REQUIRE (d.tenantId, d.id) IS UNIQUE;
CREATE CONSTRAINT device_id IF NOT EXISTS FOR (d:Device) REQUIRE (d.tenantId, d.id) IS UNIQUE;
CREATE CONSTRAINT ide_id IF NOT EXISTS FOR (i:IDE) REQUIRE (i.tenantId, i.id) IS UNIQUE;
CREATE CONSTRAINT model_id IF NOT EXISTS FOR (m:Model) REQUIRE (m.tenantId, m.id) IS UNIQUE;
CREATE CONSTRAINT mcp_id IF NOT EXISTS FOR (m:MCPServer) REQUIRE (m.tenantId, m.id) IS UNIQUE;
CREATE INDEX agent_name IF NOT EXISTS FOR (a:Agent) ON (a.tenantId, a.name);
CREATE INDEX agent_category IF NOT EXISTS FOR (a:Agent) ON (a.tenantId, a.category);
```

## Example traversals

### Agent blast neighborhood (2 hops)

```cypher
MATCH (a:Agent {tenantId: $tenantId, id: $agentId})
OPTIONAL MATCH path = (a)-[*1..2]-(n)
WHERE n.tenantId = $tenantId
RETURN path
LIMIT 200;
```

### Developer → External Services chain

```cypher
MATCH (d:Developer {tenantId: $tenantId})-[:OWNS|USES_IDE*1..2]->(a:Agent)
      -[:INVOKES_MODEL|USES_TOOL|CONNECTS_MCP|CALLS|ACCESSES*1..3]->(x)
WHERE d.email = $email
RETURN DISTINCT labels(x)[0] AS type, x.name AS name, x.id AS id;
```

## Projection rules

1. Every resolved agent upsert writes/merges an `:Agent` node.
2. Relationship engine emits edges with confidence ≥ threshold (default 0.4).
3. Edges decay: if `lastSeen` older than retention window, mark `stale:true` then delete after grace period.
4. UI topology API reads Neo4j; SSE pushes edge/node deltas after each discovery job.

## Multi-tenancy

Every query MUST filter `tenantId`. Never return cross-tenant paths. Prefer separate databases per large BYOC customer; shared SaaS uses property isolation + query guards.
