# AgentRadar Discovery & Visibility Blueprint

Implementation-ready engineering blueprint for the world's first Enterprise AI Agent Discovery & Visibility Platform.

**Scope:** Discover · Inventory · Relationship Mapping · Visibility · Observability · Asset Intelligence  
**Out of scope (for now):** Governance · Remediation · Security enforcement

Working MVP code lives in [`platform/`](../../platform/). Schema sources of truth: [`platform/schemas/`](../../platform/schemas/).

## Canonical deliverables (30)

| # | Document | Description |
|---|---|---|
| 01 | [Product Vision](./01-product-vision.md) | Market thesis, V1 Discovery / V2 Visibility, discovery categories |
| 02 | [Product Architecture](./02-product-architecture.md) | C4, microservices, data stores, end-to-end flow |
| 03 | [User Personas](./03-user-personas.md) | CISO, SecOps, Platform, AI Platform, Developer, Auditor |
| 04 | [User Journeys](./04-user-journeys.md) | Discovery, investigate, topology, search/export, coverage |
| 05 | [Information Architecture](./05-information-architecture.md) | Canonical object model and attributes |
| 06 | [Navigation Structure](./06-navigation-structure.md) | Product navigation for all dashboards |
| 07 | [UI Screens](./07-ui-screens.md) | Every screen: filters, drill-down, export, realtime |
| 08 | [UI Widgets](./08-ui-widgets.md) | KPI, facets, tables, graph, timelines, streams |
| 09 | [Database Schema](./09-database-schema.md) | PostgreSQL schema (see `platform/schemas/postgres.sql`) |
| 10 | [Graph Schema](./10-graph-schema.md) | Neo4j labels/edges (see `platform/schemas/neo4j.cypher`) |
| 11 | [APIs](./11-apis.md) | REST resource map with examples |
| 12 | [Discovery Engine](./12-discovery-engine.md) | Collectors, scheduling, confidence, dedup |
| 13 | [Visibility Engine](./13-visibility-engine.md) | Projections, SSE, coverage, dashboards |
| 14 | [Relationship Engine](./14-relationship-engine.md) | Edge inference, confidence, decay |
| 15 | [Search Architecture](./15-search-architecture.md) | OpenSearch indices and facets |
| 16 | [Backend Services](./16-backend-services.md) | Microservice catalog |
| 17 | [Frontend Components](./17-frontend-components.md) | React component inventory |
| 18 | [Deployment Architecture](./18-deployment-architecture.md) | HA, scaling, SaaS vs BYOC |
| 19 | [Kubernetes Deployment](./19-kubernetes-deployment.md) | Helm chart design |
| 20 | [AWS Deployment](./20-aws.md) | EKS reference architecture |
| 21 | [Azure Deployment](./21-azure.md) | AKS reference architecture |
| 22 | [GCP Deployment](./22-gcp.md) | GKE reference architecture |
| 23 | [Security Architecture](./23-security-architecture.md) | Authn/z, SSO, RBAC, isolation |
| 24 | [API Specifications](./24-api-specifications.md) | Conventions + OpenAPI (`platform/schemas/openapi.yaml`) |
| 25 | [Sequence Diagrams](./25-sequence-diagrams.md) | Login, discovery, graph, search |
| 26 | [Data Flow Diagrams](./26-data-flow-diagrams.md) | Ingest, resolve, index, fanout |
| 27 | [Discovery Workflow](./27-discovery-workflow.md) | Scan → normalize → graph → UI |
| 28 | [UI Wireframes](./28-ui-wireframes.md) | Wireframes for primary screens |
| 29 | [UX Guidelines](./29-ux-guidelines.md) | Enterprise filtering, drill-down, export |
| 30 | [Roadmap](./30-roadmap.md) | V1/V2 and deferred governance |

## Supplementary deep-dives

Additional design notes produced during blueprint authoring (non-canonical numbering overlaps may exist; prefer the table above):

- Discovery sources, collectors, normalization, identity resolution
- Inventory/graph data model elaborations, topology mapping, telemetry
- Integrations, observability, testing, performance, implementation plan

See files such as `09-discovery-sources.md`, `10-collector-architecture.md`, `13-graph-data-model.md`, `14-inventory-data-model.md`, `25-observability-and-operations.md`, `28-implementation-plan.md`.

## MVP quick start

```bash
cd platform/infra/compose
docker compose up -d --build
# Web: http://localhost:5172  API: http://localhost:8080/health
```

Default admin: `admin@agentradar.local` / `AgentRadar!dev`

Local compose enables `DISCOVERY_DEMO_SEED=true` so the inventory boots with multi-category sample agents (IDE, framework, cloud, MCP, SaaS, local LLM). Production deploys must leave demo seed off.
