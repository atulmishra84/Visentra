# 15 - Search and Query

## Overview

Search is a primary Visentra workflow. Users need to find agents, relationships, evidence, discovery events, models, MCP servers, repositories, identities, cloud resources, and coverage gaps quickly. Search must support both guided facets and typed structured queries.

## Search Modes

| Mode | Purpose |
|---|---|
| Global Search | Search across entity names, aliases, IDs, and safe evidence metadata. |
| Inventory Search | Filtered entity tables with facets and columns. |
| Relationship Query | Search based on relationships and paths. |
| Event Search | Discovery and visibility event filtering. |
| Saved Search | Persisted query, filters, sort, and columns. |

## Query Language

Initial syntax should support:

- `field:value`
- `field:"quoted value"`
- `field:*`
- `field:<number`
- `field:>number`
- `field:[start TO end]`
- `AND`, `OR`, `NOT`
- parentheses for grouping
- relationship predicates in advanced mode

Examples:

```text
type:agent owner:unknown confidence:<70
agent_class:framework_agent framework:langchain model.provider:openai
mcp.server:* tool.category:file_system environment:production
relationship:CONNECTS_TO_MCP_SERVER mcp.transport:stdio
last_seen_at:[now-7d TO now]
```

## Facet Semantics

Facets should reflect the current result set.

Common facets:

- Entity type.
- Source category.
- Confidence.
- Status.
- Owner/team.
- Environment.
- First seen.
- Last seen.

Agent facets:

- Agent class.
- Runtime type.
- Autonomy level.
- Model provider.
- Framework.
- MCP server.
- Tool category.
- Repository organization.
- Cloud provider.
- IDE type.

## Saved Searches

Saved searches include:

- Name.
- Description.
- Owner user/team.
- Query string.
- Facets.
- Sort.
- Columns.
- Time range.
- Visibility: private/team/tenant.

Saved searches are not policies and do not trigger governance actions in V1/V2.

## Result Contracts

Search results should include:

- Entity ID.
- Entity type.
- Display name.
- Matched fields.
- Highlight snippets for safe fields.
- Confidence.
- Status.
- Source categories.
- First/last seen.
- Relationship summaries where relevant.

## Export Behavior

Exports must preserve:

- Query.
- Filters.
- Sort.
- Selected columns.
- Actor.
- Tenant.
- Timestamp.
- Result count.
- Schema version.

Large searches use asynchronous export jobs.

## API Examples

```http
POST /api/v1/search
Content-Type: application/json

{
  "query": "type:agent mcp.server:* confidence:>70",
  "filters": {"environment": ["production"]},
  "sort": [{"field": "last_seen_at", "direction": "desc"}],
  "page_size": 100
}
```

```json
{
  "results": [],
  "facets": {},
  "next_cursor": "cur_abc",
  "query_time_ms": 84
}
```

## Performance Requirements

- Common inventory queries under 1.5s p95.
- Facets return with result page for common fields.
- Deep relationship predicates may return async suggestions for large graphs.
- Pagination uses opaque cursors.
- Query timeouts return partial/degraded state rather than failing silently.

## Related Documents

- [08-ui-widgets.md](./08-ui-widgets.md)
- [14-inventory-data-model.md](./14-inventory-data-model.md)
- [21-api-specification.md](./21-api-specification.md)
