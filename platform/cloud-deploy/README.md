# AgentRadar Cloud Deploy Package

> **Evaluation / POC path.** This installer deploys Postgres, Redis, and Neo4j as
> Container Apps **without persistent volumes or managed backups**. Inventory and
> connector secrets metadata can be lost on reschedule. For production, use Azure
> Database for PostgreSQL Flexible Server (+ backups), Key Vault, and Entra ID SSO
> — see [`../PRODUCTION.md`](../PRODUCTION.md).

One-click install of **AgentRadar Discovery & Visibility** into **your Azure subscription** (customer cloud / BYOC).

## What you get

| Component | Azure resource |
|-----------|----------------|
| Web UI | Container App (public HTTPS) |
| API | Container App (internal, proxied via web `/api`) |
| Discovery worker | Container App |
| Postgres + Redis + Neo4j | Container Apps (MVP data plane) |
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
./install.sh
```

Follow the prompts (region, resource group, admin email/password). When it finishes you get:

- Public **Web URL**
- Admin email + password (password shown once)

Then open the URL → sign in → **Settings → Connectors** → add cloud/EDR/SaaS → **Test** → **Scan**.

### Non-interactive (CI / scripted)

```bash
cp parameters.example.env parameters.env
# edit parameters.env
set -a && source parameters.env && set +a
./install.sh --yes
```

### Azure Cloud Shell

Upload or clone this repo, then:

```bash
cd platform/cloud-deploy
./install.sh
```

Cloud Shell already has `az` authenticated to your tenant.

## After deploy

1. Sign in with the printed admin credentials  
2. Change the admin password in your IdP / rotate bootstrap secret when ready  
3. Connect Azure ARM, EDR (CrowdStrike, Defender, Intune, Cortex, Netskope), and SaaS platforms (Copilot, Salesforce, Workday, ServiceNow)  
4. Use Inventory, Shadow AI, and Relationship Explorer  

Production checklist: [`../PRODUCTION.md`](../PRODUCTION.md)

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

## Operator path (local Docker)

If you already have Docker and prefer the internal operator script:

```bash
cd platform/infra/azure
export BOOTSTRAP_ADMIN_PASSWORD='…'
./deploy.sh
```

## Security notes

- **Eval data plane:** containerized Postgres/Neo4j are not durable — plan Flexible Server + backups before production traffic.
- `ENCRYPTION_KEY` and `JWT_SECRET` are generated per **fresh** install unless you supply them; upgrades require the originals.
- Admin password is **not** written to `out/last-deploy.env`
- Demo seed is **off** by default (`SEED_ON_START=false`)
- Store secrets in Azure Key Vault / your secret manager — not git.

## Support layout

```
platform/cloud-deploy/
  install.sh              # one-click installer
  teardown.sh             # delete resource group
  parameters.example.env  # non-interactive template
  README.md               # this file
  out/                    # generated metadata (gitignored)
```
