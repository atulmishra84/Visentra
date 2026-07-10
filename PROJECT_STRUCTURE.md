# Project Structure — AgentRadar V1

```
agentRadar/
├── server.js                 # Express API (all module routes)
├── index.html                # SPA frontend (module views 1–10)
├── nginx.conf                # TLS reverse proxy + security headers
├── docker-compose.yml        # postgres, redis, api, nginx
├── Dockerfile                # API image (migrate + start)
├── package.json
├── .env.example
├── sql/
│   └── schema.sql            # Core multi-tenant schema
├── scripts/
│   └── migrate.js            # Apply schema + bootstrap admin
├── src/
│   ├── config/index.js       # Env loader
│   ├── models/
│   │   ├── db.js             # PostgreSQL pool
│   │   └── redis.js          # Redis client
│   ├── middleware/
│   │   ├── auth.js           # JWT + RBAC
│   │   ├── tenant.js         # Tenant scoping
│   │   └── rateLimit.js      # Auth rate limit + CSRF
│   ├── utils/
│   │   └── crypto.js         # AES-256-GCM
│   └── services/
│       ├── discovery.js      # Module 1
│       ├── phi.js            # Module 2
│       ├── risk.js           # Module 3
│       ├── mfa.js            # Module 5
│       ├── audit.js          # Module 6
│       ├── siem.js           # Module 7
│       └── reports.js        # Module 10
├── certs/                    # TLS material (gitignored)
├── DEPLOYMENT_GUIDE.md
├── KNOWN_LIMITATIONS.md
├── RELEASE_NOTES.md
├── CHANGE_SUMMARY.md
└── README.md
```

## Module → code map

| Module | Primary files |
|---|---|
| 1 Discovery | `src/services/discovery.js`, `/api/agents`, `/api/discovery/*` |
| 2 PHI | `src/services/phi.js`, `/api/phi/*` |
| 3 Risk | `src/services/risk.js`, `/api/risk/register` |
| 4 RBAC | `src/middleware/auth.js`, `/api/users` |
| 5 MFA | `src/services/mfa.js`, `/api/mfa/*` |
| 6 Audit | `src/services/audit.js`, `/api/audit/*` |
| 7 SIEM | `src/services/siem.js` (called from audit) |
| 8 Multi-tenant | `src/middleware/tenant.js`, `/api/tenants`, `tenant_id` columns |
| 9 BYOC security | `nginx.conf`, helmet, cookies, CSRF, rate limit, crypto |
| 10 Reports | `src/services/reports.js`, `/api/reports/compliance` |

## Roles

| Role | Scope |
|---|---|
| `platform_admin` | Full config, tenants, users |
| `ciso` | Risk oversight, users (read), reports |
| `analyst` | Discovery, PHI clear, investigation |
| `auditor` | Read-only audit + compliance evidence |
