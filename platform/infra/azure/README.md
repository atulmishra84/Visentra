# Visentra Discovery — Azure Container Apps deploy

Production-oriented path to a public Azure URL for the Discovery & Visibility MVP.

## Architecture

| Component | Azure service |
|-----------|---------------|
| Web / API / Discovery / Redis / Neo4j | Azure Container Apps |
| Images | Azure Container Registry |
| Database | Postgres container in Container Apps (MVP). Upgrade to Flexible Server when subscription quota allows — see blueprint `21-azure.md`. |
| Logs | Log Analytics |

Full enterprise AKS reference remains in [`docs/blueprint/21-azure.md`](../../../docs/blueprint/21-azure.md) and root `terraform/` / `bicep/` (legacy stack).

## Prerequisites

1. Azure CLI (`az`) logged in with a subscription that can create RGs
2. Docker (for image build/push)
3. Permissions: Contributor on the target subscription (or RG)

```bash
az login --use-device-code
az account set --subscription "<subscription-id>"
```

## Deploy (production defaults)

```bash
cd platform/infra/azure
chmod +x deploy.sh

export BOOTSTRAP_ADMIN_EMAIL=admin@yourcompany.com
export BOOTSTRAP_ADMIN_PASSWORD='…strong password…'
export JWT_SECRET="$(openssl rand -hex 32)"
export ENCRYPTION_KEY="$(openssl rand -hex 32)"
export DATA_PLANE_MODE=production

./deploy.sh
```

| Variable | Notes |
|----------|-------|
| `LOCATION` | Default `westus2` |
| `RG` | Default `rg-agentradar-discovery` |
| `PREFIX` | Default `agentradar` |
| `BOOTSTRAP_ADMIN_EMAIL` | Required for login |
| `BOOTSTRAP_ADMIN_PASSWORD` | **Required** (no hardcoded default) |
| `JWT_SECRET` | Auto-generated if unset |
| `ENCRYPTION_KEY` | Auto-generated if unset (64-char hex) |
| `DATA_PLANE_MODE` | `production` (Flexible Server + Key Vault) or `eval` |

Deploy sets `NODE_ENV=production`, injects `ENCRYPTION_KEY`, and locks `CORS_ORIGIN` to the web FQDN. Inventory is never demo-seeded.

## Customer one-click package

For installs into a customer Azure subscription (ACR cloud builds, interactive prompts):

```bash
cd platform/cloud-deploy
./install.sh
```

See [`../../cloud-deploy/README.md`](../../cloud-deploy/README.md).

Outputs (non-secret) are written to `.last-deploy.env` (gitignored). The admin password is printed once — store it in a secret manager.

## After deploy

1. Open `WEB_URL` from `.last-deploy.env`
2. Sign in with bootstrap admin credentials (login form is blank in production builds)
3. Inventory starts **empty** — add Connectors (Azure / EDR / SaaS) → Test → Scan
4. Verify `/ready` on the API (via web proxy or internal)

See also [`../../PRODUCTION.md`](../../PRODUCTION.md).

## Custom domain (`aiauthpro.com`)

Point the GoDaddy zone at this Container Apps environment, then bind a managed cert:

| Type | Name | Value |
|------|------|-------|
| TXT | `asuid` | `5F5776FBB2831BF5D1CBDB3B437CB84E7AA29EECF96079BFD318D8451DF50C7F` |
| TXT | `asuid.www` | *(same value)* |
| A | `@` | `4.156.205.224` (environment static IP) |
| CNAME | `www` | `web-arqsrvr46epnpok.victorioushill-8876b2dd.eastus.azurecontainerapps.io` |

Remove GoDaddy parking/forwarding A records (`13.248.243.5`, `76.223.105.230`) so only the Azure static IP remains.

Then:

```bash
cd platform/infra/azure
chmod +x bind-aiauthpro-domain.sh
./bind-aiauthpro-domain.sh
```

The script verifies DNS, binds HTTPS certificates for `aiauthpro.com` + `www`, and sets API `CORS_ORIGIN` / `ENTRA_REDIRECT_URI`. After bind, also add `https://aiauthpro.com/login` as an allowed redirect URI in your IdP.

## Tear down

```bash
az group delete --name "$RG" --yes --no-wait
```
