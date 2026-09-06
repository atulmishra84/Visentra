#!/usr/bin/env bash
# Cloud Agent "start" phase for the Visentra platform.
# Per-boot runtime initialization: bring up the PostgreSQL and Neo4j daemons and
# wait until both are ready. Application services run in the named terminals.
set -euo pipefail

echo "[start] Starting PostgreSQL..."
sudo pg_ctlcluster 16 main start || true

echo "[start] Starting Neo4j..."
sudo neo4j start || true

echo "[start] Waiting for PostgreSQL..."
for _ in $(seq 1 30); do
  if sudo -u postgres pg_isready -q; then echo "[start] PostgreSQL ready."; break; fi
  sleep 1
done

echo "[start] Waiting for Neo4j (bolt://localhost:7687)..."
for _ in $(seq 1 40); do
  if cypher-shell -a bolt://localhost:7687 -u neo4j -p agentradar "RETURN 1;" >/dev/null 2>&1; then
    echo "[start] Neo4j ready."; break
  fi
  sleep 3
done

echo "[start] Databases up."
