# 25 - Observability and Operations

## Overview

AgentRadar itself must be observable. Customers will trust discovery data only if the platform exposes pipeline health, collector health, service health, lag, errors, and export state. Internal operations need metrics, logs, traces, runbooks, and alerting.

## Golden Signals

| Signal | Examples |
|---|---|
| Latency | API latency, query latency, ingestion ack latency, pipeline lag. |
| Traffic | Observation batches, API requests, events, exports. |
| Errors | Rejections, service errors, connector failures, index failures. |
| Saturation | Queue depth, CPU/memory, DB connections, index pressure. |

## Product-Facing Operational Metrics

- Discovery run progress.
- Collector online/stale/failed counts.
- Observation rejection rate.
- Normalization quarantine rate.
- Identity resolution lag.
- Graph projection lag.
- Search indexing lag.
- Coverage state.

## Internal Metrics

- Request count and latency by route.
- NATS consumer lag.
- PostgreSQL query latency.
- Neo4j query latency.
- OpenSearch indexing latency.
- Redis hit rate.
- Export job duration.
- Realtime connection count.

## Logging Standards

Every log should include:

- `timestamp`
- `level`
- `service`
- `tenant_id` where applicable.
- `request_id`
- `event_id` where applicable.
- `collector_id` where applicable.
- Error code.

Do not log secrets, raw prompt content, raw model responses, or sensitive command values.

## Tracing

Trace:

- API request through Query Service and data stores.
- Observation ingestion through normalization and identity resolution.
- Export job lifecycle.
- Realtime event delivery.

## Alerts

| Alert | Severity |
|---|---|
| Ingestion unavailable | Critical. |
| NATS stream lag above threshold | High. |
| OpenSearch indexing stalled | High. |
| PostgreSQL write errors | Critical. |
| Neo4j unavailable | High for topology. |
| Collector fleet heartbeat drop | Warning/high depending scope. |
| Export failures above threshold | Warning. |

## Runbooks

Runbooks should cover:

- Pipeline lag.
- Connector failure spike.
- Search degraded.
- Graph unavailable.
- Export stuck.
- Realtime gateway disconnects.
- Database migration failure.
- High rejection/quarantine rate.

## SLOs

- Inventory API availability: 99.9%.
- Common search p95 latency: < 1.5s.
- Topology one-hop p95 latency: < 2s.
- Observation-to-inventory p95: < 10 minutes under normal load.
- Export job completion for small result sets: < 30 seconds.

## Related Documents

- [22-backend-services.md](./22-backend-services.md)
- [27-performance-and-scale.md](./27-performance-and-scale.md)
- [26-testing-and-quality-strategy.md](./26-testing-and-quality-strategy.md)
