# AgentRadar — GitHub Actions CI/CD Setup

## What this does

Every push to `main` automatically:

1. **Validates** — checks JS syntax, Helm lint, Terraform fmt, SQL syntax
2. **Builds** — builds 3 Docker images (frontend, API, webhook), pushes to your ACR
3. **Infra** — runs `terraform apply` (plans only on PRs, applies on main)
4. **Deploys** — `helm upgrade --install` to AKS, installs NGINX + cert-manager if needed
5. **Migrates** — runs DB schema migration inside the API pod
6. **Smoke tests** — checks all pods Running, hits `/health` endpoint

---

## One-time setup (5 minutes)

You only do this once. Bootstrap must already be complete.

### Prerequisites
```bash
# GitHub CLI
brew install gh   # or https://cli.github.com
gh auth login

# Azure CLI already logged in from bootstrap
az account show
```

### Step 1 — Create your GitHub repo
```bash
# Create a new private repo
gh repo create agentRadar --private --clone
cd agentRadar
```

### Step 2 — Copy files into the repo
```bash
# Unzip the pipeline package
unzip agentRadar-cicd.zip -d .

# Unzip the app package (Dockerfiles, Helm, migrations)
unzip agentRadar-app.zip -d .
mv agentRadar-app/* .

# Copy your platform HTML
cp /path/to/agentRadarLaunch.html ./deploy/frontend/agentRadarLaunch.html

# Copy Terraform from the standalone package
unzip agentRadar-azure-standalone.zip -d .
cp -r agentRadar-azure-standalone/terraform ./
cp -r agentRadar-azure-standalone/bicep ./
cp -r agentRadar-azure-standalone/helm/agentRadar/values.yaml ./helm/agentRadar/values.yaml
```

Your repo should now look like:
```
agentRadar/
├── .github/
│   └── workflows/
│       └── deploy.yml          ← the pipeline
├── deploy/
│   ├── frontend/
│   │   ├── Dockerfile
│   │   ├── nginx.conf
│   │   └── agentRadarLaunch.html   ← your platform
│   ├── api/
│   │   ├── Dockerfile
│   │   ├── package.json
│   │   └── server.js
│   └── webhook/
│       ├── Dockerfile
│       └── webhook.js
├── helm/agentRadar/
│   ├── Chart.yaml
│   ├── values.yaml
│   └── templates/
│       ├── frontend.yaml
│       ├── api.yaml
│       └── ingress.yaml
├── migrations/
│   └── 001_schema.sql
├── terraform/standalone/
│   ├── main.tf
│   ├── variables.tf
│   ├── outputs.tf
│   └── terraform.tfvars         ← written by bootstrap.sh
└── scripts/
    └── setup-github-secrets.sh
```

### Step 3 — Populate all GitHub secrets automatically
```bash
chmod +x scripts/setup-github-secrets.sh
./scripts/setup-github-secrets.sh
```

This reads your terraform outputs and sets every secret. Takes 30 seconds.

### Step 4 — Push and watch it deploy
```bash
git add .
git commit -m "ci: initial AgentRadar deployment"
git push origin main
```

Then watch:
```bash
gh run watch   # live pipeline output in terminal
```

Or open in browser:
```
https://github.com/YOUR_ORG/agentRadar/actions
```

---

## Pipeline secrets reference

The setup script sets these automatically. Listed here for reference.

### Secrets (sensitive)
| Secret | Example value | Set by |
|--------|--------------|--------|
| `AZURE_CLIENT_ID` | `xxxxxxxx-...` | setup-github-secrets.sh |
| `AZURE_TENANT_ID` | `xxxxxxxx-...` | setup-github-secrets.sh |
| `AZURE_SUBSCRIPTION_ID` | `xxxxxxxx-...` | setup-github-secrets.sh |
| `AZURE_RESOURCE_GROUP` | `rg-agentRadar-prod-we` | setup-github-secrets.sh |
| `AKS_CLUSTER_NAME` | `aks-agentRadar-prod-we` | setup-github-secrets.sh |
| `ACR_LOGIN_SERVER` | `acragentradarprodwe.azurecr.io` | setup-github-secrets.sh |
| `ACR_NAME` | `acragentradarprodwe` | setup-github-secrets.sh |
| `KEYVAULT_URI` | `https://kv-...vault.azure.net/` | setup-github-secrets.sh |
| `POSTGRES_HOST` | `psql-....postgres.database.azure.com` | setup-github-secrets.sh |
| `REDIS_HOST` | `redis-....redis.cache.windows.net` | setup-github-secrets.sh |
| `TF_STATE_RG` | `rg-agentRadar-tfstate-we` | setup-github-secrets.sh |
| `TF_STATE_SA` | `staragentradartfweXXXXXX` | setup-github-secrets.sh |
| `AI_API_KEY` | `sk-ant-...` | setup-github-secrets.sh (optional) |

### Variables (non-sensitive)
| Variable | Example value |
|----------|--------------|
| `DOMAIN` | `agentRadar.yourcompany.com` |
| `MANAGED_IDENTITY_CLIENT_ID` | `xxxxxxxx-...` |

---

## Trigger a deploy manually
```bash
# Deploy prod with latest images
gh workflow run deploy.yml --ref main

# Deploy a specific tag
gh workflow run deploy.yml --ref main \
  -f image_tag=sha-abc1234

# Skip rebuild (just redeploy existing images)
gh workflow run deploy.yml --ref main \
  -f skip_build=true \
  -f skip_infra=true

# Skip terraform (infra unchanged)
gh workflow run deploy.yml --ref main \
  -f skip_infra=true
```

---

## PR workflow

On every pull request to `main`, the pipeline:
- Runs validation (JS, Helm, Terraform fmt)
- Runs `terraform plan` and posts the output as a PR comment
- Does NOT build images or deploy

---

## Rollback
```bash
# List Helm releases
helm history agentRadar -n agentRadar

# Roll back to previous release
helm rollback agentRadar -n agentRadar

# Or deploy a specific old tag
gh workflow run deploy.yml --ref main \
  -f image_tag=sha-OLDCOMMITSHA \
  -f skip_infra=true
```

---

## DNS — final step after first deploy

After the pipeline completes, get your ingress IP:
```bash
kubectl get svc ingress-nginx-controller -n ingress-nginx \
  -o jsonpath='{.status.loadBalancer.ingress[0].ip}'
```

Add this DNS A record in your DNS provider:
```
agentRadar.yourcompany.com  →  <ingress IP>
```

TLS certificate is issued automatically by Let's Encrypt once DNS propagates (5–30 min).
