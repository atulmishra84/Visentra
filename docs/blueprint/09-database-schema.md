# 09 — Database Schema (PostgreSQL)

Canonical relational schema for Visentra Discovery & Visibility. Source of truth for migrations: [`platform/schemas/postgres.sql`](../../platform/schemas/postgres.sql).

Related: [05-information-architecture.md](./05-information-architecture.md), [10-graph-schema.md](./10-graph-schema.md), [14-inventory-data-model.md](./14-inventory-data-model.md).

## Design principles

- Every business row is tenant-scoped (`tenant_id`).
- Agents store core columns for hot filters; extensible attributes live in `JSONB`.
- Observations are append-only evidence; agents are resolved projections.
- Relationships are mirrored in SQL for inventory joins; Neo4j is the graph system of record for topology traversal.
- No governance/remediation tables (approvals, quarantine, playbooks) in this schema.

## Extensions

```sql
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";
```

## Core tables

### `tenants`

| Column | Type | Notes |
|--------|------|-------|
| id | UUID PK | |
| name | TEXT | Display name |
| slug | TEXT UNIQUE | URL-safe |
| status | TEXT | `active` \| `suspended` \| `archived` |
| settings | JSONB | Feature flags, retention |
| created_at / updated_at | TIMESTAMPTZ | |

### `users`

| Column | Type | Notes |
|--------|------|-------|
| id | UUID PK | |
| tenant_id | UUID FK | |
| email | TEXT | Unique per tenant |
| name | TEXT | |
| role | TEXT | `platform_admin` \| `operator` \| `viewer` |
| password_hash | TEXT | MVP local auth |
| last_login | TIMESTAMPTZ | |
| created_at / updated_at | TIMESTAMPTZ | |

### `agents`

Primary inventory entity. Columns map to the product brief attribute list.

| Column | Type | Notes |
|--------|------|-------|
| id | UUID PK | Stable Visentra ID |
| tenant_id | UUID FK | |
| fingerprint | TEXT | Entity-resolution key (unique per tenant) |
| name | TEXT | |
| owner | TEXT | Email or identity |
| device | TEXT | Device name |
| hostname | TEXT | |
| ip | INET | |
| operating_system | TEXT | |
| department | TEXT | |
| business_unit | TEXT | |
| location | TEXT | |
| repository | TEXT | |
| framework | TEXT | LangGraph, CrewAI, … |
| programming_language | TEXT | |
| model | TEXT | |
| provider | TEXT | openai, anthropic, … |
| version | TEXT | |
| deployment_type | TEXT | ide, local, cloud, container, saas, mcp, browser, autonomous |
| cloud_provider | TEXT | aws, azure, gcp, none |
| region | TEXT | |
| container | TEXT | |
| vm | TEXT | |
| endpoint | TEXT | |
| ide | TEXT | Cursor, VS Code, … |
| creation_time | TIMESTAMPTZ | Source-reported |
| last_modified | TIMESTAMPTZ | |
| last_seen | TIMESTAMPTZ | |
| first_discovered | TIMESTAMPTZ | |
| running_status | TEXT | `running` \| `stopped` \| `unknown` \| `scheduled` |
| memory_usage_mb | NUMERIC | |
| cpu_usage_pct | NUMERIC | |
| api_keys_detected | BOOLEAN | Presence flag only |
| secrets_detected | BOOLEAN | Presence flag only |
| mcp_connections | JSONB | Array of MCP server refs |
| tools | JSONB | Tool names |
| prompt_templates | JSONB | |
| memory_store | TEXT | |
| vector_database | TEXT | |
| connected_applications | JSONB | |
| identity_used | TEXT | |
| permissions | JSONB | |
| internet_access | BOOLEAN | |
| filesystem_access | BOOLEAN | |
| database_access | BOOLEAN | |
| github_access | BOOLEAN | |
| slack_access | BOOLEAN | |
| email_access | BOOLEAN | |
| calendar_access | BOOLEAN | |
| browser_access | BOOLEAN | |
| execution_capability | TEXT | |
| risk_indicators | JSONB | Informational indicators only (not enforcement) |
| confidence_score | NUMERIC(4,3) | 0–1 |
| category | TEXT | ide, local, framework, cloud, container, saas, mcp, local_llm, browser, autonomous |
| metadata | JSONB | Free-form enrichment |
| source_collectors | TEXT[] | Collector IDs that contributed |
| created_at / updated_at | TIMESTAMPTZ | |

**Indexes:** tenant+fingerprint (unique), tenant+last_seen, tenant+framework, tenant+model, tenant+owner, tenant+hostname, GIN on tools/risk_indicators, trigram on name.

### `assets`

Typed non-agent entities (devices, IDEs, models, tools, MCP servers, databases, cloud resources, APIs, external services, repositories, developers).

| Column | Type | Notes |
|--------|------|-------|
| id | UUID PK | |
| tenant_id | UUID FK | |
| asset_type | TEXT | See graph labels |
| name | TEXT | |
| external_key | TEXT | Unique per tenant+type |
| attributes | JSONB | |
| last_seen | TIMESTAMPTZ | |
| created_at / updated_at | TIMESTAMPTZ | |

### `relationships`

SQL mirror of graph edges for joins and export.

| Column | Type | Notes |
|--------|------|-------|
| id | UUID PK | |
| tenant_id | UUID FK | |
| from_type / from_id | TEXT / UUID | |
| to_type / to_id | TEXT / UUID | |
| rel_type | TEXT | OWNS, RUNS_ON, USES_IDE, … |
| confidence | NUMERIC(4,3) | |
| evidence | JSONB | |
| last_seen | TIMESTAMPTZ | |
| created_at | TIMESTAMPTZ | |

Unique: `(tenant_id, from_type, from_id, to_type, to_id, rel_type)`.

### `agent_observations`

Append-only raw evidence from collectors.

| Column | Type | Notes |
|--------|------|-------|
| id | UUID PK | |
| tenant_id | UUID FK | |
| collector_id | TEXT | |
| job_id | UUID FK nullable | |
| observed_at | TIMESTAMPTZ | |
| payload | JSONB | Raw observation |
| fingerprint_hint | TEXT | |
| agent_id | UUID FK nullable | After resolution |

### `discovery_jobs`

| Column | Type | Notes |
|--------|------|-------|
| id | UUID PK | |
| tenant_id | UUID FK | |
| collector_ids | TEXT[] | |
| status | TEXT | `queued` \| `running` \| `complete` \| `error` |
| triggered_by | TEXT | user email or `scheduler` |
| agents_found | INT | |
| started_at / finished_at | TIMESTAMPTZ | |
| error | TEXT | |

### `discovery_events`

Streamable visibility events (job started, agent upserted, edge created, collector error).

| Column | Type | Notes |
|--------|------|-------|
| id | BIGSERIAL PK | |
| tenant_id | UUID FK | |
| event_type | TEXT | |
| severity | TEXT | `info` \| `warn` \| `error` |
| message | TEXT | |
| payload | JSONB | |
| created_at | TIMESTAMPTZ | |

### `visibility_activity`

Read-only user/system activity for Operations dashboards (not compliance enforcement).

| Column | Type | Notes |
|--------|------|-------|
| id | BIGSERIAL | |
| tenant_id | UUID | |
| actor | TEXT | |
| action | TEXT | |
| resource_type / resource_id | TEXT | |
| created_at | TIMESTAMPTZ | |

## Retention

| Store | Default retention |
|-------|-------------------|
| agents / assets / relationships | Indefinite while active; soft-delete after 90d unseen (configurable) |
| observations | 30–90 days |
| discovery_events | 90 days |
| visibility_activity | 180 days |

## Multi-tenancy

Application-layer `WHERE tenant_id = $1` on every query. Production deployments SHOULD enable PostgreSQL RLS using `SET app.tenant_id`. See [23-security-architecture.md](./23-security-architecture.md).
