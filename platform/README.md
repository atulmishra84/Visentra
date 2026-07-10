# AgentRadar Discovery & Visibility Platform (MVP)

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

**Agentless platform.** No AgentRadar client is required on endpoints.

- **Default:** cloud / K8s / SaaS / git / CI / log / identity connectors (API credentials in Settings → Connectors).
- **Endpoint / IDE visibility:** integrate with the customer’s **EDR** (CrowdStrike, Defender/Intune, Cortex XDR, Netskope, etc.) and pull process/device evidence — do not deploy a proprietary local agent.

See [`docs/blueprint/01-product-vision.md`](../docs/blueprint/01-product-vision.md) and [`docs/blueprint/12-discovery-engine.md`](../docs/blueprint/12-discovery-engine.md).

## Azure deploy

```bash
az login --use-device-code
cd platform/infra/azure
./deploy.sh
# Opens a public Container Apps URL — see README in that folder
```

See [`platform/infra/azure/README.md`](./infra/azure/README.md).

## Quick start (local)

```bash
cd platform/infra/compose
docker compose up -d --build
```

- Web UI: http://localhost:5173
- API health: http://localhost:8080/health
- Neo4j browser: http://localhost:7474

Login: `admin@agentradar.local` / `AgentRadar!dev`

## Local API development

```bash
# Start dependencies
cd platform/infra/compose && docker compose up -d postgres neo4j redis nats

cd platform/apps/api
cp ../../schemas/postgres.sql ./schemas/postgres.sql   # already present
POSTGRES_URL=postgres://agentradar:agentradar@localhost:5433/agentradar \
NEO4J_URI=bolt://localhost:7687 NEO4J_USER=neo4j NEO4J_PASSWORD=agentradar \
JWT_SECRET=dev npm run dev
```

## Collectors (MVP)

- `demo` — rich multi-category seed inventory
- `ide_filesystem` — Cursor / Claude Desktop / Continue MCP configs
- `process` — Linux `/proc` heuristics (Ollama, LangGraph, CrewAI, …)
- `mcp` — MCP servers derived from IDE configs
- `cloud_stub` — optional stub (`DEMO_CLOUD=true`)
- `k8s_stub` — sample manifest directory scan

## Schemas

- [`schemas/postgres.sql`](./schemas/postgres.sql)
- [`schemas/neo4j.cypher`](./schemas/neo4j.cypher)
- [`schemas/openapi.yaml`](./schemas/openapi.yaml)
