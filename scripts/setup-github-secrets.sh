#!/usr/bin/env bash
# AgentRadar — Auto-populate GitHub Actions secrets from Terraform outputs
#
# Run this ONCE after bootstrap.sh. It reads terraform output and sets
# every GitHub secret the pipeline needs in one command.
#
# Prerequisites:
#   gh auth login          (GitHub CLI — https://cli.github.com)
#   terraform outputs exist (bootstrap.sh has been run)
#
# Usage:
#   chmod +x scripts/setup-github-secrets.sh
#   ./scripts/setup-github-secrets.sh
#
set -euo pipefail

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; BOLD='\033[1m'; NC='\033[0m'
log()  { echo -e "${GREEN}[secrets]${NC} $1"; }
warn() { echo -e "${YELLOW}[warn]${NC}    $1"; }
err()  { echo -e "${RED}[error]${NC}   $1" >&2; exit 1; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TF_DIR="$SCRIPT_DIR/../terraform/standalone"

# ── Prerequisites ─────────────────────────────────────────
command -v gh        >/dev/null 2>&1 || err "GitHub CLI required: brew install gh  OR  https://cli.github.com"
command -v terraform >/dev/null 2>&1 || err "Terraform required"
command -v az        >/dev/null 2>&1 || err "Azure CLI required"

gh auth status &>/dev/null || err "Not logged in to GitHub. Run: gh auth login"
az account show &>/dev/null || err "Not logged in to Azure. Run: az login"

# ── Detect repo ───────────────────────────────────────────
REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner 2>/dev/null) \
  || err "Not inside a GitHub repo. cd into your repo first."
log "Repository: $REPO"

# ── Read Terraform outputs ────────────────────────────────
echo ""
log "Reading terraform outputs from $TF_DIR..."
cd "$TF_DIR"

# Check state is populated
terraform output acr_login_server &>/dev/null \
  || err "No terraform state found. Run bootstrap.sh first."

ACR_LOGIN_SERVER=$(terraform output -raw acr_login_server)
ACR_NAME="${ACR_LOGIN_SERVER%%.*}"
AKS_NAME=$(terraform output -raw aks_name)
RG_NAME=$(terraform output -raw resource_group_name)
KV_URI=$(terraform output -raw keyvault_uri)
PG_HOST=$(terraform output -raw postgres_fqdn)
REDIS_HOST=$(terraform output -raw redis_hostname)

# Terraform state storage — read from backend config
TF_STATE_RG=$(grep 'resource_group_name' .terraform/terraform.tfstate 2>/dev/null \
  | head -1 | awk -F'"' '{print $4}' || terraform -chdir=.. state pull 2>/dev/null | \
  python3 -c "import sys,json; s=json.load(sys.stdin); print(s.get('backend',{}).get('config',{}).get('resource_group_name',''))" 2>/dev/null || echo "")
TF_STATE_SA=$(grep 'storage_account_name' .terraform/terraform.tfstate 2>/dev/null \
  | head -1 | awk -F'"' '{print $4}' || echo "")

# If we can't read from state file, ask
if [[ -z "$TF_STATE_RG" ]]; then
  warn "Cannot auto-detect TF state RG from local state — reading tfvars..."
  TF_STATE_RG=$(az storage account list --query "[?contains(name,'agentradartf')].resourceGroup" -o tsv 2>/dev/null | head -1 || echo "")
fi
if [[ -z "$TF_STATE_SA" ]]; then
  TF_STATE_SA=$(az storage account list --query "[?contains(name,'agentradartf')].name" -o tsv 2>/dev/null | head -1 || echo "")
fi

# Get subscription and tenant from current Azure session
SUBSCRIPTION_ID=$(az account show --query id -o tsv)
TENANT_ID=$(az account show --query tenantId -o tsv)

# Get service principal client ID (the one OIDC was set up for)
SP_NAME="sp-agentRadar-cicd-prod"
CLIENT_ID=$(az ad sp list --display-name "$SP_NAME" --query "[0].appId" -o tsv 2>/dev/null || echo "")
if [[ -z "$CLIENT_ID" ]]; then
  warn "Cannot auto-detect service principal ID — you may need to set AZURE_CLIENT_ID manually"
  read -rp "  AZURE_CLIENT_ID (from bootstrap output): " CLIENT_ID
fi

# Get AKS kubelet identity for Managed Identity
KUBELET_CLIENT_ID=$(az aks show \
  --resource-group "$RG_NAME" \
  --name "$AKS_NAME" \
  --query "identityProfile.kubeletidentity.clientId" -o tsv 2>/dev/null || echo "")

# Domain from tfvars
DOMAIN=$(grep '^domain' terraform.tfvars 2>/dev/null | awk -F'"' '{print $2}' || echo "")
if [[ -z "$DOMAIN" ]]; then
  read -rp "  Domain (e.g. agentRadar.yourcompany.com): " DOMAIN
fi

# AI API key (optional)
AI_API_KEY="${AI_API_KEY:-}"
if [[ -z "$AI_API_KEY" ]]; then
  read -rsp "  AI provider API key (leave blank to skip): " AI_API_KEY
  echo ""
fi

cd "$SCRIPT_DIR/.."

# ── Set GitHub Secrets ────────────────────────────────────
echo ""
log "Setting GitHub Secrets on $REPO..."

set_secret() {
  local name="$1"
  local value="$2"
  if [[ -z "$value" ]]; then
    warn "Skipping empty secret: $name"
    return
  fi
  echo -n "  Setting $name ... "
  echo "$value" | gh secret set "$name" --repo "$REPO"
  echo "✓"
}

set_secret "AZURE_CLIENT_ID"       "$CLIENT_ID"
set_secret "AZURE_TENANT_ID"       "$TENANT_ID"
set_secret "AZURE_SUBSCRIPTION_ID" "$SUBSCRIPTION_ID"
set_secret "AZURE_RESOURCE_GROUP"  "$RG_NAME"
set_secret "AKS_CLUSTER_NAME"      "$AKS_NAME"
set_secret "ACR_LOGIN_SERVER"      "$ACR_LOGIN_SERVER"
set_secret "ACR_NAME"              "$ACR_NAME"
set_secret "KEYVAULT_URI"          "$KV_URI"
set_secret "POSTGRES_HOST"         "$PG_HOST"
set_secret "REDIS_HOST"            "$REDIS_HOST"
set_secret "TF_STATE_RG"           "$TF_STATE_RG"
set_secret "TF_STATE_SA"           "$TF_STATE_SA"
[[ -n "$AI_API_KEY" ]] && set_secret "AI_API_KEY" "$AI_API_KEY"

# ── Set GitHub Variables (non-sensitive) ──────────────────
echo ""
log "Setting GitHub Variables on $REPO..."

set_var() {
  local name="$1"
  local value="$2"
  if [[ -z "$value" ]]; then
    warn "Skipping empty variable: $name"
    return
  fi
  echo -n "  Setting var $name ... "
  gh variable set "$name" --body "$value" --repo "$REPO"
  echo "✓"
}

set_var "DOMAIN"                       "$DOMAIN"
set_var "MANAGED_IDENTITY_CLIENT_ID"   "$KUBELET_CLIENT_ID"

# ── Set up OIDC federated credentials ─────────────────────
echo ""
log "Verifying OIDC federated credentials on service principal..."

APP_ID=$(az ad app list --display-name "$SP_NAME" --query "[0].id" -o tsv 2>/dev/null || echo "")
if [[ -n "$APP_ID" ]]; then
  EXISTING_CREDS=$(az ad app federated-credential list --id "$APP_ID" \
    --query "[].subject" -o tsv 2>/dev/null || echo "")

  add_oidc_cred() {
    local subject="$1"
    local name="$2"
    if echo "$EXISTING_CREDS" | grep -q "$subject"; then
      echo "  Already set: $subject"
    else
      az ad app federated-credential create --id "$APP_ID" --parameters "{
        \"name\":\"$name\",
        \"issuer\":\"https://token.actions.githubusercontent.com\",
        \"subject\":\"$subject\",
        \"audiences\":[\"api://AzureADTokenExchange\"]
      }" -o none
      echo "  Added OIDC credential: $subject"
    fi
  }

  REPO_SLUG="${REPO//\/\//}"
  add_oidc_cred "repo:${REPO}:ref:refs/heads/main"           "github-main"
  add_oidc_cred "repo:${REPO}:ref:refs/heads/release/*"      "github-release"
  add_oidc_cred "repo:${REPO}:environment:prod"              "github-env-prod"
  add_oidc_cred "repo:${REPO}:pull_request"                  "github-pr"
else
  warn "Service principal '$SP_NAME' not found — OIDC creds not updated"
  warn "If you used a different SP name during bootstrap, add OIDC creds manually in Azure Portal"
fi

# ── Summary ───────────────────────────────────────────────
echo ""
echo -e "${GREEN}${BOLD}════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}${BOLD}  All GitHub secrets & variables set ✓${NC}"
echo -e "${GREEN}${BOLD}════════════════════════════════════════════════════${NC}"
echo ""
echo "  Repo:      $REPO"
echo "  ACR:       $ACR_LOGIN_SERVER"
echo "  AKS:       $AKS_NAME"
echo "  Domain:    $DOMAIN"
echo ""
echo "  Verify in GitHub:"
echo "  https://github.com/${REPO}/settings/secrets/actions"
echo ""
echo "  Trigger first pipeline run:"
echo "  git add . && git commit -m 'ci: initial deploy' && git push origin main"
echo ""
echo "  Or trigger manually:"
echo "  gh workflow run deploy.yml --ref main"
