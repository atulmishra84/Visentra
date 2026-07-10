# 25. Sequence Diagrams

Primary AgentRadar interactions are shown below. APIs are defined in [11-apis.md](./11-apis.md); data flows are expanded in [26-data-flow-diagrams.md](./26-data-flow-diagrams.md).

## Login

```mermaid
sequenceDiagram
  autonumber
  participant UI as React SPA
  participant GW as API Gateway
  participant AUTH as Auth Service
  participant IDP as OIDC/SAML IdP
  participant TEN as Tenant Service
  participant REDIS as Redis
  UI->>GW: GET /api/v1/auth/oidc/start
  GW->>AUTH: Start auth flow
  AUTH-->>GW: Redirect URL + state
  GW-->>UI: 302 IdP
  UI->>IDP: Authenticate
  IDP-->>UI: Callback code/assertion
  UI->>GW: GET /api/v1/auth/oidc/callback
  GW->>AUTH: Validate callback
  AUTH->>IDP: Exchange code / validate signature
  IDP-->>AUTH: Claims
  AUTH->>TEN: Resolve memberships/roles
  TEN-->>AUTH: Tenant permissions
  AUTH->>REDIS: Store session/refresh metadata
  AUTH-->>GW: Session/access token
  GW-->>UI: Current user and tenant context
```

## Discovery job

```mermaid
sequenceDiagram
  autonumber
  participant UI as React SPA
  participant GW as API Gateway
  participant DISC as Discovery Orchestrator
  participant DB as PostgreSQL
  participant BUS as Event Bus
  participant COL as Collector Worker
  participant INV as Inventory Service
  participant REL as Relationship Service
  participant SSE as Streaming Service
  UI->>GW: POST /api/v1/discovery/jobs
  GW->>DISC: Create job with tenant scope
  DISC->>DB: Insert job/partitions/counters
  DISC->>BUS: Publish collector tasks
  DISC-->>GW: 202 job accepted
  GW-->>UI: DiscoveryJob
  BUS-->>COL: Collector task
  COL->>BUS: observation.normalized + job progress
  BUS-->>INV: observation.normalized
  INV->>DB: Persist observation and resolve entity
  INV->>BUS: inventory.entity.created/updated
  BUS-->>REL: Entity/observation facts
  REL->>DB: Upsert edges
  REL->>BUS: graph.edge.created/updated
  BUS-->>SSE: Job/inventory/graph events
  SSE-->>UI: SSE progress and deltas
```

## Agent detail load

```mermaid
sequenceDiagram
  autonumber
  participant UI as AgentDetailPage
  participant GW as API Gateway
  participant CACHE as Redis Cache
  participant INV as Inventory Service
  participant REL as Relationship Service
  participant GRAPH as Graph Service
  UI->>GW: GET /api/v1/agents/{agentId}
  GW->>CACHE: Read detail projection
  alt cache hit
    CACHE-->>GW: Agent detail
  else cache miss
    GW->>INV: Load canonical detail
    INV-->>GW: Agent detail
    GW->>CACHE: Store projection
  end
  GW-->>UI: Agent detail
  UI->>GW: GET /api/v1/agents/{agentId}/relationships
  GW->>REL: Direct relationships
  REL-->>GW: Edge summaries
  GW-->>UI: Dependency panels
  UI->>GW: GET /api/v1/graph/neighborhood?seed={agentId}&depth=1
  GW->>GRAPH: Mini graph
  GRAPH-->>GW: Nodes/edges
  GW-->>UI: Graph preview
```

## Graph expand

```mermaid
sequenceDiagram
  autonumber
  participant UI as GraphCanvas
  participant GW as API Gateway
  participant GRAPH as Graph Service
  participant GDB as Graph Store
  participant REL as Relationship Service
  UI->>GW: GET /api/v1/graph/neighborhood?seed=A&depth=2
  GW->>GW: Authorize and validate limits
  GW->>GRAPH: Execute traversal
  GRAPH->>GDB: Tenant-scoped neighborhood query
  alt projection available
    GDB-->>GRAPH: Nodes/edges
  else fallback
    GRAPH->>REL: Recursive edge query
    REL-->>GRAPH: Nodes/edges
  end
  GRAPH-->>GW: GraphNeighborhood
  GW-->>UI: Nodes and edges
  UI->>UI: Merge into canvas layout
```

## Search

```mermaid
sequenceDiagram
  autonumber
  participant UI as SearchPage
  participant GW as API Gateway
  participant SEARCH as Search Handler
  participant OS as OpenSearch
  UI->>GW: POST /api/v1/search/query
  GW->>SEARCH: Tenant-scoped request
  SEARCH->>SEARCH: Compile filters/facets/cursor
  SEARCH->>OS: Query with tenant filter
  OS-->>SEARCH: Hits/highlights/aggs
  SEARCH-->>GW: SearchResponse
  GW-->>UI: Result cards and facets
  UI->>GW: GET /api/v1/search/suggest?q=contr
  GW->>OS: Completion query
  OS-->>GW: Suggestions
  GW-->>UI: Typeahead
```

## Export

```mermaid
sequenceDiagram
  autonumber
  participant UI as Export Dialog
  participant GW as API Gateway
  participant DB as PostgreSQL
  participant BUS as Event Bus
  participant WORK as Export Worker
  participant OBJ as Object Storage
  participant SSE as Streaming Service
  UI->>GW: POST /api/v1/export/jobs
  GW->>DB: Insert export job
  GW->>BUS: export.requested
  GW-->>UI: 202 queued
  BUS-->>WORK: Export task
  WORK->>DB: Query tenant-scoped data
  WORK->>OBJ: Write encrypted artifact
  WORK->>DB: Mark complete
  WORK->>BUS: export.completed
  BUS-->>SSE: Export event
  SSE-->>UI: Export ready
```
