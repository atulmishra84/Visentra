#!/usr/bin/env bash
# Tear down an AgentRadar cloud deployment (deletes the resource group).
set -euo pipefail

RG="${RG:-}"
YES=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --rg)
      RG="${2:-}"
      shift 2
      ;;
    --rg=*)
      RG="${1#*=}"
      shift
      ;;
    -y|--yes)
      YES=true
      shift
      ;;
    -h|--help)
      echo "Usage: ./teardown.sh --rg <resource-group> [--yes]"
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

if [[ -z "$RG" && -f "$(dirname "$0")/out/last-deploy.env" ]]; then
  # shellcheck disable=SC1091
  source "$(dirname "$0")/out/last-deploy.env"
fi

if [[ -z "${RG:-}" ]]; then
  echo "ERROR: Pass --rg <resource-group> or run from a prior install (out/last-deploy.env)." >&2
  exit 1
fi

echo "This will DELETE resource group '$RG' and all AgentRadar resources inside it."
if [[ "$YES" != "true" ]]; then
  read -r -p "Type the resource group name to confirm: " confirm
  if [[ "$confirm" != "$RG" ]]; then
    echo "Aborted."
    exit 1
  fi
fi

az group delete --name "$RG" --yes --no-wait
echo "Delete started for '$RG' (async). Monitor in Azure Portal."
