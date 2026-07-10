# 26 - Testing and Quality Strategy

## Overview

AgentRadar quality depends on software correctness and data correctness. The platform must test collectors, ingestion, normalization, identity resolution, graph projection, search indexing, APIs, UI, RBAC, exports, and scale behavior.

## Test Pyramid

| Layer | Scope |
|---|---|
| Unit | Parsers, mappers, scoring rules, components, utilities. |
| Contract | API schemas, event schemas, connector payloads. |
| Integration | Service + datastore + NATS flows. |
| End-to-End | Discovery run to UI inventory/topology/export. |
| Load | Ingestion, search, graph, export throughput. |
| Security | RBAC, auth, tenant isolation, secret redaction. |
| Data Quality | Deduplication, confidence, taxonomy, evidence coverage. |

## Connector Tests

- Fixture payloads for each source.
- Permission failure tests.
- Rate limit tests.
- Redaction tests.
- Version compatibility tests.
- Idempotency tests.

## Normalization Tests

- Source-specific mapping fixtures.
- Schema validation.
- Quarantine/rejection behavior.
- Evidence generation.
- Taxonomy enrichment.
- Sensitive field redaction.

## Identity Resolution Tests

- Strong match update.
- Weak match candidate.
- Name-only non-merge.
- Conflicting strong evidence.
- Multi-instance agent.
- Ownership inference.
- Confidence explanation.

## Graph Tests

- Node/edge upsert idempotency.
- Relationship confidence updates.
- Tenant isolation.
- Traversal limits.
- High-degree grouping.
- Edge evidence retrieval.

## Search Tests

- Query parser.
- Facet counts.
- Pagination.
- Sorting.
- Permission-filtered results.
- Export parity with search results.

## UI Tests

- Navigation by persona.
- Table filters and columns.
- Drawer behavior.
- Topology interactions.
- Timeline live pause/resume.
- Export flows.
- Accessibility checks.

## Security Tests

- Cross-tenant access attempts.
- Evidence permission boundaries.
- Raw evidence access audit.
- API token scope enforcement.
- Collector signature verification.
- Secret redaction in logs and UI.

## Acceptance Test: First Discovery Run

1. Configure test source.
2. Submit fixture observations.
3. Verify normalized records.
4. Verify canonical agent.
5. Verify graph relationships.
6. Verify search result.
7. Verify UI event stream.
8. Export result and validate metadata.

## Quality Metrics

- Mapping coverage by source.
- Deduplication false merge rate.
- Low-confidence candidate rate.
- Observation rejection rate.
- Graph/search projection lag.
- Test fixture coverage by discovery category.

## Related Documents

- [11-normalization-pipeline.md](./11-normalization-pipeline.md)
- [12-agent-identity-resolution.md](./12-agent-identity-resolution.md)
- [25-observability-and-operations.md](./25-observability-and-operations.md)
