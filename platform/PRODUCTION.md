# Production readiness checklist — AgentRadar Discovery

AgentRadar is **agentless discovery & visibility**. This checklist is the minimum bar before a customer-facing production deploy.

## Stage 1 — Production Discovery (required)

| Capability | Status in platform |
|---|---|
| Azure Database for PostgreSQL Flexible Server | `DATA_PLANE_MODE=production` in Bicep / install |
| Durable Neo4j (Azure Files volume) | Enabled in production data plane |
| Azure Key Vault for secrets | Created + secrets written on production install |
| Upgrade-safe secrets | `install.sh` + `deploy.sh` refuse auto-rotate on existing API app |
| Entra ID SSO (OIDC) | Optional via `ENTRA_TENANT_ID` / `ENTRA_CLIENT_ID` / `ENTRA_CLIENT_SECRET` |
| Live AWS / GCP discovery | Connectors + collectors |
| Live Kubernetes API collector | `k8s_api` + `kubernetes` connector |
| GitHub / GitLab + Entra identity | Connectors + collectors |
| Audit log | `/api/audit` + Settings → Audit Log |
| Coverage map | `/api/coverage` + Coverage Map UI |

## 1. Secrets (required)

| Variable | Rule |
|----------|------|
| `JWT_SECRET` | Strong random (`openssl rand -hex 32`). Never use the dev fallback. |
| `ENCRYPTION_KEY` | 64-char hex (`openssl rand -hex 32`). **Required in production.** Boot migrates legacy JWT-derived connector secrets onto this key once. |
| `BOOTSTRAP_ADMIN_PASSWORD` | Strong password; change after first login. |
| `POSTGRES_URL` / DB password | Unique per environment. |
| `NEO4J_PASSWORD` | Required when Neo4j is enabled. |
| `CORS_ORIGIN` | Exact web origin(s), comma-separated. **Never `*` in production.** |

Generate:

```bash
openssl rand -hex 32   # JWT_SECRET or ENCRYPTION_KEY
openssl rand -base64 24
```

## 2. Runtime flags

```bash
NODE_ENV=production
DATA_PLANE_MODE=production   # or eval for POC-only
SEED_ON_START=false
ALLOW_DEMO_SEED=false
```

Optional Entra SSO:

```bash
export ENTRA_TENANT_ID=…
export ENTRA_CLIENT_ID=…
export ENTRA_CLIENT_SECRET=…
# Redirect URI registered in Entra app: https://<web-fqdn>/login
```

## 3. Azure deploy

### Customer one-click (recommended)

```bash
cd platform/cloud-deploy
export DATA_PLANE_MODE=production   # default
./install.sh
```

Builds images in your Azure ACR (no local Docker). On **upgrade**, you must export the
original `JWT_SECRET`, `ENCRYPTION_KEY`, `POSTGRES_PASSWORD`, and admin password.
See [`cloud-deploy/README.md`](./cloud-deploy/README.md).

### Operator script (local Docker)

```bash
cd platform/infra/azure
export BOOTSTRAP_ADMIN_EMAIL=admin@yourcompany.com
export BOOTSTRAP_ADMIN_PASSWORD='…'
export JWT_SECRET="$(openssl rand -hex 32)"
export ENCRYPTION_KEY="$(openssl rand -hex 32)"
export DATA_PLANE_MODE=production
export SEED_ON_START=false
./deploy.sh
```

`deploy.sh` will:
- Refuse to auto-rotate secrets when an API app already exists in the RG
- Deploy Flexible Server + Key Vault + durable Neo4j when `DATA_PLANE_MODE=production`
- Inject `ENCRYPTION_KEY` + `NODE_ENV=production`
- Lock `CORS_ORIGIN` to the deployed web FQDN
- Print the admin password once (not written to `.last-deploy.env`)

### Eval / POC data plane

Set `DATA_PLANE_MODE=eval` to keep containerized Postgres/Neo4j (no Flexible Server).
Use only for demos — inventory can be lost on reschedule.

## 4. Local production-like compose

```bash
cd platform/infra/compose
cp .env.example .env   # fill secrets
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```

## 5. Post-deploy verification

1. `GET /health` → `status: ok`, `env: production`
2. `GET /ready` → postgres + neo4j ready
3. Login (local admin and/or Entra SSO)
4. Settings → Connectors → add cloud/EDR/SaaS/Git/K8s → Test
5. Start discovery → Coverage Map shows configured/covered sources
6. Settings → Audit Log shows connector and job actions

## 6. Still later (Stage 2 Visibility / Governance)

- Agent timelines & relationship history streams
- SIEM / CMDB outbound feeds
- Policy, approve/deny, remediation (explicitly out of Discovery scope)
