#!/usr/bin/env bash
# Provision AgentRadar V1 on a new Azure resource group (Sponsorship subscription)
set -euo pipefail

SUBSCRIPTION_ID="${SUBSCRIPTION_ID:-74645e41-3fa1-4898-9926-a054ba3fe3b1}"
LOCATION="${LOCATION:-eastus}"
RG="${RG:-rg-agentradar-v1}"
PREFIX="${PREFIX:-arv1}"
VM_SIZE="${VM_SIZE:-Standard_D2s_v3}"
ADMIN_USER="${ADMIN_USER:-azureuser}"

echo "==> Using subscription $SUBSCRIPTION_ID"
az account set --subscription "$SUBSCRIPTION_ID"

echo "==> Creating resource group $RG"
az group create -n "$RG" -l "$LOCATION" -o none

echo "==> Creating Log Analytics workspace"
az monitor log-analytics workspace create \
  -g "$RG" -n "log-${PREFIX}" -l "$LOCATION" -o none

WORKSPACE_ID=$(az monitor log-analytics workspace show -g "$RG" -n "log-${PREFIX}" --query customerId -o tsv)
WORKSPACE_KEY=$(az monitor log-analytics workspace get-shared-keys -g "$RG" -n "log-${PREFIX}" --query primarySharedKey -o tsv)

echo "==> Creating Key Vault"
az keyvault create -g "$RG" -n "kv-${PREFIX}$(openssl rand -hex 2)" -l "$LOCATION" --enable-rbac-authorization false -o none 2>/dev/null \
  || az keyvault create -g "$RG" -n "kv-${PREFIX}$(date +%s | tail -c 5)" -l "$LOCATION" -o none
KV_NAME=$(az keyvault list -g "$RG" --query "[0].name" -o tsv)

echo "==> Creating ACR"
az acr create -g "$RG" -n "acr${PREFIX}$(openssl rand -hex 2)" -l "$LOCATION" --sku Basic --admin-enabled true -o none
ACR_NAME=$(az acr list -g "$RG" --query "[0].name" -o tsv)
ACR_LOGIN=$(az acr show -g "$RG" -n "$ACR_NAME" --query loginServer -o tsv)
ACR_USER=$(az acr credential show -n "$ACR_NAME" --query username -o tsv)
ACR_PASS=$(az acr credential show -n "$ACR_NAME" --query "passwords[0].value" -o tsv)

echo "==> Creating network"
az network vnet create -g "$RG" -n "vnet-${PREFIX}" -l "$LOCATION" \
  --address-prefix 10.20.0.0/16 --subnet-name "snet-app" --subnet-prefix 10.20.1.0/24 -o none

az network nsg create -g "$RG" -n "nsg-${PREFIX}" -l "$LOCATION" -o none
az network nsg rule create -g "$RG" --nsg-name "nsg-${PREFIX}" -n allow-ssh --priority 1000 \
  --access Allow --protocol Tcp --destination-port-ranges 22 --source-address-prefixes '*' -o none
az network nsg rule create -g "$RG" --nsg-name "nsg-${PREFIX}" -n allow-http --priority 100 \
  --access Allow --protocol Tcp --destination-port-ranges 80 --source-address-prefixes '*' -o none
az network nsg rule create -g "$RG" --nsg-name "nsg-${PREFIX}" -n allow-https --priority 110 \
  --access Allow --protocol Tcp --destination-port-ranges 443 --source-address-prefixes '*' -o none

az network public-ip create -g "$RG" -n "pip-${PREFIX}" -l "$LOCATION" --sku Standard --allocation-method Static -o none
az network nic create -g "$RG" -n "nic-${PREFIX}" -l "$LOCATION" \
  --vnet-name "vnet-${PREFIX}" --subnet "snet-app" --network-security-group "nsg-${PREFIX}" \
  --public-ip-address "pip-${PREFIX}" -o none

echo "==> Creating VM $PREFIX-vm"
az vm create -g "$RG" -n "${PREFIX}-vm" -l "$LOCATION" \
  --size "$VM_SIZE" \
  --nics "nic-${PREFIX}" \
  --image Ubuntu2204 \
  --admin-username "$ADMIN_USER" \
  --generate-ssh-keys \
  --public-ip-sku Standard \
  -o none

PUBLIC_IP=$(az network public-ip show -g "$RG" -n "pip-${PREFIX}" --query ipAddress -o tsv)

# Generate app secrets
JWT_SECRET=$(openssl rand -hex 32)
ENCRYPTION_KEY=$(openssl rand -hex 32)
POSTGRES_PASSWORD=$(openssl rand -base64 24 | tr -d '/+=' | head -c 24)
BOOTSTRAP_PASSWORD="ChangeMeAdmin$(openssl rand -hex 4)!"

# Store secrets in Key Vault
az keyvault secret set --vault-name "$KV_NAME" --name jwt-secret --value "$JWT_SECRET" -o none
az keyvault secret set --vault-name "$KV_NAME" --name encryption-key --value "$ENCRYPTION_KEY" -o none
az keyvault secret set --vault-name "$KV_NAME" --name postgres-password --value "$POSTGRES_PASSWORD" -o none
az keyvault secret set --vault-name "$KV_NAME" --name bootstrap-admin-password --value "$BOOTSTRAP_PASSWORD" -o none

# Write local deploy artifacts (gitignored path under /tmp)
OUT_DIR="${OUT_DIR:-/tmp/agentradar-v1-deploy}"
mkdir -p "$OUT_DIR"
cat > "$OUT_DIR/deploy-info.env" <<EOF
RG=$RG
LOCATION=$LOCATION
PUBLIC_IP=$PUBLIC_IP
VM_NAME=${PREFIX}-vm
ADMIN_USER=$ADMIN_USER
ACR_NAME=$ACR_NAME
ACR_LOGIN=$ACR_LOGIN
ACR_USER=$ACR_USER
ACR_PASS=$ACR_PASS
KV_NAME=$KV_NAME
WORKSPACE_ID=$WORKSPACE_ID
WORKSPACE_KEY=$WORKSPACE_KEY
JWT_SECRET=$JWT_SECRET
ENCRYPTION_KEY=$ENCRYPTION_KEY
POSTGRES_PASSWORD=$POSTGRES_PASSWORD
BOOTSTRAP_ADMIN_EMAIL=admin@example.com
BOOTSTRAP_ADMIN_PASSWORD=$BOOTSTRAP_PASSWORD
EOF

echo "==> Infra ready"
echo "PUBLIC_IP=$PUBLIC_IP"
echo "RG=$RG"
echo "ACR=$ACR_LOGIN"
echo "Wrote $OUT_DIR/deploy-info.env"
