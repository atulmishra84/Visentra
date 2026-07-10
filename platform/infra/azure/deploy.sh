#!/usr/bin/env bash
# Deploy AgentRadar Discovery MVP to Azure Container Apps
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
PLATFORM="$ROOT/platform"
AZURE_DIR="$PLATFORM/infra/azure"

LOCATION="${LOCATION:-eastus}"
PREFIX="${PREFIX:-agentradar}"
RG="${RG:-rg-${PREFIX}-discovery}"
ADMIN_EMAIL="${BOOTSTRAP_ADMIN_EMAIL:-admin@agentradar.local}"
ADMIN_PASSWORD="${BOOTSTRAP_ADMIN_PASSWORD:-AgentRadar!Azure1}"
JWT_SECRET="${JWT_SECRET:-$(openssl rand -hex 32)}"
POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-$(openssl rand -base64 24 | tr -d '/+=' | cut -c1-24)Aa1}"

echo "==> Resource group: $RG ($LOCATION)"
az group create --name "$RG" --location "$LOCATION" -o none

echo "==> Deploying infra (ACR, Postgres, CAE, Redis, Neo4j)..."
DEPLOY_OUT=$(az deployment group create \
  --resource-group "$RG" \
  --template-file "$AZURE_DIR/main.bicep" \
  --parameters \
    prefix="$PREFIX" \
    postgresPassword="$POSTGRES_PASSWORD" \
    jwtSecret="$JWT_SECRET" \
    bootstrapAdminPassword="$ADMIN_PASSWORD" \
    bootstrapAdminEmail="$ADMIN_EMAIL" \
    deployApps=false \
  --query properties.outputs -o json)

ACR_NAME=$(echo "$DEPLOY_OUT" | python3 -c 'import sys,json; print(json.load(sys.stdin)["acrName"]["value"])')
ACR_LOGIN=$(echo "$DEPLOY_OUT" | python3 -c 'import sys,json; print(json.load(sys.stdin)["acrLoginServer"]["value"])')
PG_FQDN=$(echo "$DEPLOY_OUT" | python3 -c 'import sys,json; print(json.load(sys.stdin)["postgresFqdn"]["value"])')
CAE=$(echo "$DEPLOY_OUT" | python3 -c 'import sys,json; print(json.load(sys.stdin)["containerAppsEnvName"]["value"])')
NAME=$(echo "$DEPLOY_OUT" | python3 -c 'import sys,json; print(json.load(sys.stdin)["namePrefix"]["value"])')
NEO4J_PASSWORD=$(echo "$DEPLOY_OUT" | python3 -c 'import sys,json; print(json.load(sys.stdin)["neo4jPassword"]["value"])')

echo "==> ACR: $ACR_LOGIN"
az acr login --name "$ACR_NAME"

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

POSTGRES_URL="postgres://agentradar:${POSTGRES_PASSWORD}@${PG_FQDN}:5432/agentradar?sslmode=require"

echo "==> Creating/updating API container app..."
ACR_USER=$(az acr credential show -n "$ACR_NAME" --query username -o tsv)
ACR_PASS=$(az acr credential show -n "$ACR_NAME" --query passwords[0].value -o tsv)

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
    postgres-url="$POSTGRES_URL" \
    bootstrap-password="$ADMIN_PASSWORD" \
    neo4j-password="$NEO4J_PASSWORD" \
  --env-vars \
    PORT=8080 \
    POSTGRES_URL=secretref:postgres-url \
    NEO4J_URI="bolt://neo4j-$NAME:7687" \
    NEO4J_USER=neo4j \
    NEO4J_PASSWORD=secretref:neo4j-password \
    REDIS_URL="redis://redis-$NAME:6379" \
    JWT_SECRET=secretref:jwt-secret \
    BOOTSTRAP_ADMIN_EMAIL="$ADMIN_EMAIL" \
    BOOTSTRAP_ADMIN_PASSWORD=secretref:bootstrap-password \
    CORS_ORIGIN='*' \
    SEED_ON_START=true \
  -o none 2>/dev/null || \
az containerapp update \
  --name "api-$NAME" \
  --resource-group "$RG" \
  --image "$API_IMAGE" \
  --set-env-vars \
    PORT=8080 \
    POSTGRES_URL=secretref:postgres-url \
    NEO4J_URI="bolt://neo4j-$NAME:7687" \
    NEO4J_USER=neo4j \
    NEO4J_PASSWORD=secretref:neo4j-password \
    REDIS_URL="redis://redis-$NAME:6379" \
    JWT_SECRET=secretref:jwt-secret \
    BOOTSTRAP_ADMIN_EMAIL="$ADMIN_EMAIL" \
    BOOTSTRAP_ADMIN_PASSWORD=secretref:bootstrap-password \
    CORS_ORIGIN='*' \
    SEED_ON_START=true \
  -o none

# Ensure secrets exist on update path
az containerapp secret set \
  --name "api-$NAME" \
  --resource-group "$RG" \
  --secrets \
    jwt-secret="$JWT_SECRET" \
    postgres-url="$POSTGRES_URL" \
    bootstrap-password="$ADMIN_PASSWORD" \
    neo4j-password="$NEO4J_PASSWORD" \
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
  -o none

WEB_FQDN=$(az containerapp show -n "web-$NAME" -g "$RG" --query properties.configuration.ingress.fqdn -o tsv)
API_FQDN=$(az containerapp show -n "api-$NAME" -g "$RG" --query properties.configuration.ingress.fqdn -o tsv 2>/dev/null || true)

# Keep API internal; web proxies via API_UPSTREAM
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
ADMIN_PASSWORD=$ADMIN_PASSWORD
POSTGRES_FQDN=$PG_FQDN
NAME_PREFIX=$NAME
EOF

echo ""
echo "============================================"
echo " AgentRadar Discovery deployed to Azure"
echo " Web:  https://$WEB_FQDN"
echo " API:  http://api-$NAME (internal; proxied via web /api)"
echo " Login: $ADMIN_EMAIL"
echo " Password saved in $AZURE_DIR/.last-deploy.env"
echo "============================================"
