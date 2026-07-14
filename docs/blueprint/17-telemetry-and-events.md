# 17 - Telemetry and Events

## Overview

Visentra events power discovery runs, timelines, realtime UI updates, operational observability, graph change history, exports, and audit. Events are immutable, tenant-scoped, schema-versioned, and replay-safe.

## Event Families

| Family | Purpose |
|---|---|
| Observation Events | Raw source observations accepted/rejected. |
| Normalization Events | Canonical records produced/quarantined. |
| Inventory Events | Entity creation, update, status change. |
| Relationship Events | Edge creation, update, stale, removed. |
| Discovery Run Events | Run lifecycle and counters. |
| Collector Events | Health, version, capability, errors. |
| Visibility Events | V2 activity and timeline signals. |
| Export Events | Export requested, running, completed, failed. |
| Audit Events | User/admin/API access and configuration changes. |

## NATS Topics

| Topic | Description |
|---|---|
| `observations.raw` | Accepted raw observations. |
| `observations.rejected` | Invalid or unauthorized observations. |
| `records.normalized` | Normalized canonical candidates. |
| `records.quarantined` | Trusted but unmapped records. |
| `inventory.changed` | Entity changes. |
| `relationships.changed` | Graph relationship changes. |
| `discovery.runs` | Run lifecycle. |
| `collector.health` | Collector heartbeats and capability changes. |
| `discovery.events` | User-visible discovery event stream. |
| `exports.lifecycle` | Export lifecycle. |
| `audit.events` | Audit log stream. |

## Event Envelope

```json
{
  "event_id": "evt_123",
  "tenant_id": "ten_123",
  "schema_version": "event.v1",
  "event_type": "agent_discovered",
  "occurred_at": "2026-07-10T11:10:00Z",
  "published_at": "2026-07-10T11:10:01Z",
  "source": "identity-resolution-service",
  "actor": {"type": "service", "id": "svc_identity"},
  "entity_refs": [{"type": "agent", "id": "agt_123"}],
  "payload": {}
}
```

## Discovery Event Types

- `source_configured`
- `collector_enrolled`
- `collector_stale`
- `discovery_run_started`
- `discovery_run_completed`
- `observation_batch_received`
- `observation_rejected`
- `record_quarantined`
- `agent_discovered`
- `agent_updated`
- `agent_status_changed`
- `relationship_added`
- `relationship_changed`
- `coverage_changed`

## Timeline Requirements

- Events are queryable by entity, source, run, time, and event type.
- Timeline order uses `occurred_at` with stable tie-breaking by event ID.
- V2 visibility events can coexist with V1 discovery events.
- Sensitive payload fields are redacted before indexing.

## Realtime Subscriptions

Realtime gateway supports:

- Discovery run subscriptions.
- Entity timeline subscriptions.
- Operations queue subscriptions.
- Collector health subscriptions.
- Export lifecycle subscriptions.

Clients use cursors to resume after disconnect.

## Retention Tiers

| Data | Suggested Retention |
|---|---|
| Audit events | Customer-configurable, often 1-7 years. |
| Discovery events | 90-365 days by default. |
| Raw observation metadata | 30-180 days by default. |
| Raw evidence payloads | Customer-configurable. |
| Aggregated trends | Long-term. |

## Related Documents

- [02-product-architecture.md](./02-product-architecture.md)
- [25-observability-and-operations.md](./25-observability-and-operations.md)
- [30-roadmap.md](./30-roadmap.md)
