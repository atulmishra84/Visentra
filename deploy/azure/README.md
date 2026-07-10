# Azure V1 Deploy Notes

## Live deployment (Sponsorship subscription)

| Item | Value |
|---|---|
| Subscription | Microsoft Azure Sponsorship (`74645e41-3fa1-4898-9926-a054ba3fe3b1`) |
| Resource group | `rg-agentradar-v1` (eastus) |
| VM | `vm-agentradar-v1` (`Standard_D4s_v7`) |
| Stack | Docker Compose: nginx + api + postgres + redis |
| App path on VM | `/opt/agentradar` |
| GitHub | https://github.com/atulmishra84/AgentRadar |

## Recreate pattern

1. `az group create -n rg-agentradar-v1 -l eastus`
2. `az vm create ... --custom-data deploy/azure/cloud-init.yml --size Standard_D4s_v7`
3. Open NSG ports 80/443
4. Unpack release tarball to `/opt/agentradar`, write `.env`, `docker compose up -d --build`

Cloud-init installs Docker Engine + Compose plugin.
