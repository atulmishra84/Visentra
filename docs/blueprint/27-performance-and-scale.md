# 27 - Performance and Scale

## Overview

Visentra must scale to large enterprise environments with many devices, repositories, cloud accounts, containers, SaaS tenants, observations, entities, relationships, and events. The system should degrade gracefully when search, graph, or realtime paths are under pressure.

## Initial Scale Targets

| Dimension | Target |
|---|---|
| Endpoints | 100,000 |
| Repositories | 20,000 |
| Cloud accounts/projects/subscriptions | 5,000 |
| Kubernetes clusters | 1,000 |
| SaaS tenants/apps | 250 |
| Raw observations | 1 million/hour |
| Canonical assets | 500,000 |
| Graph relationships | 5-20 million |
| Concurrent users | 1,000 |

## Latency Targets

| Operation | Target |
|---|---|
| Agent detail | < 1s p95 excluding heavy graph. |
| Common inventory search | < 1.5s p95. |
| One-hop topology | < 2s p95. |
| Discovery event stream delivery | < 2s p95. |
| Observation batch ack | < 500ms p95 excluding upload. |
| Observation-to-inventory | < 10 minutes p95 normal load. |

## Throughput Strategy

- Batch observations.
- Partition NATS consumers by tenant/source.
- Use idempotent workers.
- Scale normalization horizontally.
- Separate canonical writes from graph/search projections.
- Use bulk indexing to OpenSearch.
- Use graph write batching.

## Caching Strategy

Redis caches:

- Hot dashboard metrics.
- Common facet results.
- User/session preferences.
- Topology neighborhood summaries.
- AuthZ decisions with short TTL.

Cache invalidation:

- Inventory change events invalidate affected entity caches.
- Dashboard caches refresh on time interval and important changes.

## OpenSearch Strategy

- Denormalized documents.
- Versioned aliases.
- Bulk indexing.
- Shard by tenant volume where needed.
- Avoid unbounded wildcard queries.
- Use fielddata/doc values intentionally.

## Neo4j Strategy

- Enforce query limits.
- Group high-degree nodes.
- Precompute common neighborhood summaries.
- Use indexes for tenant/entity lookup.
- Avoid unconstrained variable-length traversals.

## PostgreSQL Strategy

- Tenant-scoped primary keys.
- Partition high-volume event/history tables.
- Use JSONB selectively for flexible attributes.
- Keep canonical hot rows narrow.
- Add targeted indexes based on query plans.

## Degradation Behavior

| Pressure | Degradation |
|---|---|
| Search overloaded | Return degraded banner; inventory detail remains available. |
| Graph overloaded | Limit depth and group high-degree nodes. |
| Realtime overloaded | Collapse updates into summaries. |
| Pipeline backlog | Show discovery processing lag. |
| Export load high | Queue async exports. |

## Capacity Testing

Regular tests should simulate:

- Large endpoint fleet.
- Burst discovery run.
- High-cardinality MCP tool inventory.
- Large graph neighborhood.
- Concurrent exports.
- Reindex while serving reads.

## Related Documents

- [02-product-architecture.md](./02-product-architecture.md)
- [22-backend-services.md](./22-backend-services.md)
- [25-observability-and-operations.md](./25-observability-and-operations.md)
