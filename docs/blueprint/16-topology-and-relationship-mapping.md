# 16 - Topology and Relationship Mapping

## Overview

Topology is the visual and queryable expression of AgentRadar's graph. It helps users understand how agents connect to models, tools, MCP servers, identities, repositories, devices, cloud resources, containers, SaaS apps, browser extensions, frameworks, and evidence.

## Relationship Use Cases

| Use Case | User Question |
|---|---|
| Agent investigation | What does this agent use and where does it run? |
| MCP exposure | Which agents connect to this MCP server? |
| Model adoption | Which teams use this provider/model? |
| Identity blast radius | Which agents execute as this service account? |
| Repository lineage | Which agents are defined by this repository? |
| Cloud visibility | Which AI agents run in this account or cluster? |

## Topology Views

| View | Purpose |
|---|---|
| Entity Neighborhood | One-to-three hop graph centered on an entity. |
| Path Finder | Relationships between two selected entities. |
| Relationship Table | Dense edge list with filters and evidence. |
| Grouped Topology | Aggregated by team, source, model provider, cloud account, or type. |
| Time Slice | V2 view of relationships during a selected time window. |

## Expansion Rules

- Default depth is one hop.
- Two-hop expansion requires user action.
- Three-hop expansion requires explicit confirmation on high-degree graphs.
- High-degree nodes should group by type or source.
- Expansion requests include maximum node and edge limits.

## Graph Layouts

- Force-directed for investigation.
- Hierarchical for cloud/account/repository lineage.
- Radial for centered entity blast radius.
- Sankey-like relationship flow for model/tool usage where appropriate.

## Edge Evidence

Every edge drawer should show:

- Relationship type.
- Confidence.
- First seen.
- Last seen.
- Source categories.
- Evidence references.
- Relationship history.
- Source fields supporting edge.

## Filtering

Topology filters:

- Node type.
- Relationship type.
- Confidence.
- Status.
- Source category.
- Time range.
- Owner/team.
- Environment.

Filters must be reflected in URL for shareable investigations.

## API Pattern

```http
POST /api/v1/topology/neighborhood
Content-Type: application/json

{
  "center_entity_id": "agt_123",
  "depth": 2,
  "relationship_types": ["USES_MODEL", "CONNECTS_TO_MCP_SERVER"],
  "min_confidence": 70,
  "limit": {"nodes": 500, "edges": 1000}
}
```

## Response Pattern

```json
{
  "nodes": [],
  "edges": [],
  "groups": [],
  "truncated": false,
  "generated_at": "2026-07-10T11:10:00Z"
}
```

## Realtime Behavior

- Optional live mode highlights new/changed edges.
- Layout should remain stable during incremental updates.
- Users can pause live updates.
- Reconnect resumes from relationship change cursor.

## Export

- PNG/SVG for visible graph.
- JSON for nodes/edges.
- CSV for relationship list.
- Export metadata includes filters, depth, center entity, and timestamp.

## Related Documents

- [13-graph-data-model.md](./13-graph-data-model.md)
- [07-ui-screens.md](./07-ui-screens.md)
- [08-ui-widgets.md](./08-ui-widgets.md)
