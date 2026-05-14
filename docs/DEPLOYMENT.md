# AgentRadar — Azure Standalone Deployment Guide

## What this package contains

| Path | Purpose |
|------|---------|
| `terraform/standalone/` | Full Terraform IaC — provisions all Azure infrastructure |
| `bicep/standalone/` | Bicep alternative — same infrastructure, native Azure |
| `github/workflows/deploy.yml` | GitHub Actions CI/CD — build → infra → deploy → migrate |
| `helm/agentRadar/` | Helm chart — deploys AgentRadar onto AKS |
| `scripts/bootstrap.sh` | One-command first-time setup |

---

## Architecture

```
Internet
   │ HTTPS :443
   ▼
Azure Front Door / App Gateway (WAF OWASP 3.2)
   │
   ▼  VNet 10.1.0.0/16
┌──────────────────────────────────────────────┐
│  AKS — app node pool (Standard_D4s_v3 × 2-8) │
│  ┌─────────────────────────────────────────┐ │
│  │ frontend  api-server  auth  webhook      │ │
│  │ orchestrator  (all using Managed Identity)│ │
│  └─────────────────────────────────────────┘ │
│                     │                         │
│  ┌──────────────────▼──────────────────────┐ │
│  │ Data subnet (private endpoints only)     │ │
│  │ PostgreSQL  Redis  Key Vault  Blob       │ │
│  └─────────────────────────────────────────┘ │
│                     │                         │
│  NAT Gateway ◄──────┘  (scanner egress)       │
└──────────────────────────────────────────────┘
```

---

## Prerequisites

On your machine:
```bash
az --version       # >= 2.55
terraform version  # >= 1.6
helm version       # >= 3.14
kubectl version    # >= 1.28
docker --version   # any recent
```

Azure subscription requirements:
- Contributor role on the subscription
- Permission to create service principals
- Microsoft.ContainerService registered: `az provider register -n Microsoft.ContainerService`
- Microsoft.DBforPostgreSQL registered: `az provider register -n Microsoft.DBforPostgreSQL`

---

## Option A — Bootstrap script (recommended for first deploy)

```bash
# 1. Clone this repo
git clone https://github.com/yourorg/agentRadar-deploy
cd agentRadar-deploy

# 2. Login to Azure
az login
az account set --subscription "Your Subscription Name"

# 3. Run bootstrap — interactive, handles everything
chmod +x scripts/bootstrap.sh
./scripts/bootstrap.sh
```

The script will:
- Create Terraform state storage in Azure
- Create a service principal with OIDC for GitHub Actions
- Generate `terraform.tfvars` from your answers
- Run `terraform plan` and optionally `terraform apply`
- Print the GitHub Secrets you need to add

---

## Option B — Terraform manually

```bash
cd terraform/standalone

# 1. Copy and fill in variables
cp terraform.tfvars.example terraform.tfvars
nano terraform.tfvars

# 2. Create state storage first (one-time)
az group create -n rg-agentRadar-tfstate-we -l westeurope
az storage account create -n stagentRadartfstate -g rg-agentRadar-tfstate-we -l westeurope --sku Standard_LRS
az storage container create -n tfstate --account-name stagentRadartfstate --auth-mode login

# 3. Initialise
terraform init \
  -backend-config="resource_group_name=rg-agentRadar-tfstate-we" \
  -backend-config="storage_account_name=stagentRadartfstate" \
  -backend-config="container_name=tfstate" \
  -backend-config="key=agentRadar/prod/terraform.tfstate"

# 4. Plan and apply
terraform plan -out=tfplan
terraform apply tfplan

# 5. Get outputs
terraform output
```

---

## Option C — Bicep

```bash
# One-command subscription-scoped deployment
az deployment sub create \
  --location westeurope \
  --template-file bicep/standalone/main.bicep \
  --parameters @bicep/standalone/params.bicepparam \
  --parameters domain='agentRadar.yourcompany.com' \
               alertEmail='security@yourcompany.com' \
               aiApiKey='sk-ant-...'
```

---

## Step 2 — Build and push Docker images

After infrastructure is deployed:

```bash
# Login to your ACR
ACR=$(terraform -chdir=terraform/standalone output -raw acr_login_server)
az acr login --name $ACR

# Build images (from repo root)
docker build -f deploy/frontend/Dockerfile  -t $ACR/agentRadar-frontend:latest  --build-arg PLATFORM_HTML=agentRadarLaunch.html .
docker build -f deploy/api/Dockerfile       -t $ACR/agentRadar-api:latest       deploy/api/
docker build -f deploy/webhook/Dockerfile   -t $ACR/agentRadar-webhook:latest   deploy/webhook/

# Push
docker push $ACR/agentRadar-frontend:latest
docker push $ACR/agentRadar-api:latest
docker push $ACR/agentRadar-webhook:latest
```

---

## Step 3 — Deploy with Helm

```bash
# Get AKS credentials
RG=$(terraform -chdir=terraform/standalone output -raw resource_group_name)
AKS=$(terraform -chdir=terraform/standalone output -raw aks_name)
az aks get-credentials --resource-group $RG --name $AKS

# Deploy AgentRadar
helm upgrade --install agentRadar ./helm/agentRadar \
  --namespace agentRadar \
  --create-namespace \
  --wait \
  --set global.imageRegistry=$ACR \
  --set global.domain=agentRadar.yourcompany.com \
  --set keyvault.vaultUri=$(terraform -chdir=terraform/standalone output -raw keyvault_uri) \
  --set postgres.host=$(terraform -chdir=terraform/standalone output -raw postgres_fqdn) \
  --set redis.host=$(terraform -chdir=terraform/standalone output -raw redis_hostname)

# Verify
kubectl get pods -n agentRadar
```

---

## Step 4 — DNS + TLS

```bash
# Get the ingress IP
INGRESS_IP=$(kubectl get svc ingress-nginx-controller -n ingress-nginx \
  -o jsonpath='{.status.loadBalancer.ingress[0].ip}')

echo "Point this DNS record:"
echo "  agentRadar.yourcompany.com  A  $INGRESS_IP"
```

Then add to your DNS provider. cert-manager will automatically provision a Let's Encrypt TLS certificate once DNS propagates.

---

## Step 5 — Run database migrations

```bash
# Find the api pod
API_POD=$(kubectl get pod -n agentRadar -l app=agentRadar-api -o jsonpath='{.items[0].metadata.name}')

# Apply schema
kubectl exec -n agentRadar $API_POD -- node -e "
  const { Pool } = require('pg');
  const { readFileSync } = require('fs');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const sql = readFileSync('/app/migrations/001_schema.sql','utf8');
  pool.query(sql).then(() => { console.log('Done'); pool.end(); });
"
```

---

## Step 6 — GitHub Actions (ongoing deploys)

Add these secrets in GitHub → Settings → Secrets → Actions:

| Secret | Value |
|--------|-------|
| `AZURE_CLIENT_ID` | From bootstrap output |
| `AZURE_TENANT_ID` | From bootstrap output |
| `AZURE_SUBSCRIPTION_ID` | Your subscription ID |
| `AZURE_RESOURCE_GROUP` | `rg-agentRadar-prod-we` |
| `AKS_CLUSTER_NAME` | `aks-agentRadar-prod-we` |
| `ACR_LOGIN_SERVER` | `acragentRadarprodwe.azurecr.io` |
| `TF_STATE_RESOURCE_GROUP` | `rg-agentRadar-tfstate-we` |
| `TF_STATE_STORAGE_ACCOUNT` | `stagentRadartfstatewe` |
| `AI_API_KEY` | Your Anthropic/OpenAI key |

Add these variables (not secrets) in GitHub → Settings → Variables:

| Variable | Value |
|----------|-------|
| `DOMAIN` | `agentRadar.yourcompany.com` |

Now every push to `main` automatically builds images, updates infrastructure, and deploys to AKS.

---

## Updating / upgrading

```bash
# Upgrade AgentRadar (after pushing new images)
helm upgrade agentRadar ./helm/agentRadar \
  --namespace agentRadar \
  --set global.imageTag=v1.2.0 \
  --reuse-values \
  --wait

# Scale up for load
kubectl scale deployment agentRadar-api --replicas=4 -n agentRadar

# Check status
kubectl rollout status deployment/agentRadar-api -n agentRadar
kubectl get pods -n agentRadar
```

---

## Destroy (when decommissioning)

```bash
# Remove Helm release first
helm uninstall agentRadar -n agentRadar

# Then destroy infrastructure
terraform -chdir=terraform/standalone destroy
```

---

## Cost summary (West Europe)

| Tier | Config | Monthly |
|------|--------|---------|
| **Pilot** | 1× D2s_v3, PG Burstable, Redis C1 | ~$285 |
| **Production** | 2× D4s_v3, PG D2ds_v5 HA, Redis C2 | ~$1,081 |
| **Reserved 1yr** | Same as prod with reservations | ~$742 |

---

## Troubleshooting

```bash
# Pod not starting
kubectl describe pod -n agentRadar <pod-name>
kubectl logs -n agentRadar <pod-name> --previous

# Key Vault access error
az keyvault secret list --vault-name kv-agentRadar-prod-we

# Database connection error
kubectl exec -n agentRadar <api-pod> -- node -e "require('pg').Pool({connectionString:process.env.DATABASE_URL}).query('SELECT 1').then(r=>console.log('DB OK')).catch(console.error)"

# Ingress not working
kubectl get ingress -n agentRadar
kubectl describe ingress agentRadar -n agentRadar

# Check all resource health
kubectl get all -n agentRadar
```
