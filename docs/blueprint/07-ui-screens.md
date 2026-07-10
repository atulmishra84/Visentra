# 07 - UI Screens

## Overview

This document defines the major AgentRadar UI screens. Each screen should be implementation-ready: purpose, primary widgets, filters, drill-down paths, export behavior, and realtime behavior are specified. The visual language should match enterprise security and observability products: high trust, dense where needed, fast filters, clear evidence, strong status states, and no governance/remediation actions in V1/V2.

## Common Screen Contract

Every data screen should include:

- Page title and short description.
- Last updated timestamp.
- Time range selector when relevant.
- Active filter chips.
- Export action when results are reportable.
- Empty state that distinguishes no data, no coverage, no permission, and loading.
- Drill-down paths to entity detail.
- RBAC-aware controls.

## 1. Executive Overview

### Purpose

Provide the CISO and executive stakeholders with a concise picture of AI agent inventory, growth, ownership, source coverage, and key visibility trends.

### Primary Widgets

- Total discovered agents KPI.
- Newly discovered agents KPI.
- Ownerless agents KPI.
- Low-confidence agents KPI.
- Discovery coverage score.
- Agents by category chart.
- Models/providers in use chart.
- Top business units by agent count.
- Coverage blind spots panel.
- Recent significant changes list.

### Filters

- Time range.
- Business unit.
- Team.
- Environment.
- Source category.
- Deployment state.

### Drill-Down

- KPI cards link to filtered Inventory Explorer or Operations queue.
- Coverage score links to Coverage Map.
- Model chart links to Model Usage.
- Recent changes link to Agent Timeline or Discovery Events.

### Export

- Executive summary PDF/CSV package.
- KPI data CSV.
- Coverage summary CSV.

### Realtime

- KPI deltas update during active discovery runs.
- Realtime indicator shows when counters are live versus snapshot.

## 2. Executive Coverage

### Purpose

Show where discovery is active, partial, stale, failed, unconfigured, unsupported, or unknown.

### Primary Widgets

- Coverage matrix by source category and environment.
- Heatmap by business unit/team.
- Collector health summary.
- Cloud account coverage.
- SaaS tenant coverage.
- Repository organization coverage.
- Endpoint/IDE fleet coverage.

### Filters

- Source category.
- Environment.
- Business unit.
- Region.
- Cloud provider/account.
- Device group.
- Connector status.

### Drill-Down

- Coverage cell opens source detail.
- Failed sources open connector health.
- Stale collectors open collector detail.
- Unconfigured sources open setup guide if user has permission.

### Export

- Coverage report by source/environment.
- Collector health export.
- Gap list export.

### Realtime

- Collector health and active discovery run progress update live.

## 3. Operations Workbench

### Purpose

Give analysts a focused queue for investigating discovered and changed agent assets.

### Primary Widgets

- Queue table.
- Severity/priority facets.
- New discoveries card.
- Ownerless agents card.
- Low-confidence candidates card.
- Changed relationships card.
- Detail drawer.

### Filters

- Time range.
- Queue type.
- Agent class.
- Confidence.
- Owner status.
- Source category.
- Environment.
- Relationship change type.

### Drill-Down

- Row opens agent detail drawer.
- "Open full page" loads Agent Detail.
- Relationship count opens Relationship Explorer.
- Evidence count opens Evidence panel.

### Export

- Queue export.
- Selected agents export.
- Investigation evidence export.

### Realtime

- Queue can live-update for new discovery events.
- Users can pause live updates to preserve table position.

## 4. New Discoveries

### Purpose

Show agents and related assets first observed in the selected time period.

### Primary Widgets

- New agents trend.
- New agents table.
- New MCP servers table.
- New models/providers observed.
- Source contribution chart.

### Filters

- First seen range.
- Source category.
- Agent class.
- Confidence.
- Owner/team.
- Environment.

### Drill-Down

- Agent rows to detail.
- Source chart to Discovery Run or Source Detail.

### Export

- New discovery inventory CSV/JSON.

### Realtime

- Optional live mode for active discovery runs.

## 5. Ownerless Agents

### Purpose

Help security and platform teams understand agents without clear owners.

### Primary Widgets

- Ownerless count KPI.
- Owner resolution confidence distribution.
- Ownerless agents table.
- Candidate owner evidence panel.

### Filters

- Confidence.
- Source category.
- Runtime type.
- Repository organization.
- Device group.
- Business unit.

### Drill-Down

- Candidate owner click opens identity detail.
- Evidence opens ownership evidence drawer.

### Export

- Ownerless asset export with candidate owner evidence.

### Realtime

- Updates when identity enrichment changes ownership state.

## 6. Low Confidence

### Purpose

Show low-confidence agent candidates, possible duplicates, and weak evidence patterns.

### Primary Widgets

- Confidence distribution histogram.
- Low-confidence candidate table.
- Evidence signal matrix.
- Possible duplicates panel.

### Filters

- Confidence range.
- Signal type.
- Source category.
- Entity type.
- First/last seen.

### Drill-Down

- Candidate detail.
- Evidence detail.
- Possible duplicate relationship view.

### Export

- Low-confidence candidates export for offline analysis.

### Realtime

- Candidate confidence can update as new signals arrive.

## 7. Discovery Sources

### Purpose

Configure and understand discovery source families.

### Primary Widgets

- Source category cards.
- Configured connector table.
- Available connector catalog.
- Permission requirements panel.
- Setup progress checklist.

### Filters

- Source category.
- Connector status.
- Environment.
- Capability.

### Drill-Down

- Source card opens connector setup/detail.
- Connector opens health and configuration.

### Export

- Source configuration summary without secrets.

### Realtime

- Setup validation and health tests update live.

## 8. Discovery Runs

### Purpose

Track historical and active discovery runs.

### Primary Widgets

- Runs table.
- Active run progress.
- Records observed/normalized/resolved/indexed counters.
- Rejection and quarantine counts.
- Run timeline.

### Filters

- Run status.
- Source category.
- Connector.
- Time range.
- Initiator.

### Drill-Down

- Run detail.
- Rejected records.
- Newly created assets.
- Coverage deltas.

### Export

- Run summary.
- Run-created assets.
- Run events.

### Realtime

- Active runs update progress, logs, and counters live.

## 9. Collector Health

### Purpose

Monitor collector fleet status, capability, version, and data flow.

### Primary Widgets

- Collector status KPI cards.
- Collector table.
- Version distribution chart.
- Heartbeat timeline.
- Error summary.

### Filters

- Status.
- Version.
- Source type.
- Environment.
- Device group.
- Region.

### Drill-Down

- Collector detail.
- Source coverage.
- Recent errors.
- Related discoveries.

### Export

- Collector fleet export.
- Health report.

### Realtime

- Heartbeats and status changes update live.

## 10. Coverage Map

### Purpose

Show coverage by source, environment, team, cloud account, SaaS tenant, repository organization, and device group.

### Primary Widgets

- Coverage heatmap.
- Gap list.
- Coverage trend.
- Source capability matrix.
- Environment hierarchy tree.

### Filters

- Source category.
- Environment.
- Business unit.
- Region.
- Connector.
- Coverage state.

### Drill-Down

- Gap detail.
- Source setup.
- Collector health.
- Affected inventory.

### Export

- Coverage report.
- Gap list.

### Realtime

- Coverage updates on collector health and discovery run completion.

## 11. Data Quality

### Purpose

Expose ingestion, normalization, identity resolution, graph, and indexing data quality issues.

### Primary Widgets

- Rejected observations table.
- Quarantined records table.
- Schema error chart.
- Mapping coverage table.
- Indexing lag card.

### Filters

- Source.
- Error type.
- Service.
- Connector version.
- Time range.

### Drill-Down

- Error detail.
- Raw evidence metadata.
- Connector detail.

### Export

- Data quality error export.

### Realtime

- Error counts update during active runs.

## 12. Agent Inventory

### Purpose

Canonical table of all discovered agents.

### Primary Widgets

- Agent table.
- Facet panel.
- Column manager.
- Saved views.
- Detail drawer.

### Filters

- Agent class.
- Source category.
- Runtime type.
- Model provider.
- Framework.
- MCP server.
- Owner/team.
- Confidence.
- Status.
- First/last seen.
- Environment.

### Drill-Down

- Agent detail.
- Topology centered on agent.
- Timeline scoped to agent.
- Evidence drawer.

### Export

- Filtered agent list.
- Selected agents.
- Full inventory snapshot.

### Realtime

- Optional live refresh with pause.

## 13. Agent Detail

### Purpose

Provide the complete evidence-backed view of one agent.

### Primary Widgets

- Header summary.
- Confidence explainer.
- Relationship cards.
- Runtime instances table.
- Model/tool/MCP panels.
- Owner and identity panel.
- Repository panel.
- Evidence table.
- Timeline.
- Mini topology.

### Filters

- Evidence source.
- Relationship type.
- Timeline event type.
- Time range.

### Drill-Down

- Related entity details.
- Full topology map.
- Relationship Explorer.
- Raw evidence metadata.

### Export

- Agent evidence package.
- Relationship list.
- Timeline export.

### Realtime

- Relationship and timeline updates when scoped live mode is enabled.

## 14. Device Inventory

### Purpose

Show devices where local, IDE, browser, local LLM, or autonomous agent signals are observed.

### Primary Widgets

- Device table.
- OS/version facets.
- Assigned user panel.
- Agent count column.
- Collector status column.

### Filters

- OS.
- Device type.
- Collector status.
- Assigned identity.
- Agent count.
- Last seen.

### Drill-Down

- Device detail.
- Agents running on device.
- IDE/browser/local LLM panels.

### Export

- Device inventory with agent relationships.

### Realtime

- Collector status changes live.

## 15. IDE Inventory

### Purpose

Show AI-enabled IDE installations, extensions, workspaces, MCP configs, and related agents.

### Primary Widgets

- IDE table.
- Extension usage chart.
- MCP config indicator.
- Workspace/repository links.

### Filters

- IDE type.
- Extension.
- Device group.
- Repository.
- MCP present.
- Last seen.

### Drill-Down

- IDE detail.
- Extension detail.
- Related agents.

### Export

- IDE usage export.

### Realtime

- Updates when endpoint collectors submit IDE observations.

## 16. Models Inventory and Usage

### Purpose

Show models and providers used by discovered agents.

### Primary Widgets

- Provider distribution chart.
- Model table.
- Agents per model.
- Hosting type chart.
- Trend over time.

### Filters

- Provider.
- Model family.
- Hosting type.
- Environment.
- Team.
- Agent class.

### Drill-Down

- Model detail.
- Agents using model.
- Provider detail.
- Topology centered on model.

### Export

- Model usage export.

### Realtime

- New model observations update charts.

## 17. Tools Inventory

### Purpose

Show tools available to or used by agents.

### Primary Widgets

- Tool table.
- Category chart.
- MCP exposed tools panel.
- Agent usage counts.

### Filters

- Tool category.
- Source type.
- MCP server.
- Agent class.
- Sensitivity metadata.

### Drill-Down

- Tool detail.
- Agents using tool.
- MCP server exposing tool.

### Export

- Tool inventory export.

### Realtime

- Updates when MCP/tool schemas change.

## 18. MCP Servers

### Purpose

Inventory MCP servers, exposed tools/resources, connected agents, and configuration locations.

### Primary Widgets

- MCP server table.
- Transport distribution.
- Tool count histogram.
- Connected agents count.
- Auth mode distribution.

### Filters

- Transport.
- Auth mode.
- Tool category.
- Owner.
- Config source.
- Last seen.

### Drill-Down

- MCP server detail.
- Tools exposed.
- Connected agents.
- Config evidence.
- Topology.

### Export

- MCP inventory and tool schema summary.

### Realtime

- Updates on config changes and tool schema observations.

## 19. Cloud Inventory and Usage

### Purpose

Show cloud accounts/resources that host, invoke, or connect to agents and models.

### Primary Widgets

- Cloud account table.
- Resource table.
- Provider/region charts.
- Agents per account.
- Managed AI service usage.

### Filters

- Provider.
- Account.
- Region.
- Service.
- Resource type.
- Environment.
- Identity.

### Drill-Down

- Account detail.
- Resource detail.
- Agents running on resource.
- Identity relationships.

### Export

- Cloud-agent relationship export.

### Realtime

- Connector scan completion updates coverage and inventory.

## 20. Containers Inventory

### Purpose

Show container workloads and images associated with agents.

### Primary Widgets

- Workload table.
- Cluster/namespace facets.
- Image table.
- Agent count by workload.
- Framework/model indicators.

### Filters

- Platform.
- Cluster.
- Namespace.
- Image.
- Label.
- Environment.
- Last seen.

### Drill-Down

- Workload detail.
- Image detail.
- Agent instances.
- Topology.

### Export

- Container-agent inventory export.

### Realtime

- Optional updates from cluster collectors.

## 21. SaaS Inventory

### Purpose

Show SaaS applications and tenants with AI agent or assistant features.

### Primary Widgets

- SaaS app table.
- AI feature inventory.
- Tenant coverage.
- Marketplace integration panel.

### Filters

- Provider.
- App category.
- AI feature.
- Tenant.
- Coverage state.

### Drill-Down

- SaaS app detail.
- Agents observed in app.
- Integration evidence.

### Export

- SaaS AI inventory export.

### Realtime

- Updates on connector scan completion.

## 22. Browser Extensions

### Purpose

Show browser extensions with AI/agentic behavior or permissions.

### Primary Widgets

- Extension table.
- Permission facets.
- Host permission summary.
- Device/user relationship counts.

### Filters

- Browser.
- Extension.
- Permission.
- Device group.
- Identity.
- AI indicator.

### Drill-Down

- Extension detail.
- Devices/users.
- Related agents.

### Export

- Browser extension inventory export.

### Realtime

- Endpoint collector updates.

## 23. Local LLMs

### Purpose

Show local and self-hosted model runtimes such as Ollama, LM Studio, llama.cpp, vLLM, and TGI.

### Primary Widgets

- Runtime table.
- Model cache table.
- Device/server relationships.
- Agent usage count.

### Filters

- Runtime.
- Model family.
- Device group.
- Hosting type.
- Last seen.

### Drill-Down

- Runtime detail.
- Local models.
- Agents using runtime.

### Export

- Local LLM inventory export.

### Realtime

- Endpoint/server collector updates.

## 24. Identities

### Purpose

Show human and service identities connected to agents.

### Primary Widgets

- Identity table.
- Agent relationship counts.
- Owner/execution distinction.
- Group/team facets.

### Filters

- Identity type.
- Department.
- Group.
- Agent count.
- Source.
- Status.

### Drill-Down

- Identity detail.
- Owned agents.
- Execution relationships.
- Topology centered on identity.

### Export

- Identity-agent relationship export.

### Realtime

- Identity enrichment updates.

## 25. Repositories

### Purpose

Show repositories that define, configure, or reference agents, frameworks, models, tools, and MCP servers.

### Primary Widgets

- Repository table.
- Framework indicators.
- Model provider indicators.
- MCP config paths.
- Agent count.

### Filters

- Provider.
- Org.
- Language.
- Framework.
- Model provider.
- MCP present.
- Owner/team.

### Drill-Down

- Repository detail.
- Agents defined in repo.
- Evidence files metadata.

### Export

- Repository-agent relationship export.

### Realtime

- Repository scan completion updates.

## 26. Topology Map

### Purpose

Visual graph exploration of agents and relationships.

### Primary Widgets

- Graph canvas.
- Node/edge legend.
- Filter panel.
- Selected node drawer.
- Selected edge evidence drawer.
- Path finder.
- Graph minimap.

### Filters

- Entity type.
- Relationship type.
- Confidence.
- Source category.
- Time range.
- Depth.
- Grouping.

### Drill-Down

- Node detail.
- Edge evidence.
- Agent detail.
- Relationship Explorer.

### Export

- PNG/SVG view export.
- JSON relationship export.

### Realtime

- Optional live topology updates with change highlighting.

## 27. Agent Timeline

### Purpose

Chronological view of discovery, visibility, relationship, and activity events.

### Primary Widgets

- Timeline rail.
- Event table.
- Event detail drawer.
- Activity density chart.
- Relationship change markers.

### Filters

- Entity.
- Event type.
- Source.
- Severity.
- Time range.
- Relationship type.

### Drill-Down

- Entity detail.
- Evidence.
- Discovery run.
- Topology at time.

### Export

- Timeline export CSV/JSON.

### Realtime

- Live tail mode with pause and cursor resume.

## 28. Relationship Explorer

### Purpose

Structured graph query and path analysis for relationships.

### Primary Widgets

- Query builder.
- Entity selectors.
- Relationship filters.
- Result paths table.
- Mini graph.
- Evidence drawer.

### Filters

- From entity.
- To entity.
- Relationship type.
- Depth.
- Confidence.
- Time range.

### Drill-Down

- Path to topology.
- Node detail.
- Edge evidence.

### Export

- Path results export.

### Realtime

- Query results are snapshot-based; users can refresh.

## 29. Discovery Events

### Purpose

Live and historical event stream for discovery pipeline and inventory changes.

### Primary Widgets

- Event stream.
- Severity counts.
- Source facets.
- Run selector.
- Event detail drawer.

### Filters

- Time range.
- Severity.
- Event type.
- Source category.
- Discovery run.
- Entity type.

### Drill-Down

- Entity detail.
- Run detail.
- Evidence.

### Export

- Event export.

### Realtime

- Live tail with pause, resume, and cursor.

## 30. Inventory Explorer

### Purpose

Advanced cross-entity faceted exploration.

### Primary Widgets

- Entity type selector.
- Facet panel.
- Query bar.
- Results table.
- Relationship constraints.
- Saved view sidebar.

### Filters

- All canonical fields.
- Relationship existence filters.
- Time fields.
- Confidence.
- Source coverage.

### Drill-Down

- Entity detail.
- Search.
- Topology.

### Export

- Result set export.

### Realtime

- Optional refresh; not live by default.

## 31. Search

### Purpose

Global keyword and structured query search across entities, evidence metadata, events, and saved searches.

### Primary Widgets

- Search bar.
- Result type tabs.
- Facets.
- Result list/table.
- Query syntax helper.
- Saved searches.

### Filters

- Entity type.
- Source category.
- Time range.
- Owner/team.
- Confidence.

### Drill-Down

- Search result detail.
- Related topology.

### Export

- Search results export.

### Realtime

- Search results are snapshot-based with manual refresh.

## 32. Settings

### Purpose

Tenant administration, integrations, collectors, users/roles, API tokens, export destinations, audit log, and data retention.

### Primary Widgets

- Settings sidebar.
- Configuration forms.
- Connection tests.
- Role tables.
- Audit log table.

### Filters

- Settings-specific filters for users, audit logs, tokens, integrations.

### Drill-Down

- Integration detail.
- Collector config.
- User role detail.
- Audit event detail.

### Export

- Audit log export.
- Configuration summary export without secrets.

### Realtime

- Connection tests and validation results update as completed.

## Related Documents

- [06-navigation-structure.md](./06-navigation-structure.md)
- [08-ui-widgets.md](./08-ui-widgets.md)
- [23-frontend-architecture.md](./23-frontend-architecture.md)
- [29-ux-guidelines.md](./29-ux-guidelines.md)
