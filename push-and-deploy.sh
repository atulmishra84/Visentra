#!/usr/bin/env bash
# AgentRadar — Push images & deploy to AKS
# Run this after bootstrap.sh has provisioned infrastructure.
#
# Usage:
#   chmod +x push-and-deploy.sh
#   ./push-and-deploy.sh
#
# Or with flags:
#   ./push-and-deploy.sh --tag v1.2.0 --skip-build
#
set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; BOLD='\033[1m'; NC='\033[0m'

log()  { echo -e "${GREEN}[deploy]${NC} $1"; }
warn() { echo -e "${YELLOW}[warn]${NC}   $1"; }
err()  { echo -e "${RED}[error]${NC}  $1" >&2; exit 1; }
step() { echo -e "\n${BLUE}${BOLD}── $1 ──${NC}"; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKIP_BUILD=false
IMAGE_TAG="latest"
PLATFORM_HTML="${PLATFORM_HTML:-agentRadarLaunch.html}"
NAMESPACE="agentRadar"

# Parse flags
while [[ $# -gt 0 ]]; do
  case $1 in
    --tag)         IMAGE_TAG="$2"; shift 2 ;;
    --skip-build)  SKIP_BUILD=true; shift ;;
    --html)        PLATFORM_HTML="$2"; shift 2 ;;
    --namespace)   NAMESPACE="$2"; shift 2 ;;
    *) err "Unknown flag: $1" ;;
  esac
done

# ── Read terraform outputs ────────────────────────────────
step "1 — Reading infrastructure details"

TF_DIR="$SCRIPT_DIR/terraform/standalone"
if [[ ! -d "$TF_DIR/.terraform" ]]; then
  err "Terraform not initialised at $TF_DIR — run bootstrap.sh first"
fi

cd "$TF_DIR"
log "Reading terraform outputs..."

ACR_SERVER=$(terraform output -raw acr_login_server     2>/dev/null) || err "Cannot read acr_login_server from terraform output"
AKS_NAME=$(terraform output -raw aks_name               2>/dev/null) || err "Cannot read aks_name from terraform output"
RG_NAME=$(terraform output -raw resource_group_name     2>/dev/null) || err "Cannot read resource_group_name from terraform output"
KV_URI=$(terraform output -raw keyvault_uri             2>/dev/null) || err "Cannot read keyvault_uri from terraform output"
PG_HOST=$(terraform output -raw postgres_fqdn           2>/dev/null) || err "Cannot read postgres_fqdn from terraform output"
REDIS_HOST=$(terraform output -raw redis_hostname       2>/dev/null) || err "Cannot read redis_hostname from terraform output"
DOMAIN=$(grep '^domain' terraform.tfvars 2>/dev/null | awk -F'"' '{print $2}') || DOMAIN=""

if [[ -z "$DOMAIN" ]]; then
  read -rp "  Domain name (e.g. agentRadar.yourcompany.com): " DOMAIN
fi

# Try to get kubelet identity client ID
MANAGED_IDENTITY_CLIENT_ID=$(terraform output -raw 2>/dev/null | grep kubelet_identity_client_id | awk '{print $3}' || echo "")

log "ACR:    $ACR_SERVER"
log "AKS:    $AKS_NAME  (RG: $RG_NAME)"
log "KV:     $KV_URI"
log "PG:     $PG_HOST"
log "Redis:  $REDIS_HOST"
log "Domain: $DOMAIN"

cd "$SCRIPT_DIR"

# ── Locate the HTML file ──────────────────────────────────
step "2 — Locating platform HTML"

if [[ ! -f "$PLATFORM_HTML" ]]; then
  # Search common locations
  for path in "." ".." "../.." ~/Downloads; do
    candidate="$path/$PLATFORM_HTML"
    if [[ -f "$candidate" ]]; then
      PLATFORM_HTML="$(realpath "$candidate")"
      break
    fi
  done
fi

if [[ ! -f "$PLATFORM_HTML" ]]; then
  err "Cannot find $PLATFORM_HTML — pass path with: --html /path/to/agentRadarLaunch.html"
fi

log "Platform HTML: $PLATFORM_HTML"

# ── Build Docker images ───────────────────────────────────
step "3 — Building Docker images"

if [[ "$SKIP_BUILD" == "true" ]]; then
  warn "Skipping build (--skip-build)"
else
  command -v docker >/dev/null 2>&1 || err "Docker not found — install from https://docs.docker.com/get-docker"

  # Copy HTML to frontend build context
  cp "$PLATFORM_HTML" "$SCRIPT_DIR/deploy/frontend/agentRadarLaunch.html"

  log "Building frontend..."
  docker build \
    -f deploy/frontend/Dockerfile \
    --build-arg PLATFORM_HTML=agentRadarLaunch.html \
    -t "$ACR_SERVER/agentRadar-frontend:$IMAGE_TAG" \
    deploy/frontend/

  log "Building API server..."
  docker build \
    -f deploy/api/Dockerfile \
    -t "$ACR_SERVER/agentRadar-api:$IMAGE_TAG" \
    deploy/api/

  log "Building webhook proxy..."
  docker build \
    -f deploy/webhook/Dockerfile \
    -t "$ACR_SERVER/agentRadar-webhook:$IMAGE_TAG" \
    deploy/webhook/

  log "Images built ✓"
fi

# ── Push to ACR ───────────────────────────────────────────
step "4 — Pushing images to ACR"

log "Logging in to ACR..."
az acr login --name "${ACR_SERVER%%.*}"

docker push "$ACR_SERVER/agentRadar-frontend:$IMAGE_TAG"
docker push "$ACR_SERVER/agentRadar-api:$IMAGE_TAG"
docker push "$ACR_SERVER/agentRadar-webhook:$IMAGE_TAG"

log "Images pushed ✓"

# ── Get AKS credentials ───────────────────────────────────
step "5 — Connecting to AKS"

az aks get-credentials \
  --resource-group "$RG_NAME" \
  --name "$AKS_NAME" \
  --overwrite-existing

kubectl cluster-info --request-timeout=10s
log "AKS connected ✓"

# ── Install NGINX ingress controller (if not present) ─────
step "6 — Ensuring NGINX ingress controller"

if ! kubectl get ns ingress-nginx &>/dev/null; then
  log "Installing NGINX ingress controller..."
  helm repo add ingress-nginx https://kubernetes.github.io/ingress-nginx
  helm repo update
  helm upgrade --install ingress-nginx ingress-nginx/ingress-nginx \
    --namespace ingress-nginx \
    --create-namespace \
    --set controller.service.annotations."service\.beta\.kubernetes\.io/azure-load-balancer-health-probe-request-path"=/healthz \
    --wait --timeout 5m
  log "NGINX ingress installed ✓"
else
  log "NGINX ingress already present ✓"
fi

# ── Install cert-manager (TLS certificates) ───────────────
step "7 — Ensuring cert-manager (TLS)"

if ! kubectl get ns cert-manager &>/dev/null; then
  log "Installing cert-manager..."
  helm repo add jetstack https://charts.jetstack.io
  helm repo update
  helm upgrade --install cert-manager jetstack/cert-manager \
    --namespace cert-manager \
    --create-namespace \
    --set installCRDs=true \
    --wait --timeout 5m

  # Let's Encrypt ClusterIssuer
  kubectl apply -f - <<EOF
apiVersion: cert-manager.io/v1
kind: ClusterIssuer
metadata:
  name: letsencrypt-prod
spec:
  acme:
    server: https://acme-v02.api.letsencrypt.org/directory
    email: admin@${DOMAIN}
    privateKeySecretRef:
      name: letsencrypt-prod
    solvers:
      - http01:
          ingress:
            class: nginx
EOF
  log "cert-manager installed ✓"
else
  log "cert-manager already present ✓"
fi

# ── Deploy AgentRadar via Helm ────────────────────────────
step "8 — Deploying AgentRadar"

HELM_CHART="$SCRIPT_DIR/helm/agentRadar"
[[ ! -d "$HELM_CHART" ]] && err "Helm chart not found at $HELM_CHART"

log "Running helm upgrade --install..."

helm upgrade --install agentRadar "$HELM_CHART" \
  --namespace "$NAMESPACE" \
  --create-namespace \
  --wait \
  --timeout 10m \
  --atomic \
  --cleanup-on-fail \
  --set global.imageRegistry="$ACR_SERVER" \
  --set global.imageTag="$IMAGE_TAG" \
  --set global.domain="$DOMAIN" \
  --set keyvault.vaultUri="$KV_URI" \
  --set postgres.host="$PG_HOST" \
  --set redis.host="$REDIS_HOST" \
  --set ingress.enabled=true \
  --set ingress.host="$DOMAIN" \
  ${MANAGED_IDENTITY_CLIENT_ID:+--set managedIdentity.clientId="$MANAGED_IDENTITY_CLIENT_ID"}

log "Helm deploy complete ✓"

# ── Run DB migrations ─────────────────────────────────────
step "9 — Running database migrations"

log "Waiting for API pod..."
kubectl wait --for=condition=ready pod \
  -l app=agentRadar-api \
  -n "$NAMESPACE" \
  --timeout=120s

API_POD=$(kubectl get pod -n "$NAMESPACE" -l app=agentRadar-api \
  -o jsonpath='{.items[0].metadata.name}')

log "Running migrations on pod $API_POD..."

# Copy schema file to pod and execute
kubectl cp migrations/001_schema.sql "$NAMESPACE/$API_POD:/tmp/schema.sql"
kubectl exec -n "$NAMESPACE" "$API_POD" -- \
  node -e "
    const {Pool}=require('pg');
    const fs=require('fs');
    const sql=fs.readFileSync('/tmp/schema.sql','utf8');
    const pool=new Pool({connectionString:process.env.DATABASE_URL||'postgresql://'+process.env.POSTGRES_USER+':'+process.env.DB_PASSWORD+'@'+process.env.POSTGRES_HOST+'/'+process.env.POSTGRES_DB+'?sslmode=require'});
    pool.query(sql)
      .then(()=>{console.log('Migrations applied ✓');pool.end();})
      .catch(e=>{console.error('Migration error:',e.message);process.exit(1);});
  "

log "Migrations complete ✓"

# ── DNS ───────────────────────────────────────────────────
step "10 — DNS setup"

INGRESS_IP=$(kubectl get svc ingress-nginx-controller \
  -n ingress-nginx \
  -o jsonpath='{.status.loadBalancer.ingress[0].ip}' 2>/dev/null || echo "pending")

echo ""
echo -e "${GREEN}${BOLD}════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}${BOLD}  AgentRadar deployed successfully! ✓${NC}"
echo -e "${GREEN}${BOLD}════════════════════════════════════════════════════${NC}"
echo ""
echo "  Platform URL:  https://${DOMAIN}"
echo "  Namespace:     ${NAMESPACE}"
echo "  Image tag:     ${IMAGE_TAG}"
echo ""

if [[ "$INGRESS_IP" == "pending" ]]; then
  warn "Ingress IP still provisioning. Check in 2-3 mins:"
  echo "  kubectl get svc ingress-nginx-controller -n ingress-nginx"
else
  echo -e "${YELLOW}${BOLD}  ACTION REQUIRED — Add this DNS A record:${NC}"
  echo "  ${DOMAIN}  →  ${INGRESS_IP}"
  echo ""
  echo "  After DNS propagates (5-30 min) your platform will be live at:"
  echo "  https://${DOMAIN}"
fi

echo ""
echo "  Default login:  admin@agentRadar.local  /  ChangeMe123!"
echo "  CHANGE THE PASSWORD immediately after first login."
echo ""
echo "  Useful commands:"
echo "  kubectl get pods -n ${NAMESPACE}"
echo "  kubectl logs -n ${NAMESPACE} -l app=agentRadar-api -f"
echo "  helm status agentRadar -n ${NAMESPACE}"
