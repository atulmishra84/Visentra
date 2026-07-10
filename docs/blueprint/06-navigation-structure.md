# 06 - Navigation Structure

## Overview

AgentRadar navigation must support executive monitoring, operational investigation, discovery administration, inventory exploration, topology analysis, usage analytics, event review, enterprise search, and settings. The structure should feel familiar to users of CrowdStrike, Wiz, Datadog, and ServiceNow: a persistent left navigation, strong global search, role-aware visibility, and fast drill-down.

## Navigation Principles

1. Put high-level posture first, investigation second, administration later.
2. Make Search globally available from every screen.
3. Keep Discovery configuration separate from Asset Inventory analysis.
4. Treat Topology and Relationship Explorer as central workflows, not hidden utilities.
5. Hide pages that a role cannot access, but preserve deep-link error clarity.
6. Avoid governance language such as "policies", "remediation", "approval", or "enforcement" in V1/V2 navigation.

## Primary Navigation

| Nav Item | Purpose | Primary Personas |
|---|---|---|
| Executive | High-level AI agent inventory, trends, coverage, and business summary. | CISO, Auditor. |
| Operations | Analyst workbench for newly discovered, changed, ownerless, and low-confidence agents. | SecOps Analyst, CISO. |
| Discovery | Source setup, discovery runs, collector health, coverage gaps. | Platform Engineer. |
| Asset Inventory | Canonical lists of agents and related assets. | All technical personas. |
| Topology Map | Visual graph exploration across agents and relationships. | SecOps, AI Platform, CISO. |
| Usage Analytics | Model, framework, cloud, IDE, SaaS, MCP, browser, and local LLM usage. | AI Platform, CISO. |
| Agent Timeline | Time-based visibility into selected agent/activity events. | SecOps, Auditor. |
| Relationship Explorer | Query-focused graph/path exploration. | SecOps, AI Platform. |
| Discovery Events | Event stream for pipeline and discovery activity. | SecOps, Platform Engineer, Auditor. |
| Inventory Explorer | Advanced faceted exploration across all object types. | SecOps, AI Platform, Auditor. |
| Search | Global search and saved searches. | All personas. |
| Settings | Tenant, integrations, collectors, RBAC, exports, and system configuration. | Platform Engineer, Admin. |

## Proposed Left Nav Tree

```text
AgentRadar
├── Executive
│   ├── Overview
│   ├── Coverage
│   └── Trends
├── Operations
│   ├── Workbench
│   ├── New Discoveries
│   ├── Ownerless Agents
│   ├── Low Confidence
│   └── Changed Relationships
├── Discovery
│   ├── Sources
│   ├── Runs
│   ├── Collector Health
│   ├── Coverage Map
│   └── Data Quality
├── Asset Inventory
│   ├── Agents
│   ├── Devices
│   ├── IDEs
│   ├── Models
│   ├── Tools
│   ├── MCP Servers
│   ├── Cloud
│   ├── Containers
│   ├── SaaS
│   ├── Browser Extensions
│   ├── Local LLMs
│   ├── Identities
│   └── Repositories
├── Topology Map
├── Usage Analytics
│   ├── Model Usage
│   ├── Framework Usage
│   ├── Cloud Usage
│   ├── IDE Usage
│   ├── MCP Usage
│   ├── SaaS Usage
│   └── Local Runtime Usage
├── Agent Timeline
├── Relationship Explorer
├── Discovery Events
├── Inventory Explorer
├── Search
│   ├── Global Search
│   ├── Saved Searches
│   └── Export History
└── Settings
    ├── Tenant
    ├── Users and Roles
    ├── Integrations
    ├── Collectors
    ├── Export Destinations
    ├── API Tokens
    ├── Audit Log
    └── Data Retention
```

## Global Header

The global header should include:

- Tenant switcher if user has access to multiple tenants.
- Global search bar with keyboard shortcut.
- Time range selector for dashboards and timelines.
- Realtime connection status.
- Notifications for exports and discovery runs.
- User menu.
- Help/documentation link.

## Page-Level Navigation Rules

### Executive

Default route: `/executive/overview`.

Subsections:

- Overview: KPI cards, trend charts, discovery category coverage, top changes.
- Coverage: source coverage map and blind spots.
- Trends: agent counts, model usage, framework adoption, owner resolution over time.

Design style:

- Summary-first.
- Drill-down links to operations/inventory.
- Export executive summary.

### Operations

Default route: `/operations/workbench`.

Subsections:

- Workbench: analyst queue with filters.
- New Discoveries: agents first seen in selected period.
- Ownerless Agents: agents with unresolved owner.
- Low Confidence: candidates requiring human interpretation.
- Changed Relationships: relationship additions/removals.

Design style:

- Dense tables.
- Fast filters.
- Detail drawers.
- Saved views.

### Discovery

Default route: `/discovery/sources`.

Subsections:

- Sources: configured and available connectors.
- Runs: discovery run list and detail.
- Collector Health: collector fleet status.
- Coverage Map: source coverage by environment.
- Data Quality: rejected/quarantined observations and mapping issues.

Design style:

- Operational clarity.
- Health states.
- Setup guidance.
- No remediation workflows.

### Asset Inventory

Default route: `/inventory/agents`.

Each asset list supports:

- Facets.
- Sortable columns.
- Column customization.
- Bulk export.
- Detail drawer.
- Link to topology.

Asset inventory should not become multiple unrelated mini-apps. The table and detail drawer pattern should be consistent across object types.

### Topology Map

Default route: `/topology`.

Entry parameters:

- `center_entity_id`
- `relationship_types`
- `depth`
- `time_range`
- `group_by`

Topology map should be accessible from every entity detail page.

### Usage Analytics

Default route: `/usage/models`.

Usage analytics pages:

- Model Usage.
- Framework Usage.
- Cloud Usage.
- IDE Usage.
- MCP Usage.
- SaaS Usage.
- Local Runtime Usage.

These pages are inventory analytics, not cost governance or policy management.

### Agent Timeline

Default route: `/timeline`.

Timeline can be global or scoped:

- Agent-scoped.
- Source-scoped.
- Relationship-scoped.
- Identity-scoped.
- Discovery-run-scoped.

### Relationship Explorer

Default route: `/relationships`.

Relationship Explorer is a query-style graph interface for users who want precise paths and relationship filters rather than visual exploration only.

### Discovery Events

Default route: `/events/discovery`.

Events should support live tailing, historical filters, severity, source, entity type, discovery run, and export.

### Inventory Explorer

Default route: `/explorer`.

Inventory Explorer is an advanced faceted view across all object types. It supports multi-entity queries such as "agents using MCP servers exposed by devices in Engineering".

### Search

Default route: `/search`.

Search contains:

- Global search.
- Saved searches.
- Export history.

Saved searches are user/team assets, not policies.

### Settings

Default route: `/settings/tenant`.

Settings are role-aware. Most users should not see collector credentials or admin-only options.

## Breadcrumb Pattern

Use breadcrumbs for entity detail pages and nested settings:

```text
Asset Inventory / Agents / checkout-coding-agent
Discovery / Runs / run_2026_07_10_001
Usage Analytics / MCP Usage / filesystem-server
```

## Drill-Down Link Rules

| Source | Destination |
|---|---|
| KPI card | Filtered inventory or trend page. |
| Table row | Detail drawer by default; full page via explicit action. |
| Graph node | Detail drawer and "open full detail". |
| Graph edge | Relationship evidence drawer. |
| Timeline event | Related entity detail and evidence. |
| Coverage gap | Source setup/health detail. |
| Search result | Entity detail. |

## Role-Aware Defaults

| Persona | Default Landing Page |
|---|---|
| CISO | Executive Overview. |
| SecOps Analyst | Operations Workbench. |
| Platform Engineer | Discovery Sources or Coverage Map. |
| AI Platform Engineer | Usage Analytics / Model Usage. |
| Developer | Scoped Asset Inventory / Agents. |
| Auditor | Search or Executive Overview. |

## Related Documents

- [03-user-personas.md](./03-user-personas.md)
- [07-ui-screens.md](./07-ui-screens.md)
- [08-ui-widgets.md](./08-ui-widgets.md)
- [29-ux-guidelines.md](./29-ux-guidelines.md)
