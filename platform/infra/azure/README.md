# AgentRadar Discovery — Azure Container Apps deploy

Fastest path to a public Azure URL for the Discovery & Visibility MVP.

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

## Deploy

```bash
cd platform/infra/azure
chmod +x deploy.sh
./deploy.sh
```

Optional env overrides:

| Variable | Default |
|----------|---------|
| `LOCATION` | `westus2` |
| `RG` | `rg-agentradar-discovery` |
| `PREFIX` | `agentradar` |
| `BOOTSTRAP_ADMIN_EMAIL` | `admin@agentradar.local` |
| `BOOTSTRAP_ADMIN_PASSWORD` | `AgentRadar!Azure1` |

Outputs are written to `.last-deploy.env` (gitignored) including `WEB_URL` and `API_URL`.

## After deploy

1. Open `WEB_URL` from `.last-deploy.env`
2. Sign in with bootstrap admin credentials
3. Confirm inventory is seeded (demo collector runs on API start)

If the SPA cannot reach `/api` through the web proxy, rebuild web with an absolute API URL:

```bash
docker build --build-arg VITE_API_URL="https://<api-fqdn>" -t ... platform/apps/web
```

Or set Container App env `API_UPSTREAM=api-<namePrefix>` on the web app (internal DNS).

## Tear down

```bash
az group delete --name rg-agentradar-discovery --yes --no-wait
```
