# 28 - Implementation Plan

## Overview

This implementation plan sequences AgentRadar delivery from foundation to V1 Discovery and V2 Visibility depth. The plan intentionally excludes governance and remediation workflows.

## Workstreams

| Workstream | Scope |
|---|---|
| Platform Foundation | Tenancy, auth, RBAC, service framework, deployment. |
| Data Pipeline | Ingestion, normalization, identity resolution, graph/search projection. |
| Collectors | Endpoint, repo, cloud, container, SaaS, MCP, browser, local LLM. |
| Inventory UI | Tables, detail pages, evidence, export. |
| Topology UI | Graph map, relationship explorer, edge evidence. |
| Discovery Ops | Runs, collector health, coverage, data quality. |
| Search/Export | Query language, facets, saved searches, export jobs. |
| Visibility V2 | Timelines, runtime events, relationship history, usage trends. |

## Phase 0: Foundations

### Deliverables

- Tenant model.
- Authentication and RBAC.
- PostgreSQL baseline schema.
- NATS event backbone.
- Service templates.
- Object storage integration.
- Audit event baseline.

### Acceptance Criteria

- Authenticated user can access tenant-scoped API.
- Services publish/consume test events.
- Audit events record login and export placeholder actions.

## Phase 1: Core Discovery Pipeline

### Deliverables

- Observation ingestion.
- Raw evidence storage.
- Normalization framework.
- Canonical entity tables.
- Agent identity resolution baseline.
- Inventory change events.

### Acceptance Criteria

- Fixture observations create canonical agents.
- Evidence references link to every key field.
- Reprocessing is idempotent.

## Phase 2: Initial Sources

### Recommended First Sources

1. Repository framework discovery.
2. IDE/MCP config discovery.
3. Endpoint local process/config discovery.
4. Cloud/container metadata discovery.

### Deliverables

- Source parsers and fixtures.
- Collector enrollment.
- Collector health.
- Discovery run UI.
- Data quality UI.

## Phase 3: Inventory and Search

### Deliverables

- Agent inventory table.
- Agent detail.
- Evidence drawer.
- OpenSearch indexing.
- Global search.
- Facets.
- Saved searches.
- Export jobs.

### Acceptance Criteria

- User can find, inspect, and export discovered agents.
- Search results match canonical inventory.
- Export includes metadata and audit event.

## Phase 4: Graph and Topology

### Deliverables

- Neo4j projection.
- Relationship APIs.
- Topology map.
- Relationship Explorer.
- Edge evidence.

### Acceptance Criteria

- One-hop agent topology loads with evidence-backed edges.
- MCP/model/repo/identity relationships are explorable.

## Phase 5: Discovery Coverage and Enterprise Integrations

### Deliverables

- Coverage Map.
- Collector fleet view.
- Cloud/SaaS/repo integration expansion.
- SIEM/CMDB/data lake export integrations.

### Acceptance Criteria

- Platform Engineer can identify coverage gaps.
- CISO can export coverage report.

## Phase 6: V1 Launch Readiness

### Deliverables

- Executive dashboard.
- Operations workbench.
- Audit/export hardening.
- Load testing.
- Security testing.
- Documentation and runbooks.

### V1 Acceptance Criteria

- Discovery covers required categories for launch scope.
- Inventory is searchable/exportable.
- Topology supports core relationships.
- Coverage gaps are visible.
- No governance/remediation workflows are present.

## Phase 7: V2 Visibility Depth

### Deliverables

- Agent timelines.
- Relationship history.
- Runtime visibility events where connectors support them.
- Usage trends.
- Activity density.
- Realtime investigation views.

### V2 Acceptance Criteria

- Users can understand what changed over time.
- Timelines connect events to evidence and relationships.
- Visibility remains read-only and does not enforce policy.

## Delivery Risks

| Risk | Mitigation |
|---|---|
| Source breadth delays V1 | Start with high-signal sources and extensible connector framework. |
| False merges reduce trust | Conservative identity resolution and confidence explanations. |
| Graph scale issues | Limit depth, grouping, query budgets. |
| Privacy concerns | Metadata defaults, redaction, evidence RBAC. |
| UI complexity | Reusable tables, filters, drawers, charts, graph components. |

## Related Documents

- [01-product-vision.md](./01-product-vision.md)
- [02-product-architecture.md](./02-product-architecture.md)
- [30-roadmap.md](./30-roadmap.md)
