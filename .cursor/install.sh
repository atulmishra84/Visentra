#!/usr/bin/env bash
# Cloud Agent "install" phase for the Visentra platform.
# Idempotent, non-interactive durable setup: system packages (PostgreSQL, Java, Neo4j),
# database/role provisioning, and Node dependency installation.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "[install] Installing system packages (PostgreSQL, Java, Neo4j)..."
export DEBIAN_FRONTEND=noninteractive
sudo apt-get update -y

# PostgreSQL
sudo apt-get install -y postgresql postgresql-contrib

# Java (required by Neo4j) + Neo4j apt repo
sudo apt-get install -y openjdk-21-jre-headless wget gnupg
if [ ! -f /usr/share/keyrings/neo4j.gpg ]; then
  wget -qO - https://debian.neo4j.com/neotechnology.gpg.key | sudo gpg --dearmor -o /usr/share/keyrings/neo4j.gpg
fi
echo "deb [signed-by=/usr/share/keyrings/neo4j.gpg] https://debian.neo4j.com stable 5" | sudo tee /etc/apt/sources.list.d/neo4j.list >/dev/null
sudo apt-get update -y
sudo apt-get install -y neo4j

echo "[install] Starting PostgreSQL to provision role/database..."
sudo pg_ctlcluster 16 main start || true
# Wait for postgres to accept connections
for _ in $(seq 1 30); do
  if sudo -u postgres pg_isready -q; then break; fi
  sleep 1
done

echo "[install] Provisioning PostgreSQL role and database (idempotent)..."
sudo -u postgres psql -tc "SELECT 1 FROM pg_roles WHERE rolname='agentradar'" | grep -q 1 \
  || sudo -u postgres psql -c "CREATE USER agentradar WITH PASSWORD 'agentradar';"
sudo -u postgres psql -tc "SELECT 1 FROM pg_database WHERE datname='agentradar'" | grep -q 1 \
  || sudo -u postgres psql -c "CREATE DATABASE agentradar OWNER agentradar;"

echo "[install] Setting Neo4j initial password (only effective on a fresh store)..."
sudo neo4j-admin dbms set-initial-password agentradar || true

echo "[install] Installing Node workspace dependencies..."
cd "$REPO_ROOT/platform"
npm install

echo "[install] Done."
