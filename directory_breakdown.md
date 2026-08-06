# Visentra — Complete Directory Breakdown

> **Project Type**: AI Agent Observability & Governance Platform  
> **Stack**: Node.js backend, React/TypeScript frontend, PostgreSQL + Neo4j databases, Docker + Kubernetes deployment  
> **Architecture**: Monorepo with a legacy root-level app + a newer `platform/` monorepo

---

## Root Level Files

| File | Purpose |
|---|---|
| `server.js` (19 KB) | Root-level API server (legacy/standalone version of the backend) |
| `index.html` (29 KB) | Root-level frontend entry (legacy standalone frontend bundle) |
| `package.json` | Root-level Node.js manifest |
| `Dockerfile` | Root-level Docker image for the standalone deployment |
| `docker-compose.yml` | Multi-service local dev compose setup |
| `nginx.conf` | Nginx reverse-proxy config for the root-level app |
| `.env.example` | Environment variable template |
| `.gitignore` | Git ignore rules |
| `push-and-deploy.sh` (10 KB) | Shell script for pushing images & triggering deployments |
| `CHANGE_SUMMARY.md` | Changelog summary |
| `DEPLOYMENT_GUIDE.md` | Deployment instructions |
| `KNOWN_LIMITATIONS.md` | Known issues and limitations |
| `PROJECT_STRUCTURE.md` | Project structure reference |
| `RELEASE_NOTES.md` | Release notes |

---

## `.github/` — CI/CD Pipeline

```
.github/
└── workflows/
    └── deploy.yml          # GitHub Actions pipeline (17 KB) — full CI/CD workflow
```

The single workflow file handles image building, pushing to container registry, and deploying to Kubernetes.

---

## `bicep/` — Azure Bicep IaC

Infrastructure-as-Code using Azure Bicep for Azure resource provisioning.

```
bicep/
├── modules/
│   └── aks.bicep           # AKS cluster module (3.4 KB)
└── standalone/
    ├── main.bicep          # Main deployment template (7.4 KB)
    └── params.bicepparam   # Deployment parameters (2.6 KB)
```

- **`modules/aks.bicep`** — Reusable AKS cluster definition
- **`standalone/main.bicep`** — Full standalone Azure deployment (combines networking, AKS, ACR, etc.)
- **`standalone/params.bicepparam`** — Parameter values for the standalone deployment

---

## `certs/` — TLS Certificates

```
certs/
└── README.md               # Instructions for certificate placement
```

Placeholder directory for TLS/SSL certificates. The README explains where to place certs for local HTTPS dev.

---

## `customer-deploy/` — Customer Deployment Package

```
customer-deploy/
└── README.md               # Minimal customer-facing deployment guide (94 bytes)
```

Placeholder or stub for customer-specific deployment assets.

---

## `deploy/` — Containerized Service Definitions

Three independently containerized services for the **legacy/standalone** version of the platform:

```
deploy/
├── api/
│   ├── server.js           # Standalone API server (116 KB — very large)
│   ├── Dockerfile
│   ├── package.json
│   └── .dockerignore
├── frontend/
│   ├── agentRadarLaunch.html   # Bundled single-file frontend (761 KB!)
│   ├── Dockerfile
│   ├── nginx.conf
│   └── PLACE_agentRadarLaunch.html.txt  # Placement instruction note
└── webhook/
    ├── webhook.js          # Webhook listener service (2.5 KB)
    ├── Dockerfile
    └── package.json
```

> [!NOTE]
> The `agentRadarLaunch.html` (761 KB) is a fully self-contained, single-file HTML bundle — the entire frontend compiled into one file for easy customer distribution.

---

## `docs/` — Product Documentation

```
docs/
├── DEPLOYMENT.md           # Deployment guide (9.5 KB)
└── blueprint/              # 51 markdown files — comprehensive product blueprint
```

### `docs/blueprint/` — Product Blueprint (51 files)

Extremely detailed product and engineering specifications. Split into two parallel numbering tracks:

#### Track A — Core Architecture Docs
| File | Topic |
|---|---|
| `01-product-vision.md` | Vision & goals |
| `02-product-architecture.md` | Overall architecture |
| `03-user-personas.md` | Target user personas |
| `04-user-journeys.md` | User journey maps |
| `05-information-architecture.md` | IA & site map |
| `06-navigation-structure.md` | Navigation design |
| `07-ui-screens.md` | UI screen inventory |
| `08-ui-widgets.md` | Reusable UI widgets |
| `09-database-schema.md` | DB schema design |
| `10-collector-architecture.md` | Agent/data collector arch |
| `11-apis.md` | API specifications |
| `12-agent-identity-resolution.md` | Agent identity dedup logic |
| `13-graph-data-model.md` | Graph DB data model |
| `14-inventory-data-model.md` | Inventory data model |
| `15-search-and-query.md` | Search & query design |
| `16-backend-services.md` | Backend service breakdown |
| `17-frontend-components.md` | Frontend component design |
| `18-deployment-architecture.md` | Deployment patterns |
| `19-kubernetes-deployment.md` | Kubernetes specifics |
| `20-aws.md` | AWS integration |
| `21-azure.md` | Azure integration |
| `22-gcp.md` | GCP integration |
| `23-security-architecture.md` | Security design |
| `24-api-specifications.md` | Detailed API specs |
| `25-sequence-diagrams.md` | Sequence diagrams |
| `26-data-flow-diagrams.md` | Data flow diagrams |
| `27-discovery-workflow.md` | Discovery engine workflow |
| `28-ui-wireframes.md` | UI wireframe specs |
| `29-ux-guidelines.md` | UX design guidelines |
| `30-roadmap.md` | Product roadmap |

#### Track B — Discovery & Data Engine Docs (parallel numbering 09–27)
| File | Topic |
|---|---|
| `09-discovery-sources.md` | Sources for agent discovery |
| `10-graph-schema.md` | Graph schema |
| `11-normalization-pipeline.md` | Data normalization pipeline |
| `12-discovery-engine.md` | Discovery engine design |
| `13-visibility-engine.md` | Visibility engine |
| `14-relationship-engine.md` | Relationship mapping engine |
| `15-search-architecture.md` | Search architecture |
| `16-topology-and-relationship-mapping.md` | Topology mapping |
| `17-telemetry-and-events.md` | Telemetry & events |
| `18-data-governance-boundaries.md` | Data governance |
| `19-security-and-access-control.md` | Access control |
| `20-integrations.md` | Third-party integrations |
| `21-api-specification.md` | API spec (alternate) |
| `22-backend-services.md` | Backend services (alternate) |
| `23-frontend-architecture.md` | Frontend architecture |
| `24-deployment-architecture.md` | Deployment (alternate) |
| `25-observability-and-operations.md` | Observability & ops |
| `26-testing-and-quality-strategy.md` | QA strategy |
| `27-performance-and-scale.md` | Performance & scale |
| `28-implementation-plan.md` | Implementation plan |

---

## `helm/` — Kubernetes Helm Chart

```
helm/
└── agentRadar/
    ├── Chart.yaml          # Helm chart metadata
    ├── values.yaml         # Default values (5 KB)
    └── templates/
        ├── api.yaml        # API service K8s manifest (5.9 KB)
        ├── frontend.yaml   # Frontend service K8s manifest (2.3 KB)
        └── ingress.yaml    # Ingress controller config (1.25 KB)
```

Standard Helm chart for deploying the "agentRadar" application to Kubernetes. Contains Deployment, Service, and Ingress resources.

---

## `migrations/` — Database Migrations

Sequential SQL migration files for the **root-level** PostgreSQL schema:

```
migrations/
├── 001_schema.sql          # Initial schema (9.6 KB)
├── 002_webhooks_activity.sql   # Webhooks & activity tables (2.3 KB)
├── 003_tenant_isolation.sql    # Row-level security & tenant isolation (3.6 KB)
└── 004_migration_tracking.sql  # Migration tracking table (275 bytes)
```

---

## `platform/` — New Monorepo Architecture

The newer, more structured monorepo. Contains multiple apps and shared packages.

```
platform/
├── package.json            # Monorepo root manifest
├── package-lock.json
├── PRODUCTION.md           # Production ops guide (4.5 KB)
├── apps/
│   ├── api/                # Platform API server
│   ├── discovery/          # Discovery microservice
│   ├── relationship/       # Relationship engine microservice
│   └── web/                # React/TypeScript frontend
├── cloud-deploy/
│   ├── azure/              # Azure Bicep deploy scripts
│   └── compose/            # Docker Compose for cloud
├── infra/
│   └── azure/              # Azure infra scripts
├── packages/
│   └── shared/             # Shared utilities package
└── schemas/
    ├── neo4j.cypher        # Neo4j graph schema (3.5 KB)
    ├── openapi.yaml        # OpenAPI 3.0 spec (15.5 KB)
    └── postgres.sql        # PostgreSQL schema (13.5 KB)
```

### `platform/apps/api/` — Platform API Server

```
platform/apps/api/
├── Dockerfile
├── package.json
├── .env.example            # 1 KB env template
├── schemas/
│   ├── neo4j.cypher        # Graph schema copy (3.5 KB)
│   └── postgres.sql        # SQL schema copy (13 KB)
└── src/
    ├── config.js           # App config (3 KB)
    ├── index.js            # Main Express app (72 KB — very large)
    ├── meshConstants.js    # Mesh/topology constants
    ├── migrate.js          # DB migration runner (7 KB)
    ├── auth/
    │   ├── entra.js        # Microsoft Entra ID (Azure AD) auth (1.5 KB)
    │   └── oidc.js         # Generic OIDC auth handler (13.5 KB)
    ├── discovery/          # 14 discovery collectors
    │   ├── agentEvidence.js    # Agent evidence collection (8 KB)
    │   ├── aiRelevance.js      # AI relevance scoring (4.8 KB)
    │   ├── awsCloud.js         # AWS discovery (17 KB)
    │   ├── azureArm.js         # Azure ARM discovery (7.8 KB)
    │   ├── ciPlatforms.js      # CI/CD platform discovery (15.6 KB)
    │   ├── collectors.js       # Collector orchestrator (39 KB)
    │   ├── edrIntegrations.js  # EDR (CrowdStrike, etc.) discovery (36 KB)
    │   ├── entraIdentity.js    # Entra identity discovery (8 KB)
    │   ├── evidenceCorrelation.js  # Evidence correlation (3.4 KB)
    │   ├── gcpCloud.js         # GCP discovery (14 KB)
    │   ├── gitSources.js       # GitHub/GitLab discovery (13 KB)
    │   ├── k8sApi.js           # Kubernetes API discovery (7.3 KB)
    │   ├── pipeline.js         # Discovery pipeline orchestrator (15.8 KB)
    │   └── saasPlatforms.js    # SaaS tool discovery (33 KB)
    ├── services/           # 8 business logic services
    │   ├── agentDepth.js   # Agent depth/risk analysis (60 KB — largest file)
    │   ├── aiBom.js        # AI Bill of Materials (41 KB)
    │   ├── audit.js        # Audit logging service (1.3 KB)
    │   ├── connectors.js   # Connector management (18 KB)
    │   ├── coverage.js     # Agent coverage reporting (4.3 KB)
    │   ├── shadowAi.js     # Shadow AI detection (8 KB)
    │   ├── ssoProviders.js # SSO provider management (11 KB)
    │   └── usageAnalytics.js   # Usage analytics (22 KB)
    └── utils/
        ├── crypto.js       # Cryptographic utilities (4.8 KB)
        └── http.js         # HTTP client utilities (8 KB)
```

### `platform/apps/discovery/` — Discovery Microservice

```
platform/apps/discovery/
├── Dockerfile
├── package.json
└── src/
    └── index.js            # Discovery service entry (2.5 KB)
```

Lightweight standalone discovery microservice (likely delegates to API discovery modules).

### `platform/apps/relationship/` — Relationship Engine Microservice

```
platform/apps/relationship/
├── Dockerfile
├── package.json
└── src/
    └── index.js            # Relationship engine entry (2.1 KB)
```

Standalone microservice for graph relationship computation (Neo4j-backed).

### `platform/apps/web/` — React/TypeScript Frontend

```
platform/apps/web/
├── Dockerfile
├── package.json
├── tsconfig.json
├── vite.config.ts          # Vite bundler config
├── index.html              # HTML entry point
├── nginx.conf / nginx.conf.template
├── public/
│   └── theme-boot.js       # Theme bootstrap script (runs before React)
├── dist/                   # Built production bundle
│   ├── index.html
│   ├── theme-boot.js
│   └── assets/
│       ├── index-C-myQMG9.js   # Bundled JS (493 KB)
│       └── index-CeskG6NL.css  # Bundled CSS (48 KB)
└── src/
    ├── App.tsx             # Root React component & routing (4 KB)
    ├── main.tsx            # React entry point
    ├── vite-env.d.ts
    ├── components/         # 8 shared UI components
    │   ├── AgentAnatomyPanel.tsx   # Agent detail anatomy panel (16 KB)
    │   ├── DataTable.tsx           # Reusable data table (3 KB)
    │   ├── DetailDrawer.tsx        # Side drawer for details (1.3 KB)
    │   ├── FacetBar.tsx            # Faceted search/filter bar (3.8 KB)
    │   ├── GraphSeedBar.tsx        # Graph seed selection bar (3.2 KB)
    │   ├── KpiCard.tsx             # KPI metric card (473 bytes)
    │   ├── Layout.tsx              # App shell / layout (7.8 KB)
    │   └── TopologyGraph.tsx       # Interactive topology graph (9.5 KB)
    ├── lib/                # Shared libraries
    │   ├── api.ts          # API client (8.4 KB)
    │   ├── auth.tsx        # Auth context/hooks (4.4 KB)
    │   ├── mesh.ts         # Mesh data utilities (1.4 KB)
    │   └── theme.ts        # Theme management (1.3 KB)
    ├── pages/              # 20 page components
    │   ├── AgentDetailPage.tsx         # Individual agent details (19 KB)
    │   ├── AiBomPage.tsx               # AI Bill of Materials view (26 KB)
    │   ├── AuditPage.tsx               # Audit log viewer (2.5 KB)
    │   ├── ConnectorsPage.tsx          # Connector management (20 KB)
    │   ├── CoveragePage.tsx            # Coverage reporting (8.9 KB)
    │   ├── DiscoveryChangesPage.tsx    # Discovery delta/changes (7.7 KB)
    │   ├── DiscoveryDashboardPage.tsx  # Discovery overview (7.4 KB)
    │   ├── DiscoveryEventsPage.tsx     # Discovery event log (3.3 KB)
    │   ├── ExecutiveDashboardPage.tsx  # Executive-level KPI dashboard (14 KB)
    │   ├── InventoryPage.tsx           # Agent inventory list (16 KB)
    │   ├── LoginPage.tsx               # Login/auth page (9 KB)
    │   ├── MeshPage.tsx                # Agent mesh topology view (8.7 KB)
    │   ├── OperationsDashboardPage.tsx # Ops dashboard (7.2 KB)
    │   ├── RelationshipExplorerPage.tsx # Graph relationship explorer (7.9 KB)
    │   ├── SearchPage.tsx              # Global search (5.2 KB)
    │   ├── ShadowAiPage.tsx            # Shadow AI detection view (6.8 KB)
    │   ├── SsoSettingsPage.tsx         # SSO configuration (14.9 KB)
    │   ├── TimelinePage.tsx            # Timeline view (2.2 KB)
    │   ├── TopologyMapPage.tsx         # Topology map (5.7 KB)
    │   └── UsageDashboardPage.tsx      # Usage analytics dashboard (14.9 KB)
    └── styles/
        └── global.css      # Global stylesheet (49 KB — comprehensive)
```

### `platform/cloud-deploy/`

```
platform/cloud-deploy/
├── azure/
│   ├── .env.example
│   ├── deploy.sh           # Azure deployment script (13 KB)
│   └── main.bicep          # Bicep template (9 KB)
└── compose/
    ├── .env.example
    ├── docker-compose.yml      # Full local stack (3.9 KB)
    └── docker-compose.prod.yml # Production compose (1.5 KB)
```

### `platform/infra/`

```
platform/infra/
└── azure/
    ├── .env.example
    ├── README.md
    ├── deploy.sh           # Infrastructure provisioning script (13 KB)
    └── main.bicep          # Azure resource template (8.9 KB)
```

### `platform/packages/shared/`

```
platform/packages/shared/
├── package.json
└── src/
    └── index.js            # Shared utilities (2.2 KB)
```

Shared utilities package consumed by other platform apps.

### `platform/schemas/`

```
platform/schemas/
├── neo4j.cypher    # Neo4j graph schema (3.5 KB)
├── openapi.yaml    # Full OpenAPI 3.0 spec (15.5 KB)
└── postgres.sql    # PostgreSQL schema (13.5 KB)
```

Canonical schema definitions for the platform.

---

## `scripts/` — Utility Scripts

```
scripts/
├── migrate.js              # Database migration runner script (1.4 KB)
└── setup-github-secrets.sh # GitHub Actions secrets setup (8.8 KB)
```

---

## `sql/` — Standalone SQL Schema

```
sql/
└── schema.sql              # Root-level schema (5.4 KB) — for standalone deployment
```

---

## `src/` — Root-Level Backend Source

Supporting modules for the root-level `server.js`:

```
src/
├── config/
│   └── index.js            # Config loader (1.8 KB)
├── middleware/
│   ├── auth.js             # Authentication middleware (1.7 KB)
│   ├── rateLimit.js        # Rate limiting middleware (1.7 KB)
│   └── tenant.js           # Tenant context middleware (646 bytes)
├── models/
│   ├── db.js               # PostgreSQL connection model (894 bytes)
│   └── redis.js            # Redis connection model (1.1 KB)
├── services/
│   ├── audit.js            # Audit log service (1.6 KB)
│   ├── discovery.js        # Discovery service (10.5 KB)
│   ├── mfa.js              # MFA service (1.9 KB)
│   ├── phi.js              # PHI handling service (2.2 KB)
│   ├── reports.js          # Reporting service (2.9 KB)
│   ├── risk.js             # Risk scoring service (2.4 KB)
│   └── siem.js             # SIEM integration service (2.3 KB)
└── utils/
    └── crypto.js           # Crypto utility (1.2 KB)
```

---

## `terraform/` — Terraform IaC

Modular Terraform configuration for Azure cloud provisioning:

```
terraform/
├── standalone/
│   ├── main.tf                 # Root Terraform config (5.5 KB)
│   ├── variables.tf            # Input variables (4.7 KB)
│   ├── outputs.tf              # Output values (1.1 KB)
│   └── terraform.tfvars.example    # Example variable values (4 KB)
└── modules/
    ├── acr/
    │   └── main.tf             # Azure Container Registry module (663 bytes)
    ├── aks/
    │   └── main.tf             # Azure Kubernetes Service module (3.6 KB)
    ├── keyvault/
    │   └── main.tf             # Azure Key Vault module (3 KB)
    ├── monitoring/
    │   └── main.tf             # Monitoring/Log Analytics module (2 KB)
    ├── networking/
    │   └── main.tf             # VNet/subnet module (8.4 KB — most complex)
    ├── postgres/
    │   └── main.tf             # Flexible PostgreSQL module (2.2 KB)
    ├── redis/
    │   └── main.tf             # Azure Cache for Redis module (1.2 KB)
    └── shared/
        └── main.tf             # Shared resources module (6.9 KB)
```

---

## Summary — Project Architecture

```
Visentra/
├── 📦 Root (Legacy Standalone App)
│   ├── server.js + index.html      → Single-process server + bundled UI
│   ├── sql/ + migrations/          → Database schemas & migrations
│   └── src/                        → Backend modules (middleware, services)
│
├── 🚀 platform/ (New Monorepo)
│   ├── apps/api/                   → Full-featured Node.js REST API
│   ├── apps/discovery/             → Discovery microservice
│   ├── apps/relationship/          → Relationship engine microservice
│   ├── apps/web/                   → React + TypeScript + Vite frontend
│   ├── packages/shared/            → Shared utilities
│   └── schemas/                    → Canonical DB/API schemas
│
├── 🏗️ Infrastructure
│   ├── terraform/                  → Azure IaC (modular Terraform)
│   ├── bicep/                      → Azure IaC (Bicep alternative)
│   ├── helm/agentRadar/            → Kubernetes Helm chart
│   └── deploy/                     → Standalone Docker service definitions
│
├── 🔄 CI/CD
│   └── .github/workflows/deploy.yml
│
└── 📚 Documentation
    └── docs/blueprint/             → 51-file comprehensive product blueprint
```

### Key Observations

1. **Dual Architecture**: The project has a **legacy standalone** app (root `server.js` + `deploy/`) and a newer **platform monorepo** (`platform/`) — suggesting active migration.
2. **Scale of Documentation**: 51 blueprint files in `docs/blueprint/` indicate a heavily documented, design-first project.
3. **Multi-Cloud IaC**: Both **Terraform** and **Azure Bicep** exist — one may be preferred/in transition.
4. **Discovery Engine**: The largest code surface area — 14 collectors across AWS, Azure, GCP, Kubernetes, GitHub, Okta, CrowdStrike, SaaS platforms, and CI/CD systems.
5. **Dual Databases**: PostgreSQL for relational data + Neo4j for graph relationships — a common pattern for topology/relationship platforms.
6. **Largest Files**: `agentDepth.js` (60 KB), `aiBom.js` (41 KB), `collectors.js` (39 KB), `edrIntegrations.js` (36 KB) — business-critical complexity lives in the API service layer.
