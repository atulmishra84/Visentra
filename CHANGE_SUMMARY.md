# Change Summary — AgentRadar V1 Module Build

## What was added

Root-level BYOC application implementing all 10 V1 capabilities as modular services behind a single Express API and SPA:

- `server.js` + `src/**` application layer
- `sql/schema.sql` multi-tenant schema (tenants, users, agents, audit, credentials, MFA)
- `docker-compose.yml`, `Dockerfile`, `nginx.conf`, `certs/README.md`
- SPA `index.html` with views for modules 1–10
- Ops docs: README, DEPLOYMENT_GUIDE, PROJECT_STRUCTURE, KNOWN_LIMITATIONS, RELEASE_NOTES

## Preserved

Existing AKS-oriented assets remain in-tree for customers already on that path:

- `deploy/`, `helm/`, `terraform/`, `bicep/`, `migrations/`, `.github/workflows/`

The Compose stack is the supported path for the module-wise V1 product surface described in the product brief.

## Security defaults

- API not published on host ports
- JWT in httpOnly / SameSite=strict cookies
- CSRF on mutating `/api/*` routes
- Redis rate limiting on `/api/auth/login`
- Helmet CSP + HSTS
- bcrypt password hashes; AES-256-GCM for stored integration secrets
