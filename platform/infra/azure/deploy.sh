#!/usr/bin/env bash
# Deploy Visentra Discovery to Azure Container Apps (production-oriented)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
PLATFORM="$ROOT/platform"
AZURE_DIR="$PLATFORM/infra/azure"

LOCATION="${LOCATION:-westus2}"
PREFIX="${PREFIX:-agentradar}"
RG="${RG:-rg-${PREFIX}-discovery}"
ADMIN_EMAIL="${BOOTSTRAP_ADMIN_EMAIL:-admin@agentradar.local}"
DATA_PLANE_MODE="${DATA_PLANE_MODE:-production}" # production | eval

# Optional Entra ID SSO (OIDC)
ENTRA_TENANT_ID="${ENTRA_TENANT_ID:-}"
ENTRA_CLIENT_ID="${ENTRA_CLIENT_ID:-}"
ENTRA_CLIENT_SECRET="${ENTRA_CLIENT_SECRET:-}"

# Detect upgrade of an existing Visentra RG (do not auto-rotate secrets).
EXISTING_DEPLOY=false
if az group show --name "${RG}" >/dev/null 2>&1; then
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
  [[ -z "${BOOTSTRAP_ADMIN_PASSWORD:-}" ]] && missing+=("BOOTSTRAP_ADMIN_PASSWORD")
  if [[ ${#missing[@]} -gt 0 ]]; then
    echo "ERROR: Upgrade requires: ${missing[*]}" >&2
    echo "  Export the same values used on the original install, then re-run." >&2
    exit 1
  fi
  ADMIN_PASSWORD="$BOOTSTRAP_ADMIN_PASSWORD"
else
  if [[ -z "${BOOTSTRAP_ADMIN_PASSWORD:-}" ]]; then
    ADMIN_PASSWORD="$(openssl rand -base64 18 | tr -d '/+=' | cut -c1-16)Aa1!"
    echo "==> Generated BOOTSTRAP_ADMIN_PASSWORD (save securely — shown once at end)"
  else
    ADMIN_PASSWORD="$BOOTSTRAP_ADMIN_PASSWORD"
  fi
fi

JWT_SECRET="${JWT_SECRET:-$(openssl rand -hex 32)}"
ENCRYPTION_KEY="${ENCRYPTION_KEY:-$(openssl rand -hex 32)}"
if [[ ! "$ENCRYPTION_KEY" =~ ^[0-9a-fA-F]{64}$ ]]; then
  echo "ERROR: ENCRYPTION_KEY must be a 64-char hex string (openssl rand -hex 32)" >&2
  exit 1
fi
POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-$(openssl rand -base64 24 | tr -d '/+=' | cut -c1-24)Aa1}"

echo "==> Resource group: $RG ($LOCATION) dataPlane=$DATA_PLANE_MODE mode=$([[ "$EXISTING_DEPLOY" == "true" ]] && echo upgrade || echo fresh)"
az group create --name "$RG" --location "$LOCATION" -o none

echo "==> Deploying infra (ACR, data plane, CAE, Neo4j)..."
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

# URL-encode password for connection string
PG_PASS_ENC=$(python3 -c 'import urllib.parse,os; print(urllib.parse.quote(os.environ["P"], safe=""))' P="$POSTGRES_PASSWORD")
if [[ "$DP_MODE" == "production" ]]; then
  # Flexible Server requires SSL
  POSTGRES_URL="postgres://${PG_USER}:${PG_PASS_ENC}@${PG_HOST}:5432/${PG_DB}?sslmode=require"
else
  POSTGRES_URL="postgres://${PG_USER}:${PG_PASS_ENC}@${PG_HOST}:5432/${PG_DB}"
fi

echo "==> ACR: $ACR_LOGIN  Postgres host: $PG_HOST ($DP_MODE)"
az acr login --name "$ACR_NAME"

# Persist secrets to Key Vault when production data plane is enabled
if [[ -n "$KV_NAME" ]]; then
  echo "==> Writing secrets to Key Vault: $KV_NAME"
  # Grant current user Secrets Officer if needed
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
  if [[ -n "$ENTRA_CLIENT_SECRET" ]]; then
    az keyvault secret set --vault-name "$KV_NAME" --name entra-client-secret --value "$ENTRA_CLIENT_SECRET" -o none
  fi
fi

export DOCKER_HOST="${DOCKER_HOST:-tcp://127.0.0.1:2375}"
TAG="${IMAGE_TAG:-$(date +%Y%m%d%H%M%S)}"
API_IMAGE="$ACR_LOGIN/agentradar-api:$TAG"
WEB_IMAGE="$ACR_LOGIN/agentradar-web:$TAG"
DISCOVERY_IMAGE="$ACR_LOGIN/agentradar-discovery:$TAG"

echo "==> Building & pushing images ($TAG)..."
docker build -t "$API_IMAGE" "$PLATFORM/apps/api"
docker build -t "$WEB_IMAGE" "$PLATFORM/apps/web"
docker build -t "$DISCOVERY_IMAGE" "$PLATFORM/apps/discovery"
docker push "$API_IMAGE"
docker push "$WEB_IMAGE"
docker push "$DISCOVERY_IMAGE"

echo "==> Creating/updating API container app..."
ACR_USER=$(az acr credential show -n "$ACR_NAME" --query username -o tsv)
ACR_PASS=$(az acr credential show -n "$ACR_NAME" --query passwords[0].value -o tsv)

ENTRA_ENV=()
if [[ -n "$ENTRA_TENANT_ID" && -n "$ENTRA_CLIENT_ID" ]]; then
  ENTRA_ENV+=(
    "ENTRA_TENANT_ID=$ENTRA_TENANT_ID"
    "ENTRA_CLIENT_ID=$ENTRA_CLIENT_ID"
  )
fi

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
    ${ENTRA_CLIENT_SECRET:+entra-client-secret="$ENTRA_CLIENT_SECRET"} \
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
    ${ENTRA_TENANT_ID:+ENTRA_TENANT_ID="$ENTRA_TENANT_ID"} \
    ${ENTRA_CLIENT_ID:+ENTRA_CLIENT_ID="$ENTRA_CLIENT_ID"} \
    ${ENTRA_CLIENT_SECRET:+ENTRA_CLIENT_SECRET=secretref:entra-client-secret} \
    ${KV_URI:+KEY_VAULT_URI="$KV_URI"} \
  -o none 2>/dev/null || \
az containerapp update \
  --name "api-$NAME" \
  --resource-group "$RG" \
  --image "$API_IMAGE" \
  --set-env-vars \
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
    ${ENTRA_TENANT_ID:+ENTRA_TENANT_ID="$ENTRA_TENANT_ID"} \
    ${ENTRA_CLIENT_ID:+ENTRA_CLIENT_ID="$ENTRA_CLIENT_ID"} \
    ${KV_URI:+KEY_VAULT_URI="$KV_URI"} \
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
    ${ENTRA_CLIENT_SECRET:+entra-client-secret="$ENTRA_CLIENT_SECRET"} \
  -o none || true

echo "==> Creating/updating Web container app (public)..."
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

echo "==> Creating/updating Discovery worker..."
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
API_FQDN=$(az containerapp show -n "api-$NAME" -g "$RG" --query properties.configuration.ingress.fqdn -o tsv 2>/dev/null || true)

az containerapp update \
  --name "api-$NAME" \
  --resource-group "$RG" \
  --set-env-vars \
    "CORS_ORIGIN=https://$WEB_FQDN" \
    ${ENTRA_TENANT_ID:+"ENTRA_REDIRECT_URI=https://$WEB_FQDN/login"} \
  -o none

if [[ -z "${API_FQDN:-}" || "$API_FQDN" == "null" ]]; then
  API_FQDN="(internal) http://api-$NAME"
fi

cat > "$AZURE_DIR/.last-deploy.env" <<EOF
RG=$RG
LOCATION=$LOCATION
ACR_LOGIN=$ACR_LOGIN
API_IMAGE=$API_IMAGE
WEB_IMAGE=$WEB_IMAGE
DISCOVERY_IMAGE=$DISCOVERY_IMAGE
WEB_URL=https://$WEB_FQDN
API_URL=$API_FQDN
ADMIN_EMAIL=$ADMIN_EMAIL
POSTGRES_APP=$PG_APP
POSTGRES_HOST=$PG_HOST
NAME_PREFIX=$NAME
DATA_PLANE_MODE=$DP_MODE
KEY_VAULT_NAME=$KV_NAME
ENCRYPTION_KEY_SET=true
EOF

echo ""
echo "============================================"
echo " Visentra Discovery deployed to Azure"
echo " Data plane : $DP_MODE"
echo " Web:  https://$WEB_FQDN"
echo " API:  http://api-$NAME (internal; proxied via web /api)"
echo " Login: $ADMIN_EMAIL"
echo " Admin password: $ADMIN_PASSWORD"
if [[ -n "$KV_NAME" ]]; then
  echo " Key Vault: $KV_NAME ($KV_URI)"
fi
if [[ -n "$ENTRA_TENANT_ID" ]]; then
  echo " Entra SSO: enabled (tenant $ENTRA_TENANT_ID)"
fi
echo " (Password is NOT written to .last-deploy.env — store in Key Vault / secret manager)"
echo "============================================"
