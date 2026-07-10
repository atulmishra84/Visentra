# 08 - UI Widgets

## Overview

AgentRadar UI widgets must support enterprise discovery and visibility workflows: KPI monitoring, faceted search, dense tables, topology exploration, event timelines, realtime streams, usage analytics, coverage maps, and evidence drill-down. Widgets should be reusable across screens and implemented with consistent states, accessibility, exports, and RBAC behavior.

## Shared Widget Requirements

Every widget must define:

- Loading state.
- Empty state.
- Error/degraded state.
- Permission-denied state.
- Last updated timestamp when data can be stale.
- Export behavior when applicable.
- Realtime behavior when applicable.
- Keyboard accessibility.
- Test IDs for automated testing.

## KPI Cards

### Purpose

Summarize important counts and trends for executive and operational dashboards.

### Examples

- Total discovered agents.
- Newly discovered agents.
- Ownerless agents.
- Low-confidence candidates.
- Active discovery sources.
- Collector failures.
- MCP servers observed.
- Models/providers in use.

### Anatomy

| Element | Description |
|---|---|
| Label | Short metric name. |
| Value | Current value formatted for density. |
| Delta | Change over selected time range. |
| Sparkline | Optional trend line. |
| Status | Neutral, good, warning, error based on metric type. |
| Drill-down link | Opens filtered view. |
| Timestamp | Last calculation time. |

### Behavior

- Clicking the card opens the most relevant filtered table.
- Delta tooltips explain comparison period.
- Realtime updates should animate subtly and preserve readability.
- Cards must not imply policy enforcement; use terms like "ownerless", "low confidence", "coverage gap".

## Facet Panels

### Purpose

Enable fast filtering across high-cardinality inventory and events.

### Supported Facet Types

- Checkbox facets.
- Range sliders.
- Date ranges.
- Confidence ranges.
- Typeahead facets.
- Hierarchical facets.
- Relationship facets.
- Boolean presence facets.

### Required Facets

Common facets:

- Entity type.
- Source category.
- Owner/team.
- Environment.
- Status.
- Confidence.
- First seen.
- Last seen.

Agent facets:

- Agent class.
- Runtime type.
- Model provider.
- Framework.
- MCP server.
- Tool category.
- Repository organization.

### Behavior

- Show counts next to values.
- Support search within facet.
- Collapse long lists.
- Represent selected values as filter chips.
- Preserve filters in URL.
- Support "exclude" filters for advanced users.
- Avoid hidden filters that alter export unexpectedly.

## Data Tables

### Purpose

Provide dense, sortable, exportable lists of canonical assets, events, runs, collectors, and search results.

### Table Features

- Server-side pagination.
- Server-side sorting.
- Column customization.
- Sticky header.
- Row density toggle.
- Bulk select for export.
- Saved column presets.
- Inline badges for confidence, source, status, and coverage.
- Detail drawer on row click.

### Required Columns for Agent Table

| Column | Notes |
|---|---|
| Name | Display name with class icon. |
| Agent Class | Coding, local, framework, cloud, container, SaaS, MCP-enabled, browser, autonomous. |
| Confidence | Badge and numeric score. |
| Owner | Owner identity or unknown. |
| Runtime | Device/cloud/container/SaaS/IDE summary. |
| Models | Provider/model chips. |
| Tools/MCP | Counts and chips. |
| Sources | Source category badges. |
| First Seen | Timestamp. |
| Last Seen | Timestamp. |
| Status | Active, dormant, stale, deleted, unknown. |

### Behavior

- Row click opens drawer; explicit link opens full page.
- Table state persists per user and saved view.
- Exports include active filters, sort, and visible columns unless user chooses "all fields".
- Realtime updates should not reorder rows while user is interacting unless live mode is enabled.

## Topology Graph

### Purpose

Enable relationship exploration across agents, identities, models, tools, MCP servers, devices, repositories, clouds, containers, SaaS apps, and browser extensions.

### Node Types

- Agent.
- Agent Instance.
- Device.
- IDE.
- Model.
- Model Provider.
- Tool.
- MCP Server.
- Cloud Account.
- Cloud Resource.
- Container Workload.
- SaaS App.
- Browser Extension.
- Identity.
- Repository.
- Framework.

### Edge Types

- `RUNS_ON`
- `OBSERVED_IN`
- `USES_MODEL`
- `USES_PROVIDER`
- `USES_TOOL`
- `CONNECTS_TO_MCP_SERVER`
- `EXPOSES_TOOL`
- `DEFINED_IN_REPO`
- `OWNED_BY`
- `EXECUTES_AS`
- `ASSIGNED_TO`
- `BELONGS_TO_ACCOUNT`
- `DEPENDS_ON_FRAMEWORK`
- `DISCOVERED_BY`
- `EVIDENCED_BY`

### Controls

- Zoom.
- Pan.
- Fit.
- Depth selector.
- Relationship filters.
- Node type filters.
- Group by.
- Path finder.
- Search within graph.
- Export view.
- Live update toggle.

### Behavior

- Default to one-hop neighborhood.
- Summarize high-degree nodes.
- Use confidence and freshness visual encodings.
- Selecting a node opens detail drawer.
- Selecting an edge opens evidence drawer.
- Layout must remain stable during small updates.

## Timelines

### Purpose

Show ordered discovery, relationship, visibility, and activity events.

### Timeline Types

- Agent timeline.
- Discovery run timeline.
- Relationship timeline.
- Source/collector timeline.
- Identity timeline.
- Global discovery event timeline.

### Event Anatomy

| Element | Description |
|---|---|
| Timestamp | Occurred time. |
| Type | Event type. |
| Source | Collector/connector/service. |
| Entity | Related entity link. |
| Summary | Human-readable message. |
| Evidence | Evidence count/link. |
| Metadata | Expandable structured fields. |

### Behavior

- Support chronological and reverse chronological order.
- Group bursts of similar events.
- Provide live tail mode.
- Allow pause/resume.
- Preserve cursor on reconnect.
- Export selected time window.

## Event Streams

### Purpose

Display live discovery and pipeline events during active runs and operations monitoring.

### Stream Features

- Live tail.
- Pause.
- Severity filters.
- Source filters.
- Event type filters.
- Backfill from cursor.
- Copy event ID.
- Open related entity.

### Realtime Rules

- New items should not steal focus.
- If paused, show count of buffered events.
- Use stable event IDs to prevent duplicates.
- Show degraded state when realtime gateway disconnects.

## Usage Charts

### Purpose

Communicate adoption and distribution across models, frameworks, cloud, IDEs, MCP, SaaS, browser extensions, and local runtimes.

### Chart Types

- Time series.
- Stacked bar.
- Donut for distribution.
- Heatmap.
- Top-N horizontal bar.
- Histogram for confidence or tool counts.

### Required Usage Views

- Model provider usage.
- Model family usage.
- Framework usage.
- Cloud provider/service usage.
- IDE extension usage.
- MCP transport/auth/tool usage.
- SaaS AI feature usage.
- Local LLM runtime usage.

### Behavior

- Every chart segment must drill into filtered inventory.
- Charts must show the selected time range.
- "Other" buckets should be expandable.
- Export chart data as CSV.

## Coverage Maps

### Purpose

Show where discovery is active, partial, stale, failed, unconfigured, unsupported, or unknown.

### Coverage Map Types

- Matrix by source category and environment.
- Heatmap by business unit/team.
- Cloud account map.
- Device group coverage.
- SaaS tenant coverage.
- Repository organization coverage.

### Visual States

| State | UI Treatment |
|---|---|
| Covered | Success tone. |
| Partial | Warning tone. |
| Stale | Muted warning. |
| Failed | Error tone. |
| Unconfigured | Neutral empty. |
| Unsupported | Dashed/disabled. |
| Unknown | Neutral unknown. |

### Behavior

- Clicking a cell opens gap/source detail.
- Tooltip explains calculation and freshness.
- Export includes underlying coverage state and evidence.

## Detail Drawers

### Purpose

Allow quick inspection without leaving list, graph, timeline, or search context.

### Drawer Types

- Agent drawer.
- Entity drawer.
- Relationship evidence drawer.
- Discovery event drawer.
- Source/collector drawer.
- Export drawer.

### Drawer Requirements

- Header with entity name and type.
- Summary fields.
- Relationship counts.
- Evidence links.
- Primary action: open full detail.
- Secondary actions: copy link, export where allowed.
- Keyboard close and focus trap.

### Behavior

- Opening drawer updates URL shallowly.
- Drawer preserves parent scroll position.
- Drawer supports next/previous row navigation in tables.

## Confidence Badges

### Purpose

Represent confidence consistently across inventory, topology, search, and detail pages.

### Levels

| Range | Label | Meaning |
|---|---|---|
| 90-100 | High | Strong direct evidence. |
| 70-89 | Medium | Good evidence with minor uncertainty. |
| 40-69 | Low | Weak or incomplete evidence. |
| 0-39 | Candidate | Possible agent or relationship. |

### Behavior

- Tooltip shows confidence reasons.
- Detail view links to evidence.
- Color must not be the only indicator.

## Evidence Panels

### Purpose

Show why AgentRadar believes an entity or relationship exists.

### Contents

- Source.
- Source category.
- Observation time.
- Field path.
- Normalized field.
- Value preview/hash.
- Confidence contribution.
- Raw payload reference if allowed.

### Behavior

- Sensitive values are redacted or hashed.
- Evidence is sortable and filterable.
- Export respects evidence permissions.

## Empty States

Empty states must clarify cause:

| State | Message Pattern |
|---|---|
| No data | "No agents match these filters." |
| No coverage | "This environment is not covered by any configured source." |
| No permission | "You do not have access to this evidence." |
| Not supported | "This source category is not supported by the current connector." |
| Loading | Skeleton with expected layout. |
| Degraded | "Search is temporarily unavailable; inventory detail remains available." |

## Related Documents

- [07-ui-screens.md](./07-ui-screens.md)
- [15-search-and-query.md](./15-search-and-query.md)
- [16-topology-and-relationship-mapping.md](./16-topology-and-relationship-mapping.md)
- [29-ux-guidelines.md](./29-ux-guidelines.md)
