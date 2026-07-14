# Visentra — AI Governance, Risk & Security Platform

> **Discover. Govern. Secure. Every AI agent, everywhere.**

## Discovery & Visibility Platform (new)

A greenfield **Enterprise AI Agent Discovery & Visibility** track (CrowdStrike-for-agents + Wiz-for-AI + Datadog-for-runtime + CMDB-for-AI-assets) lives alongside the legacy governance stack:

| Artifact | Path |
|----------|------|
| Engineering blueprint (30 deliverables) | [`docs/blueprint/`](./docs/blueprint/) |
| Working MVP (API, web, discovery, compose) | [`platform/`](./platform/) |

```bash
cd platform/infra/compose && docker compose up -d --build
# UI http://localhost:5173  —  admin@agentradar.local / Visentra!dev
```

Scope of the new track: **Discover · Inventory · Relationships · Visibility** (no governance/remediation yet). The root Compose V1 and AKS `deploy/` stacks below are unchanged.

---

Visentra is an enterprise AI governance platform that gives organizations complete visibility, risk intelligence, and compliance control over every AI agent running in their cloud environment. Built on a Bring Your Own Cloud (BYOC) model, Visentra deploys entirely inside the customer's own Azure tenant — your data never leaves your environment.

## Platform loop

```
DISCOVER → ASSESS → GOVERN → PROVE
```

## V1 modules

| # | Module | Status |
|---|---|---|
| 1 | Continuous AI Agent Discovery | Active |
| 2 | PHI / Sensitive Data Detection | Active |
| 3 | Automated Risk & Compliance Scoring | Active |
| 4 | Role-Based Access Control (RBAC) | Active |
| 5 | Multi-Factor Authentication (MFA) | Active |
| 6 | Audit Logging & Evidence Generation | Active |
| 7 | SIEM & Observability Integration | Active |
| 8 | Multi-Tenant Architecture | Active |
| 9 | BYOC Security Architecture | Active |
| 10 | Compliance Reporting & Evidence Export | Active |

## Quick start

```bash
cp .env.example .env
# Edit secrets: JWT_SECRET, POSTGRES_PASSWORD, ENCRYPTION_KEY, etc.

# Local TLS (or use Let's Encrypt — see certs/README.md)
openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
  -keyout certs/key.pem -out certs/cert.pem -subj "/CN=localhost"

docker compose up -d --build
docker compose logs api --tail=40
curl -sk https://localhost/health
```

Default bootstrap admin (from `.env`):

- Email: `BOOTSTRAP_ADMIN_EMAIL`
- Password: `BOOTSTRAP_ADMIN_PASSWORD`

## Local development (without Docker for API)

```bash
# Start Postgres + Redis (or use docker compose up postgres redis -d)
cp .env.example .env
# Set POSTGRES_HOST=localhost REDIS_HOST=localhost COOKIE_SECURE=false

npm install
npm run migrate
npm run dev
# Open http://localhost:3000
```

## Architecture

```
Internet → nginx (TLS + headers) → Node.js API
                                      ├── PostgreSQL 15
                                      └── Redis 7
Outbound: Azure Management API · Azure Monitor
```

## Documentation

- [DEPLOYMENT_GUIDE.md](./DEPLOYMENT_GUIDE.md)
- [PROJECT_STRUCTURE.md](./PROJECT_STRUCTURE.md)
- [KNOWN_LIMITATIONS.md](./KNOWN_LIMITATIONS.md)
- [RELEASE_NOTES.md](./RELEASE_NOTES.md)
- [CHANGE_SUMMARY.md](./CHANGE_SUMMARY.md)

## Security posture

| Control | Status |
|---|---|
| TLS (nginx / Let's Encrypt) | Active |
| httpOnly JWT cookies | Active |
| MFA for privileged roles | Active |
| RBAC (4 roles) | Active |
| CSRF protection | Active |
| Redis rate limiting | Active |
| CSP / HSTS / X-Frame-Options | Active |
| AES-256-GCM credential encryption | Active |
| Azure Monitor audit forwarding | Active |
| BYOC data residency | By architecture |

---

*Visentra is built for enterprises that take AI governance seriously — not as a compliance checkbox, but as a foundational operational discipline.*
