# 26. Data Flow Diagrams

These diagrams show how AgentRadar data moves from discovery sources into observations, entity resolution, relationships, search, dashboards, and realtime UI updates.

Related: [12-discovery-engine.md](./12-discovery-engine.md), [13-visibility-engine.md](./13-visibility-engine.md), [14-relationship-engine.md](./14-relationship-engine.md), [15-search-architecture.md](./15-search-architecture.md), [27-discovery-workflow.md](./27-discovery-workflow.md).

## Observation ingest

```mermaid
flowchart LR
  SRC[Cloud/Git/K8s/IDE/MCP/LLM/Logs] --> COL[Collector]
  COL --> REDACT[Redact secrets]
  REDACT --> NORM[Normalize]
  NORM --> VALID[Validate schema]
  VALID --> BUS[(Observation topic)]
  VALID --> REJ[(Reject store)]
  BUS --> OBS[(Observation store)]
  BUS --> RES[Entity resolver]
  BUS --> PROG[Job progress projection]
```

| Stage | Input | Output |
|---|---|---|
| Collect | Source payload/event | Raw collector payload. |
| Redact | Raw payload | Safe metadata payload. |
| Normalize | Safe payload | Observation envelope. |
| Validate | Observation | Accepted event or rejection. |
| Persist | Event | Immutable observation row. |

## Entity resolution

```mermaid
flowchart TD
  O[Observation] --> K[Identity key extraction]
  K --> C[Candidate lookup]
  C --> S[Similarity scoring]
  S --> D{Decision}
  D -- strong/weak match --> U[Update entity]
  D -- no match --> N[Create entity]
  D -- probable duplicate --> P[Duplicate candidate]
  D -- conflict --> X[Resolution conflict]
  U --> F[Field merge]
  N --> F
  F --> EV[Evidence links]
  EV --> OUT[Inventory events]
  OUT --> REL[Relationship inference]
  OUT --> VIS[Visibility projections]
  OUT --> IDX[Search queue]
```

Stores: `observations`, `entities`, `entity_aliases`, `entity_field_evidence`, `resolution_decisions`, `duplicate_candidates`.

## Relationship inference

```mermaid
flowchart LR
  OBS[Observation facts] --> FACT[Candidate edge facts]
  ENT[Entity updates] --> FACT
  FACT --> RULES[Rule registry]
  RULES --> SCORE[Confidence scoring]
  SCORE --> EDGE[(Canonical edge store)]
  EDGE --> DECAY[Scheduled decay]
  EDGE --> GRAPH[Graph projection]
  EDGE --> SEARCH[Relationship docs]
  EDGE --> SSE[Graph delta events]
```

## Search indexing

```mermaid
flowchart TD
  INV[Inventory projection] --> Q[Index queue]
  EDGE[Relationship projection] --> Q
  PROMPT[Prompt metadata] --> Q
  Q --> BUILD[Document builder]
  BUILD --> JOIN[Join facets]
  JOIN --> VALID[Mapping validation]
  VALID --> BULK[Bulk indexer]
  BULK --> OS[(OpenSearch)]
  BULK --> DLQ[(Index DLQ)]
  OS --> API[Search API]
```

Index inputs include owner, model, framework, cloud, repo, tool, prompt, language, department, risk, hostname, project, BU, graph degree, confidence, and recency.

## Realtime fanout

```mermaid
flowchart LR
  BUS[(Domain event bus)] --> SF[Streaming service]
  SF --> AUTH[Topic authorization]
  AUTH --> REDIS[(Redis replay stream)]
  AUTH --> FAN[Connection fanout]
  FAN --> C1[Browser SSE]
  FAN --> C2[Browser SSE]
  FAN --> C3[Browser SSE]
```

SSE flow:

1. Consume tenant-partitioned domain event.
2. Validate session/topic authorization.
3. Store recent event in Redis replay stream.
4. Send `event`, `id`, and JSON `data`.
5. Replay from `Last-Event-ID` on reconnect or fall back to REST polling.

## Dashboard aggregation

```mermaid
flowchart TD
  INV[Inventory events] --> ROLL[Rollup workers]
  EDGE[Graph events] --> ROLL
  JOB[Discovery job events] --> ROLL
  SEARCH[Search telemetry] --> ROLL
  ROLL --> HOURLY[(Hourly rollups)]
  ROLL --> DAILY[(Daily rollups)]
  ROLL --> CACHE[(Dashboard cache)]
  CACHE --> API[Dashboard APIs]
  HOURLY --> API
  DAILY --> API
```

## Export flow

```mermaid
flowchart LR
  REQ[Export request] --> JOB[(Export job)]
  JOB --> WORK[Export worker]
  WORK --> SRC[Inventory/Search/Graph query]
  SRC --> FILE[CSV/JSON/Parquet writer]
  FILE --> OBJ[(Object storage)]
  OBJ --> META[Artifact metadata]
  META --> EVT[export.completed]
  EVT --> SSE[SSE notification]
```

## Implementation checklist

- Define schemas for every event boundary.
- Include entity versions and idempotency keys in stream consumers.
- Add DLQs for rejects, conflicts, and index failures.
- Add replay commands for resolver, relationship, search, graph, and dashboards.
- Add end-to-end tests that trace one synthetic observation to UI-facing APIs.
