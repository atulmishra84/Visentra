# 18 - Data Governance Boundaries

## Overview

Visentra handles sensitive enterprise metadata about AI agents, devices, identities, repositories, cloud infrastructure, SaaS tenants, browser extensions, and model usage. The platform must define clear data boundaries while avoiding product governance/remediation features in V1/V2.

## Product Boundary

Visentra V1/V2 provides:

- Discovery.
- Inventory.
- Relationship mapping.
- Search.
- Timeline visibility.
- Export.
- Coverage analysis.

Visentra V1/V2 does not provide:

- Policy enforcement.
- Agent approval workflows.
- Automated remediation.
- Blocking or disabling agents.
- Prompt/content governance.
- Data loss prevention.
- Runtime kill switches.

## Data Collection Principles

1. Prefer metadata over content.
2. Preserve evidence provenance.
3. Redact or hash sensitive values by default.
4. Keep source payload retention configurable.
5. Make evidence access RBAC-controlled.
6. Do not collect prompts or model responses by default.

## Sensitive Data Categories

| Category | Handling |
|---|---|
| Secrets/API keys | Never store raw; redact at collector and ingestion. |
| Prompt/model response content | Out of default scope. |
| File contents | Out of default scope except explicit customer configuration. |
| Local paths | Hash or redact unless allowed. |
| Command lines | Fingerprint and redact sensitive tokens. |
| Browser history | Out of scope. |
| Identity attributes | Store minimal required fields and apply RBAC. |
| Cloud resource identifiers | Store where needed for topology; treat as tenant data. |

## Tenant Isolation

- All persisted data includes tenant context.
- Object storage keys include tenant partition.
- NATS topics include tenant-aware authorization.
- Search and graph queries must include tenant filters.
- Internal support access requires audit events.

## Retention Controls

Tenant settings should control:

- Raw evidence payload retention.
- Observation metadata retention.
- Discovery event retention.
- Export artifact expiration.
- Audit log retention.
- Snapshot retention.

## Export Governance Boundary

Export is a visibility capability, not remediation. Export requirements:

- Permission-gated.
- Audited.
- Timestamped.
- Includes query/filter metadata.
- Redacts fields the actor cannot view.
- Supports expiration for generated artifacts.

## Evidence Access

Evidence access can be more sensitive than entity access. RBAC should distinguish:

- Entity summary read.
- Relationship read.
- Evidence metadata read.
- Raw evidence payload read.
- Export permission.

## Privacy Review Checklist

- Does the collector need this field for discovery or visibility?
- Can the field be hashed or redacted?
- Is there a safe preview alternative?
- Is retention configurable?
- Is access audited?
- Can the user understand why the field exists?

## Related Documents

- [05-information-architecture.md](./05-information-architecture.md)
- [19-security-and-access-control.md](./19-security-and-access-control.md)
- [30-roadmap.md](./30-roadmap.md)
