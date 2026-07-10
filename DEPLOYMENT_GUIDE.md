# Deployment Guide — AgentRadar V1 (BYOC)

## Prerequisites

- Docker + Docker Compose
- Domain name pointed at your VM / load balancer (production)
- Azure service principal with Reader (or higher) on target subscriptions for live discovery
- Optional: Log Analytics workspace for SIEM forwarding

## 1. Configure environment

```bash
cp .env.example .env
```

Required secrets:

| Variable | Purpose |
|---|---|
| `JWT_SECRET` | Signs session JWTs |
| `POSTGRES_PASSWORD` | Database password |
| `ENCRYPTION_KEY` | 64 hex chars (32-byte AES-256 key) |
| `BOOTSTRAP_ADMIN_*` | First Platform Admin account |

Optional Azure:

| Variable | Purpose |
|---|---|
| `AZURE_TENANT_ID` / `AZURE_CLIENT_ID` / `AZURE_CLIENT_SECRET` | Discovery auth |
| `AZURE_SUBSCRIPTION_ID` | Subscription to scan |
| `DISCOVERY_DEMO_MODE=true` | Use built-in demo inventory without Azure |
| `LOG_ANALYTICS_WORKSPACE_ID` / `LOG_ANALYTICS_KEY` | SIEM forward |

## 2. TLS certificates

See [certs/README.md](./certs/README.md).

Production:

```bash
sudo certbot certonly --standalone -d your-domain.example.com
sudo cp /etc/letsencrypt/live/your-domain.example.com/fullchain.pem certs/cert.pem
sudo cp /etc/letsencrypt/live/your-domain.example.com/privkey.pem certs/key.pem
```

## 3. Start the platform

```bash
docker compose up -d --build
```

Services:

| Service | Role | Exposure |
|---|---|---|
| `nginx` | TLS termination, security headers, reverse proxy | 80/443 |
| `api` | Express application | Internal only |
| `postgres` | System of record | Internal only |
| `redis` | Rate-limit / MFA challenge state | Internal only |

## 4. Verify

```bash
docker compose logs api --tail=40
curl -sk https://your-domain.example.com/health
```

Sign in via the SPA with the bootstrap admin. Enroll MFA (Module 5) for Platform Admin / CISO before production use.

## 5. Discovery

- With Azure credentials and `DISCOVERY_DEMO_MODE=false`, scans call Azure Resource Manager.
- Otherwise demo resources are loaded so you can exercise PHI, risk, and reporting offline.
- Interval: `DISCOVERY_INTERVAL_MS` (default 1 hour).

## 6. SIEM

Forwarded custom log type: `AgentRadarAudit` → `AgentRadarAudit_CL` in Log Analytics.

```kusto
AgentRadarAudit_CL
| where TimeGenerated > ago(90d)
| where action_s in ("login","agent_flagged","compliance_export","user_provisioned","discovery_scan")
| order by TimeGenerated desc
```

## Network notes

- API port `3000` is not published to the host — only nginx is.
- Platform respects customer NSGs / private endpoints when deployed inside the customer VNet.
- Prefer storing secrets in Azure Key Vault and injecting via env at runtime.

## Existing AKS / Terraform assets

This repository also contains `terraform/`, `helm/`, and `deploy/` for AKS-oriented pipelines. The Docker Compose stack at the repo root is the supported BYOC reference for V1 module delivery.
