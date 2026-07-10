# 13 - Graph Data Model

## Overview

AgentRadar uses Neo4j for graph-native relationship queries and topology exploration. The graph stores current and historical relationships among agents, agent instances, devices, IDEs, models, tools, MCP servers, cloud resources, containers, SaaS apps, identities, repositories, frameworks, sources, and evidence.

## Node Labels

| Label | Description |
|---|---|
| `TenantScoped` | Base label for tenant-isolated nodes. |
| `Agent` | Canonical agent. |
| `AgentInstance` | Runtime instance. |
| `Device` | Endpoint/server/runner host. |
| `IDE` | IDE environment. |
| `Model` | Model artifact or endpoint. |
| `ModelProvider` | Provider or gateway. |
| `Tool` | Callable tool. |
| `MCPServer` | MCP server. |
| `CloudAccount` | Cloud account/subscription/project. |
| `CloudResource` | Cloud resource. |
| `ContainerWorkload` | Container workload/image context. |
| `SaaSApp` | SaaS tenant/app. |
| `BrowserExtension` | Browser extension. |
| `Identity` | Human/service/group/workload identity. |
| `Repository` | Source repository. |
| `Framework` | Agent framework. |
| `Source` | Collector/connector/source. |
| `Evidence` | Evidence reference node when graph evidence expansion is needed. |

## Relationship Types

| Relationship | Direction | Purpose |
|---|---|---|
| `HAS_INSTANCE` | Agent -> AgentInstance | Agent runtime instances. |
| `RUNS_ON` | AgentInstance -> Device/CloudResource | Runtime host. |
| `RUNS_IN` | AgentInstance -> ContainerWorkload | Container context. |
| `OBSERVED_IN` | Agent -> IDE/SaaSApp/BrowserExtension | Observation context. |
| `USES_MODEL` | Agent -> Model | Model usage/configuration. |
| `PROVIDED_BY` | Model -> ModelProvider | Provider relationship. |
| `USES_TOOL` | Agent -> Tool | Agent capability/use. |
| `CONNECTS_TO_MCP_SERVER` | Agent -> MCPServer | MCP connection. |
| `EXPOSES_TOOL` | MCPServer -> Tool | MCP tool exposure. |
| `DEFINED_IN_REPO` | Agent -> Repository | Source definition. |
| `DEPENDS_ON_FRAMEWORK` | Agent/Repository -> Framework | Framework signal. |
| `OWNED_BY` | Agent/Repository/MCPServer -> Identity | Ownership. |
| `EXECUTES_AS` | AgentInstance -> Identity | Runtime identity. |
| `ASSIGNED_TO` | Device -> Identity | Device assignment. |
| `BELONGS_TO_ACCOUNT` | CloudResource -> CloudAccount | Cloud hierarchy. |
| `DISCOVERED_BY` | Entity -> Source | Provenance. |
| `EVIDENCED_BY` | Entity/Relationship -> Evidence | Evidence backing. |

## Common Properties

### Node Properties

- `id`
- `tenant_id`
- `display_name`
- `type`
- `status`
- `confidence`
- `first_seen_at`
- `last_seen_at`
- `updated_at`

### Edge Properties

- `relationship_id`
- `tenant_id`
- `confidence`
- `first_seen_at`
- `last_seen_at`
- `status`
- `source_count`
- `evidence_count`
- `relationship_hash`

## Indexes and Constraints

```cypher
CREATE CONSTRAINT tenant_entity_id IF NOT EXISTS
FOR (n:TenantScoped)
REQUIRE (n.tenant_id, n.id) IS UNIQUE;

CREATE INDEX agent_lookup IF NOT EXISTS
FOR (a:Agent)
ON (a.tenant_id, a.status, a.last_seen_at);

CREATE INDEX identity_lookup IF NOT EXISTS
FOR (i:Identity)
ON (i.tenant_id, i.email);

CREATE INDEX model_lookup IF NOT EXISTS
FOR (m:Model)
ON (m.tenant_id, m.model_name);
```

## Traversal Patterns

### Agent Neighborhood

```cypher
MATCH (a:Agent {tenant_id: $tenantId, id: $agentId})-[r]-(n:TenantScoped)
WHERE r.status = 'active'
RETURN a, r, n
LIMIT 500
```

### Agents Using MCP Server

```cypher
MATCH (a:Agent {tenant_id: $tenantId})-[r:CONNECTS_TO_MCP_SERVER]->(m:MCPServer {id: $mcpServerId})
RETURN a, r, m
ORDER BY r.last_seen_at DESC
```

### Identity Blast Radius

```cypher
MATCH (i:Identity {tenant_id: $tenantId, id: $identityId})<-[:OWNED_BY|EXECUTES_AS]-(x)
OPTIONAL MATCH (x)-[r]-(n)
RETURN i, x, r, n
LIMIT 1000
```

## Graph Update Rules

- Upserts are idempotent by tenant, relationship type, from, to, and relationship hash.
- Edge confidence can increase or decrease based on fresh evidence.
- Stale edges remain with status `stale` until retention rules remove or archive them.
- High-cardinality expansions should return grouped summaries by default.

## Historical Relationships

Current graph supports active topology. Relationship history should be recorded in PostgreSQL/OpenSearch timeline and optionally projected into Neo4j with temporal properties for time-sliced graph queries.

## Related Documents

- [05-information-architecture.md](./05-information-architecture.md)
- [16-topology-and-relationship-mapping.md](./16-topology-and-relationship-mapping.md)
- [21-api-specification.md](./21-api-specification.md)
