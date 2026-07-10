# AgentRadar Discovery & Visibility Blueprint

AgentRadar is an Enterprise AI Agent Discovery & Visibility platform: the asset intelligence layer for AI agents, agentic tools, AI runtime infrastructure, and the relationships that connect them. These blueprint documents are written for product, engineering, design, security, and go-to-market teams building a V1 discovery product and V2 visibility product without governance or remediation workflows in the initial scope.

## Blueprint Index

| # | Document | Description |
|---|---|---|
| 01 | [Product Vision](./01-product-vision.md) | Defines the market thesis, product boundaries, V1/V2 strategy, and discovery categories. |
| 02 | [Product Architecture](./02-product-architecture.md) | Describes C4 context/container architecture, services, data stores, and discovery-to-UI flow. |
| 03 | [User Personas](./03-user-personas.md) | Captures primary enterprise personas, jobs-to-be-done, success metrics, and access needs. |
| 04 | [User Journeys](./04-user-journeys.md) | Maps critical workflows from first discovery run through investigation, topology, search, and coverage gaps. |
| 05 | [Information Architecture](./05-information-architecture.md) | Defines the canonical object model for agents, devices, IDEs, models, tools, MCP servers, cloud, identity, repositories, and relationships. |
| 06 | [Navigation Structure](./06-navigation-structure.md) | Specifies the product navigation model for executive, operations, discovery, inventory, topology, search, and settings areas. |
| 07 | [UI Screens](./07-ui-screens.md) | Details each screen's purpose, widgets, filters, drill-down paths, export behavior, and realtime updates. |
| 08 | [UI Widgets](./08-ui-widgets.md) | Documents reusable enterprise UI components including KPI cards, facets, tables, graphs, timelines, streams, charts, maps, and drawers. |
| 09 | [Discovery Sources](./09-discovery-sources.md) | Catalogs every discovery source family and the source-specific evidence expected from connectors and sensors. |
| 10 | [Collector Architecture](./10-collector-architecture.md) | Defines endpoint, cloud, SaaS, browser, and API collectors plus deployment, health, and upgrade patterns. |
| 11 | [Normalization Pipeline](./11-normalization-pipeline.md) | Specifies ingestion, schema mapping, deduplication, confidence scoring, enrichment, and error handling. |
| 12 | [Agent Identity Resolution](./12-agent-identity-resolution.md) | Explains how AgentRadar resolves multiple signals into stable agent identities and relationship confidence. |
| 13 | [Graph Data Model](./13-graph-data-model.md) | Details Neo4j labels, relationships, indexes, traversal patterns, and graph query examples. |
| 14 | [Inventory Data Model](./14-inventory-data-model.md) | Defines PostgreSQL tables, OpenSearch indexes, tenancy, lifecycle states, and inventory API payloads. |
| 15 | [Search and Query](./15-search-and-query.md) | Describes global search, facet semantics, query language, saved searches, and exportable result sets. |
| 16 | [Topology and Relationship Mapping](./16-topology-and-relationship-mapping.md) | Specifies topology map behavior, graph layouts, relationship types, expansion rules, and investigation use cases. |
| 17 | [Telemetry and Events](./17-telemetry-and-events.md) | Defines discovery events, runtime visibility events, NATS topics, realtime subscriptions, and retention tiers. |
| 18 | [Data Governance Boundaries](./18-data-governance-boundaries.md) | Clarifies data handling, privacy controls, tenant isolation, retention, and the explicit exclusion of agent governance/remediation. |
| 19 | [Security and Access Control](./19-security-and-access-control.md) | Defines RBAC, SSO, audit trails, service authentication, secrets handling, and enterprise security controls. |
| 20 | [Integrations](./20-integrations.md) | Describes enterprise integrations for SIEM, CMDB, identity, EDR, cloud providers, developer platforms, and export destinations. |
| 21 | [API Specification](./21-api-specification.md) | Provides implementation-ready REST, streaming, and export API resources with payload examples and conventions. |
| 22 | [Backend Services](./22-backend-services.md) | Breaks down microservices, responsibilities, interfaces, scale assumptions, and failure modes. |
| 23 | [Frontend Architecture](./23-frontend-architecture.md) | Defines frontend app structure, state management, data fetching, visualization primitives, and performance patterns. |
| 24 | [Deployment Architecture](./24-deployment-architecture.md) | Specifies SaaS and customer-managed deployment topologies, environments, scaling, observability, and release strategy. |
| 25 | [Observability and Operations](./25-observability-and-operations.md) | Defines service SLOs, logs, metrics, traces, runbooks, alerting, and operational dashboards. |
| 26 | [Testing and Quality Strategy](./26-testing-and-quality-strategy.md) | Covers unit, integration, contract, graph, UI, load, security, and data quality testing. |
| 27 | [Performance and Scale](./27-performance-and-scale.md) | Sets scale targets, latency budgets, throughput modeling, caching, indexing, and degradation behavior. |
| 28 | [Implementation Plan](./28-implementation-plan.md) | Provides phased delivery milestones, workstreams, dependencies, acceptance criteria, and sequencing. |
| 29 | [UX Guidelines](./29-ux-guidelines.md) | Establishes enterprise UX rules for filtering, drill-down, realtime updates, exports, density, and accessibility. |
| 30 | [Roadmap](./30-roadmap.md) | Defines V1 Discovery, V2 Visibility depth, and later governance concepts that remain out of scope now. |

## Reading Paths

### Product and Executive

Start with [01-product-vision.md](./01-product-vision.md), then read [03-user-personas.md](./03-user-personas.md), [04-user-journeys.md](./04-user-journeys.md), [06-navigation-structure.md](./06-navigation-structure.md), and [30-roadmap.md](./30-roadmap.md).

### Engineering and Architecture

Start with [02-product-architecture.md](./02-product-architecture.md), then read [05-information-architecture.md](./05-information-architecture.md), [10-collector-architecture.md](./10-collector-architecture.md), [11-normalization-pipeline.md](./11-normalization-pipeline.md), [13-graph-data-model.md](./13-graph-data-model.md), [14-inventory-data-model.md](./14-inventory-data-model.md), [21-api-specification.md](./21-api-specification.md), and [22-backend-services.md](./22-backend-services.md).

### Design and Frontend

Start with [06-navigation-structure.md](./06-navigation-structure.md), [07-ui-screens.md](./07-ui-screens.md), [08-ui-widgets.md](./08-ui-widgets.md), [23-frontend-architecture.md](./23-frontend-architecture.md), and [29-ux-guidelines.md](./29-ux-guidelines.md).

### Security and Operations

Start with [18-data-governance-boundaries.md](./18-data-governance-boundaries.md), [19-security-and-access-control.md](./19-security-and-access-control.md), [24-deployment-architecture.md](./24-deployment-architecture.md), [25-observability-and-operations.md](./25-observability-and-operations.md), and [26-testing-and-quality-strategy.md](./26-testing-and-quality-strategy.md).

## Product Scope Statement

AgentRadar V1 answers: **What AI agents exist in the enterprise, where are they running, who owns them, what do they use, and how confident are we?**

AgentRadar V2 answers: **What are those agents doing over time, how are their relationships changing, and which runtime paths explain activity, cost, and exposure?**

AgentRadar does **not** initially answer: **How do we approve, block, remediate, govern, or enforce policy on agents?** Governance and remediation are intentionally deferred to later roadmap phases and must not leak into V1/V2 as product commitments.

## Documentation Conventions

- "Agent" means an autonomous or semi-autonomous AI system, coding agent, workflow agent, local agent process, SaaS agent, cloud-hosted agent runtime, browser extension agent, MCP-enabled assistant, or framework-defined agent.
- "Discovery" means asset identification and evidence collection without active enforcement.
- "Visibility" means timeline, relationship, activity, and telemetry intelligence without governance actions.
- "Confidence" means a scored representation of evidence quality and identity resolution certainty.
- "Coverage" means the measurable percentage of known environments, devices, repositories, clouds, SaaS tenants, and developer surfaces where discovery is active.

## Blueprint Principles

1. Discovery first: the product wins by finding agentic activity that customers cannot currently inventory.
2. Evidence over assertion: every object should trace back to source observations and timestamps.
3. Graph-native relationships: agents are valuable because of their connections to models, tools, identities, repos, clouds, and data paths.
4. Enterprise-grade trust: RBAC, auditability, tenant isolation, export, reliability, and clear data boundaries are product requirements.
5. No premature governance: avoid approval queues, kill switches, enforcement policies, or remediation workflows in V1/V2.
