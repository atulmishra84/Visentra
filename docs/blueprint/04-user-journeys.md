# 04 - User Journeys

## Overview

Visentra workflows must make discovery feel immediate, evidence-backed, and explorable. The first release should support five critical journeys:

1. First discovery run.
2. Investigate an agent.
3. Explore topology.
4. Search and export.
5. Coverage gap analysis.

Each journey should work without governance or remediation actions. The product may surface "unknown owner", "low confidence", or "coverage gap" states, but it must not imply enforcement.

## Journey 1: First Discovery Run

### Primary Persona

Platform Engineer, with CISO observing outcomes.

### Trigger

The customer has installed Visentra and wants the first useful inventory from one or more sources.

### Entry Points

- Welcome/onboarding checklist.
- Discovery navigation item.
- Collector setup page.
- Cloud/SaaS integration setup.

### Happy Path

| Step | User Action | System Behavior | UI Feedback |
|---|---|---|---|
| 1 | Select source category. | Shows supported connectors and required permissions. | Source setup checklist. |
| 2 | Configure collector or connector. | Validates credentials and saves scoped config. | Success state with test result. |
| 3 | Start discovery run. | Creates run ID and publishes source tasks. | Live run page opens. |
| 4 | Observations arrive. | Ingestion validates and stores raw evidence. | Event stream shows batches received. |
| 5 | Records normalize. | Pipeline maps observations to assets. | Counters update: observed, normalized, rejected. |
| 6 | Agents resolve. | Identity service creates or updates canonical agents. | Newly discovered agent table fills. |
| 7 | Graph and search update. | Relationships and facets become available. | Topology and inventory links activate. |
| 8 | User reviews results. | System summarizes source coverage and data quality. | Run summary with export option. |

### Required UI Elements

- Source selector.
- Setup checklist.
- Permission preview.
- Test connection.
- Discovery run timeline.
- Live counters.
- Rejected/quarantined records panel.
- Newly discovered assets table.
- Coverage delta cards.
- Export run summary.

### Edge Cases

| Case | Expected Handling |
|---|---|
| Credentials invalid | Show exact validation failure without exposing secrets. |
| Source returns no data | Distinguish "healthy but no agent evidence" from "failed". |
| Observations rejected | Provide schema/source reason and connector version. |
| Pipeline lag | Show queued, processing, and indexed counters separately. |
| Duplicate candidates | Show possible duplicate count; do not require user remediation. |

### Acceptance Criteria

- A user can configure at least one source and see first discovered agents in one guided flow.
- Every created asset links to source evidence.
- Discovery run status is understandable without reading logs.
- The run can be exported.

## Journey 2: Investigate Agent

### Primary Persona

SecOps Analyst.

### Trigger

A newly discovered, low-confidence, ownerless, or unusual agent appears in inventory or operations view.

### Entry Points

- Operations queue.
- Agent inventory table.
- Search result.
- Topology node.
- Discovery event.
- Exported link.

### Happy Path

| Step | User Action | System Behavior | UI Feedback |
|---|---|---|---|
| 1 | Open agent detail. | Query service loads canonical agent, evidence, relationships, timeline. | Detail page or drawer opens. |
| 2 | Review summary. | Shows identity, owner, confidence, runtime, first/last seen. | KPI strip and confidence badge. |
| 3 | Inspect evidence. | Fetches source observations and normalized fields. | Evidence table with source, time, field, value. |
| 4 | Review relationships. | Loads model, tools, MCP servers, identity, repo, device, cloud. | Relationship panels and mini topology. |
| 5 | Inspect timeline. | Loads discovery and visibility events. | Chronological event view. |
| 6 | Expand topology. | Opens graph centered on agent. | Relationship Explorer with selected node. |
| 7 | Export findings. | Creates export package for selected agent. | Download link and audit event. |

### Required Agent Detail Sections

- Header: name, type, status, confidence, owner, environment.
- Identity: human users, service accounts, groups, API keys where available.
- Runtime: device, container, cloud resource, SaaS tenant, local process.
- AI stack: model providers, models, frameworks, SDKs, local LLM runtimes.
- Capabilities: tools, MCP servers, browser permissions, cloud permissions if observed.
- Repository: source repository, package files, code evidence.
- Evidence: observations, source payload references, confidence rationale.
- Timeline: first seen, last seen, relationship changes, discovery events.

### Edge Cases

- Agent has multiple possible owners: show ranked ownership evidence.
- Agent has only weak evidence: keep low confidence and show missing signals.
- Agent was not seen recently: mark dormant/stale rather than deleting.
- Agent appears in multiple environments: show runtime instances under one resolved agent when confidence supports it.

### Acceptance Criteria

- User can answer "what is this, where is it, who owns it, what does it use, and why do we believe that?"
- Agent detail works even when topology service is degraded, with graph panels disabled gracefully.

## Journey 3: Explore Topology

### Primary Persona

SecOps Analyst, AI Platform Engineer, CISO for high-level map.

### Trigger

The user wants to understand relationships around an agent, model, MCP server, identity, repository, cloud account, device, or SaaS app.

### Entry Points

- Topology Map nav.
- Agent detail relationship panel.
- Model usage screen.
- MCP server inventory.
- Identity detail.
- Search result "View graph".

### Happy Path

1. User opens topology map centered on an entity.
2. System loads one-hop neighborhood.
3. User applies relationship filters such as `USES_MODEL`, `INVOKES_TOOL`, `RUNS_ON`, `OWNED_BY`, `DEFINED_IN_REPO`.
4. User expands selected nodes to two-hop or three-hop view.
5. System groups high-cardinality nodes and warns when expansion would be expensive.
6. User selects a path between two nodes.
7. System explains relationship evidence and timestamps.
8. User saves or exports graph view.

### Graph Interaction Requirements

- Pan, zoom, fit-to-screen.
- Node type legend.
- Relationship type legend.
- Search within graph.
- Expand/collapse node.
- Pin node.
- Group by type, owner, environment, cloud account, source.
- Path finder between two nodes.
- Evidence panel for selected edge.
- Export as PNG/SVG and JSON relationship list.

### Topology Use Cases

| Use Case | Example Question |
|---|---|
| Agent blast radius | Which tools, models, identities, repos, and cloud resources connect to this agent? |
| MCP exposure | Which agents connect to this MCP server and what tools does it expose? |
| Model adoption | Which agents and teams use a specific model provider? |
| Identity investigation | Which agents use this service account or user identity? |
| Repo lineage | Which deployed or local agents are defined by this repository? |
| Cloud mapping | Which agents run in this account, cluster, function, or container image? |

### Acceptance Criteria

- One-hop graph loads under target latency for common nodes.
- High-degree nodes are summarized instead of overwhelming the screen.
- Every edge can display evidence and confidence.
- Graph export preserves visible filters and timestamp.

## Journey 4: Search and Export

### Primary Persona

SecOps Analyst, Auditor, CISO, AI Platform Engineer.

### Trigger

The user needs a precise answer or report from the AI agent inventory.

### Entry Points

- Global search bar.
- Search nav.
- Inventory Explorer.
- Saved searches.
- Deep links from dashboards.

### Happy Path

| Step | User Action | System Behavior | UI Feedback |
|---|---|---|---|
| 1 | Enter query or select asset type. | Parses query and loads result set. | Result count and active filters. |
| 2 | Add facets. | OpenSearch aggregates update. | Facet counts and selected chips. |
| 3 | Adjust columns. | Preferences persist for user/view. | Dense table updates. |
| 4 | Save search. | Stores query, facets, columns, sort. | Saved search appears in sidebar. |
| 5 | Export results. | Creates synchronous or async export. | Export progress and completion notification. |
| 6 | Download/share. | Audit event is recorded. | Link available with metadata. |

### Search Examples

```text
type:agent owner:unknown confidence:<70 source:ide
model.provider:openai runtime:kubernetes last_seen:<7d
mcp.server:* tool.category:file_system environment:production
framework:langchain repo.org:payments team:ml-platform
browser.extension.permission:nativeMessaging
```

### Export Requirements

- Export current query, filters, sort, and selected columns.
- Include export metadata: actor, timestamp, tenant, result count, query, schema version.
- Support CSV for analysts, JSON/NDJSON for APIs, Parquet for data lake use.
- Enforce export permissions separately from read permissions.
- Record immutable audit event.

### Acceptance Criteria

- Search supports both guided facets and typed queries.
- Exports are reproducible through stored query metadata.
- Large exports are asynchronous and do not block UI.

## Journey 5: Coverage Gap Analysis

### Primary Persona

Platform Engineer, CISO.

### Trigger

The organization wants to know where Visentra can and cannot see AI agent activity.

### Entry Points

- Discovery nav.
- Executive coverage card.
- Operations coverage warning.
- Settings integration health.

### Happy Path

1. User opens Coverage Map.
2. System displays environments by source family: endpoints, IDEs, repositories, cloud, containers, SaaS, MCP, browser, local LLM.
3. User filters by business unit, region, cloud account, device group, team, or source type.
4. System shows covered, partially covered, unsupported, stale, failed, and unconfigured areas.
5. User opens a gap.
6. System explains why the area is a gap: no collector, collector offline, missing permission, unsupported source, stale data, connector error, or data quality problem.
7. User exports coverage report.

### Coverage States

| State | Meaning |
|---|---|
| Covered | Source is configured, healthy, and recently observed. |
| Partial | Some expected entities are covered but not all capabilities are active. |
| Stale | Source was previously healthy but has not reported within threshold. |
| Failed | Source is configured but currently failing. |
| Unconfigured | Source is known but no collector/connector is configured. |
| Unsupported | Visentra does not yet support this source or capability. |
| Unknown | Inventory lacks enough context to determine coverage. |

### Acceptance Criteria

- Coverage gap analysis is evidence-based.
- Users can export coverage by environment and source.
- Product language avoids remediation promises; setup links are configuration, not enforcement.

## Cross-Journey Requirements

- Preserve tenant and RBAC context across every link.
- Show last updated timestamps on all operational views.
- Support deep links for investigations.
- Provide empty states that explain what source data is needed.
- Separate "not found" from "not covered".
- Make export available where customers need evidence.

## Related Documents

- [03-user-personas.md](./03-user-personas.md)
- [06-navigation-structure.md](./06-navigation-structure.md)
- [07-ui-screens.md](./07-ui-screens.md)
- [15-search-and-query.md](./15-search-and-query.md)
