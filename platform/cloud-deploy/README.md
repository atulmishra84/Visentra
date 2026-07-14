# Visentra Cloud Deploy Package

> **Evaluation / POC path.** This installer deploys Postgres, Redis, and Neo4j as
> Container Apps **without persistent volumes or managed backups**. Inventory and
> connector secrets metadata can be lost on reschedule. For production, use Azure
> Database for PostgreSQL Flexible Server (+ backups), Key Vault, and Entra ID SSO
> — see [`../PRODUCTION.md`](../PRODUCTION.md).

One-click install of **Visentra Discovery & Visibility** into **your Azure subscription** (customer cloud / BYOC).

## Data plane modes

| `DATA_PLANE_MODE` | What you get |
|---|---|
| **`production`** (default) | Azure Database for PostgreSQL Flexible Server (7-day backups), Key Vault secrets, Neo4j on Azure Files |
| **`eval`** | Containerized Postgres/Neo4j (POC only — data can be lost on reschedule) |

## What you get

| Component | Azure resource |
|-----------|----------------|
| Web UI | Container App (public HTTPS) |
| API | Container App (internal, proxied via web `/api`) |
| Discovery worker | Container App |
| Postgres | Flexible Server (production) or Container App (eval) |
| Neo4j | Container App (+ Azure Files volume in production) |
| Redis | Container App |
| Secrets | Key Vault (production) |
| Image registry | Azure Container Registry |

Images are built **inside your Azure ACR** (`az acr build`) — **no local Docker daemon required**.

## Prerequisites

1. [Azure CLI](https://aka.ms/installazurecli) installed
2. An Azure subscription where you have **Contributor** (or equivalent)
3. Bash + `openssl` + `python3` (macOS / Linux / WSL / Cloud Shell)

## One-click install

```bash
cd platform/cloud-deploy
chmod +x install.sh teardown.sh
export DATA_PLANE_MODE=production   # default
./install.sh
```

Follow the prompts (region, resource group, admin email/password). When it finishes you get:

- Public **Web URL**
- Admin email + password (password shown once)
- Key Vault name (production mode)

Then open the URL → sign in → **Settings → Connectors** → add cloud/EDR/SaaS/Git/K8s → **Test** → **Scan** → open **Coverage Map**.

### Entra ID SSO (optional)

Register a single-tenant app in Entra ID with redirect URI `https://<web-fqdn>/login`, then:

```bash
export ENTRA_TENANT_ID=…
export ENTRA_CLIENT_ID=…
export ENTRA_CLIENT_SECRET=…
./install.sh --yes
```

### Non-interactive (CI / scripted)

```bash
cp parameters.example.env parameters.env
# edit parameters.env
set -a && source parameters.env && set +a
./install.sh --yes
```

## Upgrade / redeploy

Re-run `./install.sh` against the same resource group **only after exporting the
original secrets**. Upgrade mode refuses to auto-generate `JWT_SECRET`,
`ENCRYPTION_KEY`, `POSTGRES_PASSWORD`, or `BOOTSTRAP_ADMIN_PASSWORD` when an API
app already exists in the RG — this prevents bricking connectors and login.

```bash
export JWT_SECRET='…' ENCRYPTION_KEY='…' POSTGRES_PASSWORD='…' BOOTSTRAP_ADMIN_PASSWORD='…'
./install.sh --yes
```

## Teardown

```bash
./teardown.sh --rg rg-agentradar
```

## Security notes

- Prefer `DATA_PLANE_MODE=production` for any durable inventory.
- **Eval data plane:** containerized Postgres/Neo4j are not durable — plan Flexible Server + backups before production traffic.
- `ENCRYPTION_KEY` and `JWT_SECRET` are generated per **fresh** install unless you supply them; upgrades require the originals.
- Admin password is **not** written to `out/last-deploy.env`
- Inventory is never demo-seeded — it starts empty until connectors/discovery run.
- Store secrets in Azure Key Vault — production installs write them there automatically.

## Support layout

```
platform/cloud-deploy/
  install.sh              # one-click installer
  teardown.sh             # delete resource group
  parameters.example.env  # non-interactive template
  README.md
```
