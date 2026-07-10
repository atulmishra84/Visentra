# 20 - Integrations

## Overview

AgentRadar integrations support discovery intake, enrichment, export, and enterprise workflows. V1/V2 integrations should focus on visibility and data exchange, not enforcement or remediation.

## Integration Categories

| Category | Direction | Purpose |
|---|---|---|
| Identity Providers | Inbound | User, group, service account, ownership enrichment. |
| Source Control | Inbound | Repository, dependency, code/config evidence. |
| Cloud Providers | Inbound | Cloud resources, IAM, managed AI, runtime metadata. |
| Container Platforms | Inbound | Workloads, images, labels, clusters. |
| SaaS Applications | Inbound | AI agents, app integrations, tenant metadata. |
| EDR/MDM | Inbound | Device inventory and endpoint coverage enrichment. |
| SIEM | Outbound | Discovery events and inventory changes. |
| CMDB | Outbound | AI asset inventory and relationships. |
| Data Lake/BI | Outbound | Bulk export, trends, snapshots. |
| Ticketing | Later optional outbound | Visibility handoff only; no remediation automation in current scope. |

## Priority Integrations

### Inbound Discovery

- GitHub, GitLab.
- AWS, Azure, GCP.
- Kubernetes.
- Okta, Entra ID.
- ServiceNow, Salesforce, Slack/Microsoft 365 where APIs expose AI features.
- EDR/MDM inventory providers.

### Outbound Visibility

- Splunk.
- Microsoft Sentinel.
- ServiceNow CMDB.
- Snowflake.
- S3/GCS/Azure Blob export destinations.

## Integration Configuration

Each integration needs:

- Name and description.
- Credential type.
- Required permissions.
- Test connection.
- Capability report.
- Last successful sync.
- Error state.
- Data sensitivity notes.
- Source category mapping.

## Permission Design

Integrations should use read-only permissions whenever possible. If a source requires broader permissions, the UI must clearly explain why and what data is collected.

## Export Destinations

Supported export patterns:

- Manual file export.
- Scheduled inventory snapshot export.
- Event stream to SIEM.
- CMDB reconciliation export.
- Data lake object export.

Scheduled exports are visibility features. They must not create remediation tickets or enforcement actions by default.

## Integration Health

Track:

- Last sync.
- API errors.
- Rate limit state.
- Credential expiration.
- Scope/permission mismatch.
- Data volume.
- Rejected/quarantined records.

## Payload Patterns

Outbound inventory event:

```json
{
  "event_type": "agent_discovered",
  "tenant_id": "ten_123",
  "agent": {
    "agent_id": "agt_123",
    "name": "checkout-agent",
    "agent_class": "framework_agent",
    "confidence": 91,
    "last_seen_at": "2026-07-10T11:10:00Z"
  },
  "relationships": []
}
```

## Related Documents

- [09-discovery-sources.md](./09-discovery-sources.md)
- [21-api-specification.md](./21-api-specification.md)
- [24-deployment-architecture.md](./24-deployment-architecture.md)
