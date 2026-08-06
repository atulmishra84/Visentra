#!/bin/bash
set -euo pipefail
NAMESPACE=agentradar
ACR=acragentradarprod.azurecr.io
TAG=${1:-latest}

echo "=== AgentRadar AKS Deployment ==="
echo "Tag: $TAG | Namespace: $NAMESPACE"

# 1. Login to ACR
echo "[1/7] Logging into ACR..."
az acr login --name acragentradarprod

# 2. Build and push images
echo "[2/7] Building and pushing images..."
docker build -t $ACR/agentradar-api:$TAG -f k8s/../docker/Dockerfile.api .
docker build -t $ACR/agentradar-frontend:$TAG -f k8s/../docker/Dockerfile.frontend .
docker push $ACR/agentradar-api:$TAG
docker push $ACR/agentradar-frontend:$TAG

# 3. Create namespace and secrets
echo "[3/7] Applying secrets..."
kubectl apply -f k8s/secrets/secrets.yaml

# 4. Apply base manifests
echo "[4/7] Applying k8s manifests..."
kubectl apply -k k8s/overlays/prod/

# 5. Wait for rollout
echo "[5/7] Waiting for rollout..."
kubectl rollout status deployment/agentradar-api -n $NAMESPACE --timeout=300s
kubectl rollout status deployment/agentradar-frontend -n $NAMESPACE --timeout=300s

# 6. Verify
echo "[6/7] Verifying pods..."
kubectl get pods -n $NAMESPACE
kubectl get svc -n $NAMESPACE
kubectl get ingress -n $NAMESPACE

# 7. Health check
echo "[7/7] Health check..."
sleep 10
kubectl exec -n $NAMESPACE deploy/agentradar-api -- \
  wget -qO- http://localhost:4000/health && echo "API: OK"

echo ""
echo "✅ Deployment complete!"
echo "   Platform: https://agentradar.idenaccess.com"
