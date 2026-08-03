#!/usr/bin/env bash
# Redeploy AgentRadar full-product UI to rg-agentradar-v1 / vm-agentradar-v1
# Prerequisites: az login, Contributor on the subscription
set -euo pipefail
RG="${RG:-rg-agentradar-v1}"
VM="${VM:-vm-agentradar-v1}"
BRANCH="${BRANCH:-cursor/full-product-ui}"
REPO_SLUG="${REPO_SLUG:-atulmishra84/AgentRadar}"

az account show >/dev/null

TOKEN="${GITHUB_TOKEN:-}"
if [[ -z "$TOKEN" ]] && command -v gh >/dev/null; then
  TOKEN="$(gh auth token 2>/dev/null || true)"
fi

if [[ -n "$TOKEN" ]]; then
  CLONE_URL="https://x-access-token:${TOKEN}@github.com/${REPO_SLUG}.git"
else
  CLONE_URL="https://github.com/${REPO_SLUG}.git"
fi

echo "Redeploying $VM in $RG from $BRANCH ..."

# shellcheck disable=SC2016
az vm run-command invoke -g "$RG" -n "$VM" --command-id RunShellScript \
  --scripts \
  "set -e
BRANCH='$BRANCH'
CLONE_URL='$CLONE_URL'
cd /opt
rm -rf /tmp/agentradar-src
git clone --depth 1 --branch \"\$BRANCH\" \"\$CLONE_URL\" /tmp/agentradar-src
mkdir -p /opt/agentradar/certs
if [ -f /opt/agentradar/.env ]; then cp /opt/agentradar/.env /tmp/ar.env.bak; fi
if [ -d /opt/agentradar/certs ]; then cp -a /opt/agentradar/certs /tmp/ar.certs.bak || true; fi
rsync -a --delete --exclude .env --exclude certs --exclude node_modules /tmp/agentradar-src/ /opt/agentradar/
if [ -f /tmp/ar.env.bak ]; then cp /tmp/ar.env.bak /opt/agentradar/.env; fi
if [ -d /tmp/ar.certs.bak ]; then cp -a /tmp/ar.certs.bak/. /opt/agentradar/certs/; fi
cd /opt/agentradar
if [ ! -f .env ]; then echo 'Missing .env'; exit 1; fi
if [ ! -f certs/cert.pem ]; then
  openssl req -x509 -nodes -days 365 -newkey rsa:2048 -keyout certs/key.pem -out certs/cert.pem -subj '/CN=agentradar-v1'
fi
docker compose up -d --build
sleep 25
docker compose ps
curl -sk https://127.0.0.1/health || true
echo
echo REDEPLOY_OK
"

IP="$(az network public-ip show -g "$RG" -n vm-agentradar-v1PublicIP --query ipAddress -o tsv 2>/dev/null || true)"
if [[ -n "$IP" ]]; then
  echo "Public health check: https://$IP/health"
  curl -sk "https://$IP/health" || true
  echo
fi
