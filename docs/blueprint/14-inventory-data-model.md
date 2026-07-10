# 14 - Inventory Data Model

## Overview

PostgreSQL is the canonical inventory store for AgentRadar. It holds tenants, users, collectors, sources, normalized entities, relationships, observations, evidence metadata, discovery runs, exports, saved searches, settings, snapshots, and audit events.

## Database Principles

- Every table is tenant-scoped unless explicitly global.
- Canonical entities use stable IDs.
- Source observations are immutable.
- Inventory entities are mutable projections with history.
- Evidence references support audit and reprocessing.
- Sensitive values are redacted, hashed, or encrypted.

## Core Tables

| Table | Purpose |
|---|---|
| `tenants` | Tenant metadata. |
| `users` | Human users known to AgentRadar. |
| `roles` | RBAC roles. |
| `user_roles` | User-role assignments. |
| `collectors` | Collector identities and health. |
| `sources` | Source connector definitions. |
| `discovery_runs` | Discovery run lifecycle. |
| `observations` | Raw observation metadata and object storage refs. |
| `evidence` | Evidence references and safe previews. |
| `entities` | Generic canonical entity envelope. |
| `agents` | Agent-specific fields. |
| `agent_instances` | Runtime instances. |
| `relationships` | Canonical relationship metadata. |
| `inventory_changes` | Entity/relationship change log. |
| `exports` | Export jobs and artifacts. |
| `saved_searches` | User/team saved queries. |
| `audit_events` | Security and administrative audit trail. |

## Entity Table Pattern

```sql
CREATE TABLE entities (
  tenant_id text NOT NULL,
  entity_id text NOT NULL,
  entity_type text NOT NULL,
  display_name text NOT NULL,
  normalized_name text NOT NULL,
  status text NOT NULL,
  confidence integer NOT NULL,
  first_seen_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  source_count integer NOT NULL DEFAULT 0,
  tags jsonb NOT NULL DEFAULT '[]',
  attributes jsonb NOT NULL DEFAULT '{}',
  PRIMARY KEY (tenant_id, entity_id)
);
```

## Agent Table Pattern

```sql
CREATE TABLE agents (
  tenant_id text NOT NULL,
  agent_id text NOT NULL,
  agent_class text NOT NULL,
  autonomy_level text,
  deployment_state text,
  runtime_type text,
  execution_mode text,
  owner_identity_id text,
  owner_team text,
  environment text,
  confidence_reasons jsonb NOT NULL DEFAULT '[]',
  source_categories jsonb NOT NULL DEFAULT '[]',
  capabilities jsonb NOT NULL DEFAULT '[]',
  PRIMARY KEY (tenant_id, agent_id),
  FOREIGN KEY (tenant_id, agent_id) REFERENCES entities (tenant_id, entity_id)
);
```

## Relationship Table Pattern

```sql
CREATE TABLE relationships (
  tenant_id text NOT NULL,
  relationship_id text NOT NULL,
  from_entity_id text NOT NULL,
  to_entity_id text NOT NULL,
  relationship_type text NOT NULL,
  confidence integer NOT NULL,
  status text NOT NULL,
  first_seen_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL,
  source_count integer NOT NULL DEFAULT 0,
  evidence_refs jsonb NOT NULL DEFAULT '[]',
  PRIMARY KEY (tenant_id, relationship_id)
);
```

## OpenSearch Indexes

| Index Alias | Contents |
|---|---|
| `agents_current` | Denormalized agent documents. |
| `entities_current` | Cross-entity inventory documents. |
| `relationships_current` | Relationship search documents. |
| `discovery_events` | Discovery and pipeline events. |
| `evidence_search` | Safe evidence metadata. |
| `collectors_current` | Collector health and source coverage. |

## Denormalized Agent Document

```json
{
  "tenant_id": "ten_123",
  "entity_type": "agent",
  "agent_id": "agt_123",
  "name": "checkout-agent",
  "agent_class": "framework_agent",
  "status": "active",
  "confidence": 91,
  "owner": {"identity_id": "id_1", "email": "owner@example.com"},
  "source_categories": ["Framework", "Cloud", "Containers"],
  "models": [{"provider": "openai", "name": "gpt-4.1"}],
  "frameworks": ["langchain"],
  "mcp_servers": [],
  "repositories": [{"org": "payments", "name": "checkout"}],
  "runtime": {"type": "kubernetes", "environment": "production"},
  "first_seen_at": "2026-07-01T00:00:00Z",
  "last_seen_at": "2026-07-10T11:10:00Z"
}
```

## Lifecycle and Retention

- Current tables keep latest canonical state.
- Change tables keep entity and relationship history.
- Observation metadata is retained according to tenant policy.
- Raw evidence objects follow retention policy in object storage.
- Deleted entities are soft-deleted before archival.

## Tenancy and Partitioning

- Primary keys include `tenant_id`.
- Large tables can partition by tenant hash and time.
- Event/history tables should partition by month.
- Cross-tenant indexes are not allowed in application queries.

## Related Documents

- [05-information-architecture.md](./05-information-architecture.md)
- [15-search-and-query.md](./15-search-and-query.md)
- [18-data-governance-boundaries.md](./18-data-governance-boundaries.md)
