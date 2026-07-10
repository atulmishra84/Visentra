# AgentRadar Cloud Deploy Package

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

Re-run `./install.sh` against the same resource group (or set `RG=...`). New images are built and Container Apps are updated. Secrets are refreshed from the run — prefer setting `JWT_SECRET` / `ENCRYPTION_KEY` / `BOOTSTRAP_ADMIN_PASSWORD` explicitly on upgrades so connectors and login stay stable.

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

- `ENCRYPTION_KEY` and `JWT_SECRET` are generated per install unless you supply them  
- Admin password is **not** written to `out/last-deploy.env`  
- Demo seed is **off** by default (`SEED_ON_START=false`)  
- For durable production: move Postgres to Flexible Server and secrets to Key Vault (see PRODUCTION.md)

## Support layout

```
platform/cloud-deploy/
  install.sh              # one-click installer
  teardown.sh             # delete resource group
  parameters.example.env  # non-interactive template
  README.md               # this file
  out/                    # generated metadata (gitignored)
```
