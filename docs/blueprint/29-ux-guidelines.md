# 29 - UX Guidelines

## Overview

AgentRadar should feel like a serious enterprise security and observability platform. The UX must support executives scanning posture, analysts investigating details, platform engineers managing coverage, AI platform teams analyzing adoption, developers reviewing owned assets, and auditors exporting evidence.

The product experience should be fast, dense, evidence-backed, accessible, and trustworthy. It must not introduce governance/remediation language or workflows in V1/V2.

## UX Principles

1. **Evidence first**: any important claim should link to source evidence.
2. **Drill down everywhere**: summaries should always connect to underlying assets.
3. **Filter before overwhelm**: large enterprise inventories require strong facets and saved views.
4. **Realtime with control**: live updates are useful only when users can pause and resume.
5. **Density is a feature**: analysts need dense tables, but executives need readable summaries.
6. **Export is primary**: enterprise users must be able to take inventory and evidence out.
7. **Accessibility is non-negotiable**: graph-heavy UI still needs keyboard and screen-reader alternatives.
8. **No hidden enforcement**: avoid UI affordances that imply blocking, approval, quarantine, or remediation.

## Enterprise Visual Tone

AgentRadar should visually align with mature enterprise platforms:

- Clear hierarchy.
- Subtle color.
- High information density.
- Precise labels.
- Status badges with text and color.
- Professional charts.
- Minimal decorative illustration.
- Strong empty and degraded states.

Avoid:

- Consumer AI chat aesthetics.
- Overly playful language.
- Large unstructured cards with little data.
- Vague risk language without evidence.

## Filtering Guidelines

### Global Rules

- Filters should be visible, persistent, and shareable through URL.
- Active filters appear as chips.
- Every filter chip can be removed individually.
- "Clear all" is always available.
- Filter counts should reflect current result set.
- Advanced filters should not hide selected state.

### Required Filter Types

| Filter Type | Use |
|---|---|
| Time range | Dashboards, timelines, events, discovery runs. |
| Source category | Discovery and inventory. |
| Entity type | Search and Inventory Explorer. |
| Confidence | Agents, relationships, candidates. |
| Owner/team | Inventory, executive, operations. |
| Environment | Production/staging/dev/personal/lab. |
| Relationship type | Topology and Relationship Explorer. |
| Coverage state | Discovery coverage. |

### Filter Language

Use precise terms:

- "Ownerless" instead of "non-compliant".
- "Low confidence" instead of "bad".
- "Coverage gap" instead of "violation".
- "Stale source" instead of "failed control".
- "Export evidence" instead of "remediate".

## Drill-Down Guidelines

Every summarized value should answer "show me the rows behind this."

| UI Element | Drill-Down Target |
|---|---|
| KPI card | Filtered inventory or operations queue. |
| Chart segment | Filtered table with same context. |
| Coverage cell | Coverage detail and source health. |
| Graph node | Detail drawer. |
| Graph edge | Relationship evidence drawer. |
| Timeline event | Event detail and related entity. |
| Search result | Entity detail. |

### Detail Drawer Rules

- Drawers should preserve parent context and scroll position.
- Full detail page should be one click away.
- Drawers must support keyboard close.
- Row-to-row navigation is useful in dense tables.
- Drawers should not hide critical table filters.

## Realtime Guidelines

Realtime updates are valuable for:

- Active discovery runs.
- Event streams.
- Collector health.
- Export completion.
- Agent timeline live tail.
- Topology change highlighting.

Realtime must be user-controlled:

- Provide live/pause toggle.
- Show connection status.
- Buffer updates while paused.
- Do not reorder tables unexpectedly.
- Preserve scroll position.
- Use subtle change highlights.
- Provide reconnect/resume state.

## Export Guidelines

Export is a first-class enterprise workflow.

### Export Locations

- Executive Overview.
- Coverage Map.
- Operations Workbench.
- Agent Inventory.
- Agent Detail.
- Search.
- Inventory Explorer.
- Discovery Runs.
- Discovery Events.
- Relationship Explorer.
- Topology Map.
- Settings Audit Log.

### Export Metadata

Every export includes:

- Export ID.
- Actor.
- Tenant.
- Timestamp.
- Query.
- Filters.
- Sort.
- Columns.
- Result count.
- Schema version.
- Data sensitivity notice.

### Export UX

- Small exports can download synchronously.
- Large exports become async jobs.
- Export drawer shows progress.
- Export history is searchable.
- Failed exports show retryable error.
- Exports respect field permissions.

## Density Guidelines

AgentRadar needs density controls because personas differ.

| Density | Use |
|---|---|
| Comfortable | Executive and general overview. |
| Standard | Most inventory and settings screens. |
| Compact | Analyst workbench and high-volume tables. |

### Table Density Requirements

- User preference persists.
- Compact mode retains readable badges.
- Row height should support at least two-line names when necessary.
- Column manager prevents horizontal overload.
- Sticky headers and visible sort indicators are required.

## Accessibility Guidelines

### General

- Meet WCAG 2.1 AA.
- Provide keyboard access for navigation, filters, drawers, modals, tabs, and tables.
- Color cannot be the only status indicator.
- All charts need data table alternatives or accessible summaries.
- Focus order must be predictable.
- Support reduced motion.

### Graph Accessibility

Graph UI must have non-visual equivalents:

- Relationship table view.
- Path results table.
- Keyboard-selectable node list.
- Edge evidence drawer accessible from table.
- Text summary of graph contents.

### Realtime Accessibility

- Do not auto-focus new events.
- Announce important updates politely.
- Let users pause live updates.
- Avoid motion-heavy update animations.

## Empty State Guidelines

Empty states must explain the reason.

| Reason | Copy Pattern |
|---|---|
| No matching data | "No agents match the current filters." |
| Not covered | "This environment is not covered by a configured discovery source." |
| Source failed | "This source is configured but has not completed a successful scan." |
| Permission denied | "You do not have access to this evidence." |
| Unsupported | "This source category is not supported by the current connector." |
| First run needed | "Start a discovery run to populate this view." |

## Error and Degraded State Guidelines

Enterprise users need honest degraded states.

- Search unavailable: keep inventory detail accessible.
- Graph unavailable: show relationship table fallback.
- Realtime disconnected: show snapshot mode.
- Export delayed: show async job state.
- Source API rate-limited: show retry state and timestamp.

## Confidence UX

Confidence should be transparent:

- Show numeric score and label.
- Provide tooltip with reasons.
- Link to evidence.
- Separate agent confidence from owner confidence and relationship confidence.
- Do not frame low confidence as a policy failure.

## Copy Guidelines

Preferred verbs:

- Discover.
- View.
- Explore.
- Search.
- Export.
- Investigate.
- Analyze.
- Configure.

Avoid in V1/V2:

- Enforce.
- Block.
- Approve.
- Deny.
- Quarantine.
- Remediate.
- Comply/non-comply as object state.

## Information Hierarchy

Agent detail order:

1. What is it?
2. Where is it?
3. Who owns or uses it?
4. What models/tools/MCP servers does it use?
5. Which repositories/cloud/devices/SaaS contexts relate to it?
6. What evidence supports this?
7. What changed over time?

## Related Documents

- [06-navigation-structure.md](./06-navigation-structure.md)
- [07-ui-screens.md](./07-ui-screens.md)
- [08-ui-widgets.md](./08-ui-widgets.md)
- [30-roadmap.md](./30-roadmap.md)
