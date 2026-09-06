# Visentra Discovery & Visibility Platform (MVP)

Greenfield implementation of the Discovery & Visibility track. See the engineering blueprint in [`docs/blueprint/`](../docs/blueprint/).

## Stack

| Component | Tech |
|-----------|------|
| Web | React 18 + TypeScript + Vite + React Flow |
| API | Node.js 20 + Express |
| Discovery worker | Node.js scheduler triggering API collectors |
| Postgres | Inventory, observations, jobs, events |
| Neo4j | Topology graph projection |
| Redis / NATS / OpenSearch | Provisioned in compose for production-parity; MVP search uses Postgres facets |

## Discovery posture

**Agentless platform.** No Visentra client is required on endpoints.

- **Default:** cloud / K8s / SaaS / git / CI / log / identity connectors (API credentials in Settings → Connectors).
- **Endpoint / IDE visibility:** integrate with the customer’s **EDR** (CrowdStrike, Defender/Intune, Cortex XDR, Netskope, etc.) and pull process/device evidence — do not deploy a proprietary local agent.
- **SaaS / platform agents:** connect Microsoft 365 Copilot, Salesforce Agentforce, Workday Illuminate, and ServiceNow Now Assist via Settings → Connectors, then **Scan SaaS platforms**.
- **IAM / SSO:** Settings → IAM & SSO connects any OpenID Connect IdP (Entra, Okta, Auth0, Ping, Keycloak, Google, OneLogin, or custom issuer). Env `ENTRA_*` remains supported.

See [`docs/blueprint/01-product-vision.md`](../docs/blueprint/01-product-vision.md) and [`docs/blueprint/12-discovery-engine.md`](../docs/blueprint/12-discovery-engine.md).

## Azure deploy (customer cloud — one click)

Install Visentra into **your Azure subscription** (no local Docker required):

```bash
cd platform/cloud-deploy
./install.sh
```

See [`platform/cloud-deploy/README.md`](./cloud-deploy/README.md).

### Operator path (local Docker)

```bash
az login --use-device-code
cd platform/infra/azure
export BOOTSTRAP_ADMIN_PASSWORD='…strong…'
export JWT_SECRET="$(openssl rand -hex 32)"
export ENCRYPTION_KEY="$(openssl rand -hex 32)"
./deploy.sh
```

See [`platform/infra/azure/README.md`](./infra/azure/README.md) and [`PRODUCTION.md`](./PRODUCTION.md).

## Quick start (local)

```bash
cd platform/infra/compose
docker compose up -d --build
```

- Web UI: http://localhost:5172
- API health: http://localhost:8080/health
- API ready: http://localhost:8080/ready
- Neo4j browser: http://localhost:7474

**Local/dev login:** set `BOOTSTRAP_ADMIN_EMAIL` / `BOOTSTRAP_ADMIN_PASSWORD` (defaults in compose).  
**Local / production:** inventory comes from connectors and live discovery only (`DISCOVERY_DEMO_SEED` is off). See [`PRODUCTION.md`](./PRODUCTION.md).

### Production-like local stack

```bash
cd platform/infra/compose
cp .env.example .env   # fill secrets
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```

## Local API development

```bash
# Start dependencies
cd platform/infra/compose && docker compose up -d postgres neo4j redis nats

cd platform/apps/api
POSTGRES_URL=postgres://agentradar:agentradar@localhost:5433/agentradar \
NEO4J_URI=bolt://localhost:7687 NEO4J_USER=neo4j NEO4J_PASSWORD=agentradar \
JWT_SECRET=dev npm run dev
```

## Collectors

- `ide_filesystem` / `process` / `mcp` — local host IDE, process, and MCP signals
- `cloud_stub` — Azure / AWS / GCP connector discovery
- `edr` / `saas_platform` / `ci_platform` — endpoint, SaaS, and CI agent discovery
- `k8s_api` / `git_sources` / `identity_entra` — workload, repo, and identity candidates
- `ide_filesystem` — Cursor / Claude Desktop / Continue MCP configs
- `process` — Linux `/proc` heuristics (Ollama, LangGraph, CrewAI, …)
- `mcp` — MCP servers derived from IDE configs
- `cloud_stub` — live Azure/AWS/GCP via Settings → Connectors
- `k8s_api` — live Kubernetes API via connector
- `git_sources` — GitHub / GitLab
- `identity_entra` — Entra ID enrichment
- `edr` / `saas_platform` — EDR and SaaS platform connectors
- `ci_platform` — Jenkins / CI AI job signals

## Schemas

- [`schemas/postgres.sql`](./schemas/postgres.sql)
- [`schemas/neo4j.cypher`](./schemas/neo4j.cypher)
- [`schemas/openapi.yaml`](./schemas/openapi.yaml)
