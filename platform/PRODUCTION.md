# Production readiness checklist — AgentRadar Discovery MVP

AgentRadar is **agentless discovery & visibility**. This checklist is the minimum bar before a customer-facing production deploy.

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
SEED_ON_START=false
ALLOW_DEMO_SEED=false
```

- Demo collector is blocked in production unless `ALLOW_DEMO_SEED=true`.
- Default collectors exclude `demo` and `k8s_stub`.
- Admin password is **not** overwritten on API restart (insert-only bootstrap).

## 3. Azure deploy

```bash
cd platform/infra/azure
export BOOTSTRAP_ADMIN_EMAIL=admin@yourcompany.com
export BOOTSTRAP_ADMIN_PASSWORD='…'
export JWT_SECRET="$(openssl rand -hex 32)"
export ENCRYPTION_KEY="$(openssl rand -hex 32)"
export SEED_ON_START=false
./deploy.sh
```

`deploy.sh` will:
- Refuse a hardcoded default admin password
- Inject `ENCRYPTION_KEY` + `NODE_ENV=production`
- Lock `CORS_ORIGIN` to the deployed web FQDN
- Print the admin password once (not written to `.last-deploy.env`)

## 4. Local production-like compose

```bash
cd platform/infra/compose
cp .env.example .env   # fill secrets
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```

## 5. Post-deploy verification

1. `GET /health` → `status: ok`, `env: production`
2. `GET /ready` → `status: ready` (Postgres + Neo4j)
3. Login with bootstrap admin (empty inventory is expected)
4. Settings → Connectors → add Azure / EDR / SaaS → Test → Scan
5. Confirm Inventory / Shadow AI / Relationship Explorer populate from real connectors
6. Confirm login page has **no** prefilled credentials

## 6. Security posture (MVP)

| Control | Status |
|---------|--------|
| Required secrets at boot | Yes |
| Wildcard CORS blocked | Yes |
| Login rate limit | Yes (10/min/IP in prod) |
| Security headers (API + nginx) | Yes |
| Demo seed off by default | Yes |
| JWT in query string | SSE `/stream` + `/events` only in production |
| Connector secret encryption (AES-GCM) | Yes (`ENCRYPTION_KEY` required; legacy JWT key auto-migrated) |
| Persistent managed DB / Key Vault | Recommended next (see Should-fix) |

## 7. Operational notes

- **First-time `ENCRYPTION_KEY`**: set a new key and redeploy — API boot re-encrypts connectors still on the legacy JWT-derived key.
- **Rotating `ENCRYPTION_KEY` again** after migration requires decrypt with the old key (not automated) — re-save connectors or restore the previous key.
- Discovery worker authenticates as the bootstrap admin; prefer a dedicated operator account later.
- Azure Container Apps Postgres/Neo4j in this MVP are containerized — plan Flexible Server + backups for durable production data.
- Store admin password and keys in Azure Key Vault / your secret manager — not git.

## 8. Rollback

Redeploy previous image tags from ACR and restore prior Container App secret values. Inventory lives in Postgres; graph enrichment in Neo4j.
