# 24. API Specifications

The canonical OpenAPI contract should live at:

```text
platform/schemas/openapi.yaml
```

This document defines conventions that `platform/schemas/openapi.yaml` must follow. The endpoint resource map is in [11-apis.md](./11-apis.md).

Related: [16-backend-services.md](./16-backend-services.md), [17-frontend-components.md](./17-frontend-components.md), [25-sequence-diagrams.md](./25-sequence-diagrams.md).

## OpenAPI requirements

| Requirement | Standard |
|---|---|
| Version | OpenAPI 3.1 preferred; 3.0.3 acceptable for tooling compatibility. |
| Base path | `/api/v1`. |
| Tags | `Auth`, `Agents`, `Assets`, `Graph`, `Search`, `Discovery`, `Dashboards`, `Export`, `Tenants`, `Users`. |
| Security schemes | Bearer JWT, cookie session, CSRF header. |
| Operation IDs | Stable camelCase, e.g. `listAgents`, `launchDiscoveryJob`. |
| Examples | Request and response examples for each resource family. |
| Validation | Write schemas disallow unknown fields unless a metadata map is explicit. |

## Versioning

| Change | Handling |
|---|---|
| Compatible addition | Add optional request/response field or enum with fallback. |
| Breaking change | New major path: `/api/v2`. |
| Deprecated endpoint | Mark `deprecated: true` and document replacement. |
| Sunset | Return `Sunset` header during deprecation window where practical. |

Compatibility rules: do not remove fields, change semantics, make optional fields required, or change enum meaning inside a major version.

## Naming

| Item | Convention | Example |
|---|---|---|
| JSON fields | camelCase | `lastObservedAt` |
| IDs | opaque prefixed ID | `agt_01jzwb4g5pqq9nv4zpc47w52va` |
| Timestamps | RFC3339 UTC | `2026-07-10T11:25:00Z` |
| Enums | lower_snake_case | `workflow_agent` |
| Headers | HTTP title case | `Idempotency-Key` |
| Query params | camelCase | `lastObservedAfter` |

## Response envelope

Detail response:

```json
{
  "requestId": "req_01jzwb6f0z3mrdcmtg2w8118j7",
  "agent": {"id": "agt_contract_review", "name": "contract-review-copilot"}
}
```

List response:

```json
{
  "requestId": "req_01jzwb73h5r04fzz85m8x0m5sy",
  "items": [],
  "page": {"limit": 50, "nextCursor": null, "hasMore": false}
}
```

## Error model

```json
{
  "requestId": "req_01jzwb83pv26698hqk7hbe6b6s",
  "error": {
    "code": "validation_failed",
    "message": "Request validation failed.",
    "details": [{"field": "filters.model[0]", "reason": "unknown_value"}],
    "retryAfterSeconds": null
  }
}
```

| HTTP | Code |
|---:|---|
| 400 | `bad_request`, `validation_failed`, `invalid_cursor` |
| 401 | `unauthenticated` |
| 403 | `forbidden` |
| 404 | `not_found` |
| 409 | `conflict`, `idempotency_conflict` |
| 412 | `precondition_failed` |
| 422 | `unprocessable_entity` |
| 429 | `rate_limited` |
| 500 | `internal_error` |
| 503 | `service_unavailable` |

## Pagination

| Parameter | Description |
|---|---|
| `limit` | Default 50; max 200 unless endpoint overrides. |
| `cursor` | Opaque cursor from previous response. |
| `sort` | `field` ascending or `-field` descending. |

Cursors include filter/sort fingerprint and may expire. Clients must discard cursors when filters change.

## Filtering

| Pattern | Example |
|---|---|
| Single filter | `?status=active` |
| Multi filter | `?risk=high&risk=medium` |
| Date range | `lastObservedAfter`, `lastObservedBefore` |
| Numeric range | `confidenceMin`, `confidenceMax` |
| Text query | `q=invoice%20agent` |

## Idempotency and concurrency

| Feature | Rule |
|---|---|
| Idempotency key | Required for discovery job and export creation. |
| Scope | Tenant + actor + method + path. |
| Identical replay | Return original response. |
| Different body replay | `409 idempotency_conflict`. |
| Optimistic update | Detail resources return `ETag`; updates use `If-Match`. |

## SSE conventions

```http
GET /api/v1/discovery/events/stream?topics=jobs,inventory,graph,coverage
Accept: text/event-stream
```

Rules: authenticate normally, support `Last-Event-ID`, heartbeat every 20 seconds, event names use dot notation, payloads are tenant-authorized.

## Required OpenAPI components

`ErrorResponse`, `PageInfo`, `AgentSummary`, `AgentDetail`, `AssetSummary`, `AssetDetail`, `Observation`, `RelationshipEdge`, `GraphNode`, `GraphNeighborhood`, `SearchRequest`, `SearchResponse`, `DiscoveryConnector`, `DiscoveryJob`, `DashboardOverview`, `ExportJob`, `AuditEvent`.

## Contract testing

- Validate every request/response example against schema.
- Generate TypeScript client in CI.
- Diff against last release and flag breaking changes.
- Ensure every error response matches `ErrorResponse`.
- Ensure every list endpoint uses `PageInfo`.
