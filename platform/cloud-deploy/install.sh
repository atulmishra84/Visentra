#!/usr/bin/env bash
# Visentra — one-click deploy to a customer Azure subscription.
# Requires: Azure CLI (az), Contributor on the target subscription.
# Does NOT require a local Docker daemon (builds via Azure Container Registry Tasks).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PLATFORM="$(cd "$SCRIPT_DIR/.." && pwd)"
AZURE_DIR="$PLATFORM/infra/azure"
ROOT="$(cd "$PLATFORM/.." && pwd)"

usage() {
  cat <<'EOF'
Visentra Cloud Deploy — install into your Azure subscription

Usage:
  ./install.sh                 # interactive prompts
  ./install.sh --yes           # non-interactive (env vars / defaults)
  ./install.sh --help

Environment (optional overrides):
  SUBSCRIPTION_ID          Azure subscription ID
  RG                       Resource group (default: rg-agentradar)
  LOCATION                 Azure region (default: eastus)
  PREFIX                   Resource name prefix (default: agentradar)
  BOOTSTRAP_ADMIN_EMAIL    Admin login email
  BOOTSTRAP_ADMIN_PASSWORD Admin password (generated if unset)
  JWT_SECRET               JWT signing secret (generated if unset)
  ENCRYPTION_KEY           64-char hex (generated if unset)
  DATA_PLANE_MODE          production|eval (default: production)
  IMAGE_TAG                Image tag (default: timestamp)
  ENTRA_TENANT_ID          Optional Entra tenant for SSO
  ENTRA_CLIENT_ID          Optional Entra app client ID
  ENTRA_CLIENT_SECRET      Optional Entra app client secret
EOF
}

YES=false
for arg in "$@"; do
  case "$arg" in
    -h|--help) usage; exit 0 ;;
    -y|--yes) YES=true ;;
  esac
done

need() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "ERROR: '$1' is required. Install Azure CLI: https://aka.ms/installazurecli" >&2
    exit 1
  }
}

need az
need openssl
need python3

if ! az account show >/dev/null 2>&1; then
  echo "==> Not logged in. Opening Azure device login..."
  az login
fi

if [[ -n "${SUBSCRIPTION_ID:-}" ]]; then
  az account set --subscription "$SUBSCRIPTION_ID"
fi

SUB_NAME=$(az account show --query name -o tsv)
SUB_ID=$(az account show --query id -o tsv)
echo "==> Subscription: $SUB_NAME ($SUB_ID)"

prompt() {
  local var="$1" label="$2" default="${3:-}"
  local current="${!var:-}"
  if [[ -n "$current" ]]; then
    return
  fi
  if [[ "$YES" == "true" ]]; then
    printf -v "$var" '%s' "$default"
    return
  fi
  if [[ -n "$default" ]]; then
    read -r -p "$label [$default]: " input || true
    printf -v "$var" '%s' "${input:-$default}"
  else
    read -r -p "$label: " input
    printf -v "$var" '%s' "$input"
  fi
}

prompt_secret() {
  local var="$1" label="$2"
  local current="${!var:-}"
  if [[ -n "$current" ]]; then
    return
  fi
  if [[ "$YES" == "true" ]]; then
    return
  fi
  read -r -s -p "$label (leave blank to auto-generate): " input || true
  echo
  printf -v "$var" '%s' "$input"
}

LOCATION="${LOCATION:-}"
RG="${RG:-}"
PREFIX="${PREFIX:-}"
ADMIN_EMAIL="${BOOTSTRAP_ADMIN_EMAIL:-}"
ADMIN_PASSWORD="${BOOTSTRAP_ADMIN_PASSWORD:-}"

prompt LOCATION "Azure region" "eastus"
prompt RG "Resource group name" "rg-agentradar"
prompt PREFIX "Resource name prefix" "agentradar"
prompt ADMIN_EMAIL "Admin email" "admin@yourcompany.com"
prompt_secret ADMIN_PASSWORD "Admin password"

# Detect upgrade of an existing Visentra RG (do not auto-rotate secrets).
EXISTING_DEPLOY=false
if az group show --name "${RG:-}" >/dev/null 2>&1; then
  if az containerapp list -g "$RG" --query "[?contains(name, 'api-')].name" -o tsv 2>/dev/null | grep -q .; then
    EXISTING_DEPLOY=true
  fi
fi

if [[ "$EXISTING_DEPLOY" == "true" ]]; then
  echo "==> Existing Visentra deployment detected in '$RG' (upgrade mode)"
  echo "    JWT_SECRET, ENCRYPTION_KEY, POSTGRES_PASSWORD, and BOOTSTRAP_ADMIN_PASSWORD"
  echo "    must be supplied explicitly so connectors and login stay intact."
  missing=()
  [[ -z "${JWT_SECRET:-}" ]] && missing+=("JWT_SECRET")
  [[ -z "${ENCRYPTION_KEY:-}" ]] && missing+=("ENCRYPTION_KEY")
  [[ -z "${POSTGRES_PASSWORD:-}" ]] && missing+=("POSTGRES_PASSWORD")
  [[ -z "${ADMIN_PASSWORD:-}" && -z "${BOOTSTRAP_ADMIN_PASSWORD:-}" ]] && missing+=("BOOTSTRAP_ADMIN_PASSWORD")
  if [[ ${#missing[@]} -gt 0 ]]; then
    echo "ERROR: Upgrade requires: ${missing[*]}" >&2
    echo "  Export the same values used on the original install, then re-run." >&2
    exit 1
  fi
  ADMIN_PASSWORD="${BOOTSTRAP_ADMIN_PASSWORD:-$ADMIN_PASSWORD}"
else
  if [[ -z "${ADMIN_PASSWORD:-}" ]]; then
    ADMIN_PASSWORD="$(openssl rand -base64 18 | tr -d '/+=' | cut -c1-16)Aa1!"
    echo "==> Generated admin password (shown once at the end)"
  fi
fi

JWT_SECRET="${JWT_SECRET:-$(openssl rand -hex 32)}"
ENCRYPTION_KEY="${ENCRYPTION_KEY:-$(openssl rand -hex 32)}"
if [[ ! "$ENCRYPTION_KEY" =~ ^[0-9a-fA-F]{64}$ ]]; then
  echo "ERROR: ENCRYPTION_KEY must be a 64-char hex string (openssl rand -hex 32)" >&2
  exit 1
fi
POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-$(openssl rand -base64 24 | tr -d '/+=' | cut -c1-24)Aa1}"
DATA_PLANE_MODE="${DATA_PLANE_MODE:-production}"
TAG="${IMAGE_TAG:-$(date +%Y%m%d%H%M%S)}"

echo ""
echo "============================================"
echo " Visentra cloud deploy"
echo "  Data plane   : $DATA_PLANE_MODE"
if [[ "$DATA_PLANE_MODE" == "eval" ]]; then
  echo "  (eval = containerized Postgres/Neo4j — not durable)"
else
  echo "  (production = Flexible Server + Key Vault + durable Neo4j volume)"
fi
echo "  Subscription : $SUB_NAME"
echo "  Resource group: $RG ($LOCATION)"
echo "  Prefix       : $PREFIX"
echo "  Mode         : $([[ "$EXISTING_DEPLOY" == "true" ]] && echo upgrade || echo fresh)"
echo "  Admin email  : $ADMIN_EMAIL"
echo "============================================"
if [[ "$YES" != "true" ]]; then
  read -r -p "Continue? [Y/n] " confirm || true
  if [[ "${confirm:-Y}" =~ ^[Nn] ]]; then
    echo "Aborted."
    exit 1
  fi
fi

echo "==> Creating resource group..."
az group create --name "$RG" --location "$LOCATION" -o none

echo "==> Deploying foundation (ACR, data plane, CAE, Neo4j)..."
DEPLOY_OUT=$(az deployment group create \
  --resource-group "$RG" \
  --template-file "$AZURE_DIR/main.bicep" \
  --parameters \
    prefix="$PREFIX" \
    postgresPassword="$POSTGRES_PASSWORD" \
    jwtSecret="$JWT_SECRET" \
    bootstrapAdminPassword="$ADMIN_PASSWORD" \
    bootstrapAdminEmail="$ADMIN_EMAIL" \
    dataPlaneMode="$DATA_PLANE_MODE" \
  --query properties.outputs -o json)

ACR_NAME=$(echo "$DEPLOY_OUT" | python3 -c 'import sys,json; print(json.load(sys.stdin)["acrName"]["value"])')
ACR_LOGIN=$(echo "$DEPLOY_OUT" | python3 -c 'import sys,json; print(json.load(sys.stdin)["acrLoginServer"]["value"])')
PG_HOST=$(echo "$DEPLOY_OUT" | python3 -c 'import sys,json; print(json.load(sys.stdin)["postgresHost"]["value"])')
PG_USER=$(echo "$DEPLOY_OUT" | python3 -c 'import sys,json; print(json.load(sys.stdin)["postgresUser"]["value"])')
PG_DB=$(echo "$DEPLOY_OUT" | python3 -c 'import sys,json; print(json.load(sys.stdin)["postgresDbName"]["value"])')
PG_APP=$(echo "$DEPLOY_OUT" | python3 -c 'import sys,json; print(json.load(sys.stdin)["postgresAppName"]["value"])')
CAE=$(echo "$DEPLOY_OUT" | python3 -c 'import sys,json; print(json.load(sys.stdin)["containerAppsEnvName"]["value"])')
NAME=$(echo "$DEPLOY_OUT" | python3 -c 'import sys,json; print(json.load(sys.stdin)["namePrefix"]["value"])')
NEO4J_PASSWORD=$(echo "$DEPLOY_OUT" | python3 -c 'import sys,json; print(json.load(sys.stdin)["neo4jPassword"]["value"])')
KV_NAME=$(echo "$DEPLOY_OUT" | python3 -c 'import sys,json; print(json.load(sys.stdin).get("keyVaultName",{}).get("value",""))')
KV_URI=$(echo "$DEPLOY_OUT" | python3 -c 'import sys,json; print(json.load(sys.stdin).get("keyVaultUri",{}).get("value",""))')
DP_MODE=$(echo "$DEPLOY_OUT" | python3 -c 'import sys,json; print(json.load(sys.stdin)["dataPlaneMode"]["value"])')

PG_PASS_ENC=$(python3 -c 'import urllib.parse,os; print(urllib.parse.quote(os.environ["P"], safe=""))' P="$POSTGRES_PASSWORD")
if [[ "$DP_MODE" == "production" ]]; then
  POSTGRES_URL="postgres://${PG_USER}:${PG_PASS_ENC}@${PG_HOST}:5432/${PG_DB}?sslmode=require"
else
  POSTGRES_URL="postgres://${PG_USER}:${PG_PASS_ENC}@${PG_HOST}:5432/${PG_DB}"
fi

if [[ -n "$KV_NAME" ]]; then
  echo "==> Writing secrets to Key Vault: $KV_NAME"
  ME_OID=$(az ad signed-in-user show --query id -o tsv 2>/dev/null || true)
  if [[ -n "$ME_OID" ]]; then
    az role assignment create \
      --role "Key Vault Secrets Officer" \
      --assignee-object-id "$ME_OID" \
      --assignee-principal-type User \
      --scope "$(az keyvault show -n "$KV_NAME" --query id -o tsv)" \
      -o none 2>/dev/null || true
    sleep 8
  fi
  az keyvault secret set --vault-name "$KV_NAME" --name jwt-secret --value "$JWT_SECRET" -o none
  az keyvault secret set --vault-name "$KV_NAME" --name encryption-key --value "$ENCRYPTION_KEY" -o none
  az keyvault secret set --vault-name "$KV_NAME" --name postgres-url --value "$POSTGRES_URL" -o none
  az keyvault secret set --vault-name "$KV_NAME" --name bootstrap-password --value "$ADMIN_PASSWORD" -o none
  az keyvault secret set --vault-name "$KV_NAME" --name neo4j-password --value "$NEO4J_PASSWORD" -o none
fi

API_IMAGE="$ACR_LOGIN/agentradar-api:$TAG"
WEB_IMAGE="$ACR_LOGIN/agentradar-web:$TAG"
DISCOVERY_IMAGE="$ACR_LOGIN/agentradar-discovery:$TAG"

echo "==> Building images in Azure ACR (no local Docker required) — tag $TAG"
az acr build --registry "$ACR_NAME" --image "agentradar-api:$TAG" --file "$PLATFORM/apps/api/Dockerfile" "$PLATFORM/apps/api"
az acr build --registry "$ACR_NAME" --image "agentradar-web:$TAG" --file "$PLATFORM/apps/web/Dockerfile" "$PLATFORM/apps/web"
az acr build --registry "$ACR_NAME" --image "agentradar-discovery:$TAG" --file "$PLATFORM/apps/discovery/Dockerfile" "$PLATFORM/apps/discovery"

# POSTGRES_URL already set from Flexible Server / eval host above
ACR_USER=$(az acr credential show -n "$ACR_NAME" --query username -o tsv)
ACR_PASS=$(az acr credential show -n "$ACR_NAME" --query passwords[0].value -o tsv)

echo "==> Deploying API..."
az containerapp create \
  --name "api-$NAME" \
  --resource-group "$RG" \
  --environment "$CAE" \
  --image "$API_IMAGE" \
  --registry-server "$ACR_LOGIN" \
  --registry-username "$ACR_USER" \
  --registry-password "$ACR_PASS" \
  --target-port 8080 \
  --ingress internal \
  --min-replicas 1 --max-replicas 3 \
  --cpu 0.5 --memory 1.0Gi \
  --secrets \
    jwt-secret="$JWT_SECRET" \
    encryption-key="$ENCRYPTION_KEY" \
    postgres-url="$POSTGRES_URL" \
    bootstrap-password="$ADMIN_PASSWORD" \
    neo4j-password="$NEO4J_PASSWORD" \
  --env-vars \
    PORT=8080 \
    NODE_ENV=production \
    DATA_PLANE_MODE="$DP_MODE" \
    POSTGRES_URL=secretref:postgres-url \
    NEO4J_URI="bolt://neo4j-$NAME:7687" \
    NEO4J_USER=neo4j \
    NEO4J_PASSWORD=secretref:neo4j-password \
    JWT_SECRET=secretref:jwt-secret \
    ENCRYPTION_KEY=secretref:encryption-key \
    BOOTSTRAP_ADMIN_EMAIL="$ADMIN_EMAIL" \
    BOOTSTRAP_ADMIN_PASSWORD=secretref:bootstrap-password \
    CORS_ORIGIN="https://placeholder.local" \
  -o none 2>/dev/null || \
az containerapp update \
  --name "api-$NAME" \
  --resource-group "$RG" \
  --image "$API_IMAGE" \
  --set-env-vars \
    NODE_ENV=production \
    DATA_PLANE_MODE="$DP_MODE" \
    POSTGRES_URL=secretref:postgres-url \
    NEO4J_URI="bolt://neo4j-$NAME:7687" \
    NEO4J_USER=neo4j \
    NEO4J_PASSWORD=secretref:neo4j-password \
    JWT_SECRET=secretref:jwt-secret \
    ENCRYPTION_KEY=secretref:encryption-key \
    BOOTSTRAP_ADMIN_EMAIL="$ADMIN_EMAIL" \
    BOOTSTRAP_ADMIN_PASSWORD=secretref:bootstrap-password \
  -o none

az containerapp secret set \
  --name "api-$NAME" \
  --resource-group "$RG" \
  --secrets \
    jwt-secret="$JWT_SECRET" \
    encryption-key="$ENCRYPTION_KEY" \
    postgres-url="$POSTGRES_URL" \
    bootstrap-password="$ADMIN_PASSWORD" \
    neo4j-password="$NEO4J_PASSWORD" \
  -o none || true

echo "==> Deploying Web..."
az containerapp create \
  --name "web-$NAME" \
  --resource-group "$RG" \
  --environment "$CAE" \
  --image "$WEB_IMAGE" \
  --registry-server "$ACR_LOGIN" \
  --registry-username "$ACR_USER" \
  --registry-password "$ACR_PASS" \
  --target-port 80 \
  --ingress external \
  --min-replicas 1 --max-replicas 3 \
  --cpu 0.25 --memory 0.5Gi \
  --env-vars "API_UPSTREAM=api-$NAME" \
  -o none 2>/dev/null || \
az containerapp update \
  --name "web-$NAME" \
  --resource-group "$RG" \
  --image "$WEB_IMAGE" \
  --set-env-vars "API_UPSTREAM=api-$NAME" \
  -o none

echo "==> Deploying Discovery worker..."
az containerapp create \
  --name "discovery-$NAME" \
  --resource-group "$RG" \
  --environment "$CAE" \
  --image "$DISCOVERY_IMAGE" \
  --registry-server "$ACR_LOGIN" \
  --registry-username "$ACR_USER" \
  --registry-password "$ACR_PASS" \
  --min-replicas 1 --max-replicas 1 \
  --cpu 0.25 --memory 0.5Gi \
  --secrets bootstrap-password="$ADMIN_PASSWORD" \
  --env-vars \
    NODE_ENV=production \
    API_INTERNAL_URL="http://api-$NAME" \
    BOOTSTRAP_ADMIN_EMAIL="$ADMIN_EMAIL" \
    BOOTSTRAP_ADMIN_PASSWORD=secretref:bootstrap-password \
    DISCOVERY_INTERVAL_MS=300000 \
    RUN_ON_START=true \
  -o none 2>/dev/null || \
az containerapp update \
  --name "discovery-$NAME" \
  --resource-group "$RG" \
  --image "$DISCOVERY_IMAGE" \
  --set-env-vars \
    NODE_ENV=production \
    API_INTERNAL_URL="http://api-$NAME" \
    BOOTSTRAP_ADMIN_EMAIL="$ADMIN_EMAIL" \
    BOOTSTRAP_ADMIN_PASSWORD=secretref:bootstrap-password \
    DISCOVERY_INTERVAL_MS=300000 \
  -o none

WEB_FQDN=$(az containerapp show -n "web-$NAME" -g "$RG" --query properties.configuration.ingress.fqdn -o tsv)

echo "==> Locking CORS to https://$WEB_FQDN"
az containerapp update \
  --name "api-$NAME" \
  --resource-group "$RG" \
  --set-env-vars "CORS_ORIGIN=https://$WEB_FQDN" \
  -o none

OUT_DIR="$SCRIPT_DIR/out"
mkdir -p "$OUT_DIR"
cat > "$OUT_DIR/last-deploy.env" <<EOF
SUBSCRIPTION_ID=$SUB_ID
RG=$RG
LOCATION=$LOCATION
ACR_LOGIN=$ACR_LOGIN
API_IMAGE=$API_IMAGE
WEB_IMAGE=$WEB_IMAGE
DISCOVERY_IMAGE=$DISCOVERY_IMAGE
WEB_URL=https://$WEB_FQDN
ADMIN_EMAIL=$ADMIN_EMAIL
NAME_PREFIX=$NAME
DATA_PLANE_MODE=$DP_MODE
KEY_VAULT_NAME=$KV_NAME
DEPLOYED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)
EOF

# Wait briefly for readiness
echo "==> Waiting for API readiness..."
for i in $(seq 1 24); do
  if curl -fsS --max-time 5 "https://$WEB_FQDN/api/health" >/dev/null 2>&1 || \
     curl -fsS --max-time 5 "https://$WEB_FQDN/healthz" >/dev/null 2>&1; then
    break
  fi
  sleep 5
done

cat <<EOF

============================================
 Visentra is live in your Azure cloud
============================================
 Web URL : https://$WEB_FQDN
 Login   : $ADMIN_EMAIL
 Password: $ADMIN_PASSWORD

 Next steps:
  1. Open the Web URL and sign in
  2. Go to Settings → Connectors
  3. Add Azure / EDR / SaaS credentials → Test → Scan
  4. Explore Inventory, Shadow AI, Relationship Explorer

 Metadata saved to: $OUT_DIR/last-deploy.env
 (Password is NOT written to disk — store it in your secret manager)

 Teardown:  ./teardown.sh --rg $RG
 Docs:      $SCRIPT_DIR/README.md
============================================
EOF
