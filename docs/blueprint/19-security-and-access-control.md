# 19 - Security and Access Control

## Overview

Visentra must be enterprise-ready from the first release. Security includes tenant isolation, SSO, RBAC, service authentication, collector identity, secrets handling, audit events, export controls, and evidence access controls.

## Authentication

Supported authentication modes:

- Enterprise SSO through OIDC/SAML.
- API tokens for service integrations.
- Collector credentials for enrolled collectors.
- Internal service identities for microservice calls.

## RBAC Roles

| Role | Capabilities |
|---|---|
| Executive Viewer | Read executive dashboards and high-level inventory. |
| Operations Analyst | Read inventory, evidence metadata, topology, events; export if granted. |
| Platform Admin | Manage collectors, integrations, source settings, coverage. |
| AI Platform Viewer | Read model/framework/MCP/repository usage. |
| Developer Scoped Viewer | Read owned/team assets. |
| Auditor | Read snapshots, events, exports; no settings changes. |
| Tenant Admin | Manage users, roles, tenant settings. |

## Permission Categories

- `inventory:read`
- `inventory:evidence:read`
- `inventory:raw_evidence:read`
- `topology:read`
- `events:read`
- `exports:create`
- `exports:read`
- `collectors:manage`
- `integrations:manage`
- `settings:manage`
- `audit:read`
- `api_tokens:manage`

## Field-Level Visibility

Some fields require elevated access:

- Raw evidence payload references.
- Identity emails/usernames.
- Device identifiers.
- Cloud resource native IDs.
- Command fingerprints.
- Local path hashes/previews.
- Browser extension host permissions.

## Service Authentication

- Services use short-lived credentials or mTLS.
- Service calls include tenant context.
- Service authorization is separate from human RBAC.
- All service-to-service requests include request IDs.

## Collector Security

- Enrollment tokens are short-lived.
- Collectors have scoped identities.
- Observation batches are signed.
- Collector keys rotate.
- Revoked collectors cannot submit data.
- Collector config never exposes unrelated tenant secrets.

## Secrets Handling

- Store integration credentials in managed secret storage.
- Never log secrets.
- Redact environment variables and command lines.
- Use secret scanners in CI.
- Audit credential create/update/delete.

## Audit Events

Audit these actions:

- Login/logout.
- Inventory export.
- Evidence access.
- Raw evidence access.
- Integration configuration changes.
- Collector enrollment/revocation.
- User/role changes.
- API token creation/deletion.
- Tenant retention changes.

## Security Headers and Frontend

- CSP with restrictive defaults.
- Secure cookies.
- CSRF protection for browser sessions.
- XSS-safe rendering of evidence previews.
- No secrets in browser storage.

## Related Documents

- [18-data-governance-boundaries.md](./18-data-governance-boundaries.md)
- [24-deployment-architecture.md](./24-deployment-architecture.md)
- [26-testing-and-quality-strategy.md](./26-testing-and-quality-strategy.md)
