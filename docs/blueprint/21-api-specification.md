# 21 - API Specification

## Overview

AgentRadar APIs provide access to inventory, topology, search, discovery runs, events, exports, collectors, integrations, and settings. APIs should be consistent, versioned, tenant-scoped, cursor-paginated, RBAC-enforced, and audit-aware.

## API Conventions

- Base path: `/api/v1`.
- JSON request/response.
- Opaque cursor pagination.
- ISO 8601 timestamps.
- Stable entity IDs.
- `request_id` returned in every response.
- Error objects include code, message, and retryability.

## Common Error Shape

```json
{
  "error": {
    "code": "permission_denied",
    "message": "You do not have access to raw evidence.",
    "retryable": false
  },
  "request_id": "req_123"
}
```

## Inventory APIs

| Method | Path | Purpose |
|---|---|---|
| GET | `/agents` | List agents. |
| GET | `/agents/{agent_id}` | Agent detail. |
| GET | `/agents/{agent_id}/relationships` | Agent relationships. |
| GET | `/agents/{agent_id}/timeline` | Agent timeline. |
| GET | `/entities/{entity_id}` | Generic entity detail. |
| GET | `/entities/{entity_id}/evidence` | Evidence metadata. |

## Search APIs

```http
POST /api/v1/search
```

Request:

```json
{
  "query": "type:agent model.provider:openai",
  "filters": {"confidence": {"gte": 70}},
  "sort": [{"field": "last_seen_at", "direction": "desc"}],
  "page_size": 100,
  "cursor": null
}
```

## Topology APIs

| Method | Path | Purpose |
|---|---|---|
| POST | `/topology/neighborhood` | Load graph around entity. |
| POST | `/topology/path` | Find paths between entities. |
| GET | `/relationships/{relationship_id}` | Relationship detail/evidence. |

## Discovery APIs

| Method | Path | Purpose |
|---|---|---|
| GET | `/discovery/sources` | List source configs. |
| POST | `/discovery/runs` | Start discovery run. |
| GET | `/discovery/runs` | List runs. |
| GET | `/discovery/runs/{run_id}` | Run detail. |
| GET | `/discovery/events` | Discovery event search. |
| GET | `/coverage` | Coverage state. |

## Collector APIs

| Method | Path | Purpose |
|---|---|---|
| POST | `/collectors/enroll` | Enroll collector with token. |
| POST | `/collectors/{collector_id}/heartbeat` | Submit heartbeat. |
| GET | `/collectors/{collector_id}/config` | Fetch config. |
| POST | `/observations` | Submit signed observations. |

## Export APIs

| Method | Path | Purpose |
|---|---|---|
| POST | `/exports` | Create export. |
| GET | `/exports` | List exports. |
| GET | `/exports/{export_id}` | Export detail. |
| GET | `/exports/{export_id}/download` | Download artifact if authorized. |

Export request:

```json
{
  "type": "agents",
  "format": "csv",
  "query": "owner:unknown",
  "filters": {},
  "columns": ["name", "agent_class", "confidence", "owner", "last_seen_at"]
}
```

## Streaming APIs

Supported transports:

- Server-Sent Events for event feeds.
- WebSocket for topology sessions and richer realtime.

Example:

```http
GET /api/v1/stream/discovery-runs/{run_id}?cursor=cur_123
```

## Versioning

- Additive fields are allowed in minor versions.
- Breaking schema changes require new API version.
- Response includes `schema_version` for complex resources.

## Related Documents

- [15-search-and-query.md](./15-search-and-query.md)
- [16-topology-and-relationship-mapping.md](./16-topology-and-relationship-mapping.md)
- [22-backend-services.md](./22-backend-services.md)
