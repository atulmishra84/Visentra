# Known Limitations — AgentRadar V1

| Limitation | Status |
|---|---|
| PHI detection is metadata-based, not content/payload inspection | By design — roadmap: optional Azure AI Language integration |
| Azure discovery only (AWS/GCP not yet supported) | Roadmap |
| Binary PHI flag (no confidence scoring) | Roadmap |
| Formal database migration versioning beyond `sql/schema.sql` | Near-term priority (repo also has legacy `migrations/` for AKS path) |
| HA/DR and CI/CD pipeline formalization for Compose stack | Near-term roadmap |
| Demo discovery mode used when Azure credentials absent | Expected for offline / first-run demos |
| Multi-tenant SaaS shared data plane | Roadmap — V1 is logical tenants inside single BYOC deploy |
| SSO / SAML deep integration in root Compose app | Partial via env placeholders; AKS `deploy/api` has broader IdP code |

## Operational notes

- Audit events are append-only in PostgreSQL (UPDATE/DELETE rules). External immutability depends on successful Azure Monitor forwarding.
- CSRF uses a double-submit cookie (`ar_csrf` + `X-CSRF-Token`). SPA must call `/api/csrf` after login.
- MFA is required for `platform_admin` and `ciso` once enrolled; first login can complete before enrollment.
