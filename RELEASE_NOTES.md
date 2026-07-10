# Release Notes — AgentRadar V1.0.0

## Highlights

First module-complete BYOC release of AgentRadar with the continuous governance loop:

**Discover → Assess → Govern → Prove**

### Modules shipped

1. **Continuous AI Agent Discovery** — Azure ARM enumeration (or demo inventory), scheduled refresh, inventory UI
2. **PHI / Sensitive Data Detection** — keyword, resource-type, and protocol vectors; HIPAA fail-until-cleared
3. **Automated Risk & Compliance Scoring** — composite scores with framework mapping and factor breakdown
4. **RBAC** — platform_admin, ciso, analyst, auditor enforced in middleware
5. **MFA** — TOTP enrollment (QR) for privileged roles via otplib
6. **Audit Logging** — structured PostgreSQL events + JSON/CSV export
7. **SIEM Integration** — Azure Monitor Log Analytics forwarding (fail-soft)
8. **Multi-Tenant** — tenant-scoped data model and admin tenant APIs
9. **BYOC Security** — TLS nginx edge, secure cookies, CSRF, rate limits, AES-256-GCM secrets
10. **Compliance Reporting** — on-demand board/auditor reports with CSV export

### Runtime

- Node.js 20 + Express
- PostgreSQL 15
- Redis 7
- nginx TLS reverse proxy
- Docker Compose reference deployment
