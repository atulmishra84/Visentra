# 03 - User Personas

## Overview

Visentra serves enterprise teams that need to understand AI agent presence, ownership, relationships, and activity. The product must support executive visibility, operational investigation, platform coverage management, AI adoption analysis, developer accountability, and audit evidence without introducing governance or remediation workflows in V1/V2.

## Persona Summary

| Persona | Primary Job | Primary Screens | Access Pattern |
|---|---|---|---|
| CISO | Understand enterprise AI agent exposure and coverage. | Executive, Operations, Topology Map, Search, Exports. | Broad read-only with export. |
| SecOps Analyst | Investigate unknown or suspicious agents and relationships. | Operations, Agent Detail, Topology Map, Event Timeline, Search. | Broad investigative read with evidence access. |
| Platform Engineer | Deploy and operate discovery coverage across endpoints, cloud, containers, and SaaS. | Discovery, Coverage Maps, Settings, Collector Health. | Admin for collectors and integrations. |
| AI Platform Engineer | Understand model, framework, MCP, and agent platform usage. | Model/Framework/Cloud/IDE Usage, Inventory Explorer, Relationship Explorer. | Technical read/write for source labels and ownership metadata. |
| Developer | See agents and AI tools associated with owned devices, repos, and workspaces. | Asset Inventory, Agent Detail, Repository Views, Search. | Scoped read based on ownership/team. |
| Auditor/Compliance | Review visibility evidence, inventory snapshots, and exports. | Executive, Search, Export History, Discovery Events. | Visibility-only, immutable exports, no operational settings. |

## CISO

### Profile

The CISO is accountable for understanding enterprise AI adoption and potential exposure. They do not need implementation details during daily use, but they need confidence that the inventory is complete, timely, and exportable.

### Jobs To Be Done

- Establish a defensible inventory of AI agents and agentic systems.
- Identify unknown, ownerless, or newly discovered agents.
- Understand where AI agents intersect with sensitive enterprise surfaces.
- Track discovery coverage by business unit, cloud account, device fleet, and SaaS tenant.
- Communicate AI agent visibility posture to executives and board stakeholders.

### Questions They Ask

- How many AI agents exist today?
- Which areas have the highest concentration of agents?
- Which agents have unknown owners or low confidence?
- Which models, frameworks, cloud services, and SaaS platforms are most used?
- Where are our discovery blind spots?
- Can we export evidence for audit or executive reporting?

### Success Metrics

- Enterprise agent inventory coverage above target.
- Reduction in ownerless assets.
- Time-to-answer for executive questions under minutes.
- Audit-ready exports available on demand.
- Weekly trend visibility across newly discovered, active, dormant, and changed agents.

### Required Capabilities

- Executive KPI dashboard.
- Coverage maps.
- Trend charts.
- High-level topology.
- Search and export.
- Confidence and evidence indicators.
- Role-based access to sensitive details.

### Risks If Underserved

- CISO views Visentra as a niche developer tool instead of a strategic security system.
- Lack of coverage clarity undermines trust in inventory.
- Overemphasis on governance may create commitments the platform cannot meet in V1/V2.

## SecOps Analyst

### Profile

The SecOps Analyst uses Visentra to investigate newly discovered agents, understand relationships, assess evidence quality, and export findings. They are comfortable with dense tables, filters, timelines, and graph navigation.

### Jobs To Be Done

- Triage newly discovered or anomalous agents.
- Determine where an agent runs and who owns it.
- Inspect relationships to models, tools, MCP servers, identities, repositories, cloud resources, devices, and SaaS apps.
- Review discovery and visibility timelines.
- Build saved searches for operational monitoring.
- Export investigation evidence.

### Questions They Ask

- Why did Visentra classify this as an agent?
- What evidence was collected and when?
- Is this a duplicate or a distinct agent?
- Which identity is associated with this runtime?
- What tools or MCP servers can it access?
- What changed since the previous discovery run?

### Success Metrics

- Investigation path from alert/event to agent detail under two clicks.
- Evidence available for every important claim.
- Graph neighborhood loads quickly.
- Saved searches reduce repeated manual filtering.
- Exports include enough context for handoff.

### Required Capabilities

- Operations queue.
- Agent detail drawer/page.
- Relationship explorer.
- Timeline.
- Discovery events.
- Faceted search.
- Export of filtered results and selected evidence.

### Access Needs

- Read access across inventory.
- Evidence access for relevant sources.
- Export permission.
- No collector administration unless separately assigned.

## Platform Engineer

### Profile

The Platform Engineer deploys, configures, and maintains discovery coverage. They care about collector health, source configuration, version drift, backpressure, failure modes, and coverage gaps.

### Jobs To Be Done

- Roll out endpoint, cloud, SaaS, repository, browser, and container collectors.
- Verify data is flowing.
- Diagnose connector failures.
- Understand unsupported surfaces.
- Monitor collector versions and capabilities.
- Configure integration credentials securely.

### Questions They Ask

- Which collectors are online, stale, or failing?
- Which environments are uncovered?
- Which source credentials are expiring?
- Which connector versions are deployed?
- Are observations being rejected, delayed, or quarantined?
- What is the blast radius of a source outage?

### Success Metrics

- High collector health and source coverage.
- Low ingestion rejection rate.
- Fast identification of broken connectors.
- Predictable upgrades and rollback.
- Clear separation between source configuration and governance policy.

### Required Capabilities

- Discovery coverage dashboard.
- Collector fleet table.
- Connector setup guides.
- Health timeline.
- Data quality events.
- Integration settings.
- Source capability matrix.

### Access Needs

- Manage collectors and source configuration.
- View coverage and health.
- Limited access to sensitive asset evidence unless granted.

## AI Platform Engineer

### Profile

The AI Platform Engineer is responsible for enterprise AI platforms, model gateways, agent frameworks, MCP architecture, and developer enablement. They use Visentra to understand adoption and standardization.

### Jobs To Be Done

- Identify which frameworks, models, providers, tools, and MCP servers are used.
- Map agent adoption by team, repository, cloud, and runtime.
- Detect shadow AI platform usage.
- Support internal platform migration plans with evidence.
- Understand local LLM and self-hosted model usage.

### Questions They Ask

- Which teams use LangChain, LlamaIndex, CrewAI, AutoGen, Semantic Kernel, or custom frameworks?
- Which agents use approved model gateways versus direct provider APIs?
- Which MCP servers are common, custom, or unmanaged?
- Which repositories define agent logic?
- Which runtime platforms are growing fastest?

### Success Metrics

- Complete model/framework/MCP usage inventory.
- Accurate repository-to-agent relationships.
- Adoption trends that inform platform strategy.
- Exportable lists for enablement campaigns.

### Required Capabilities

- Framework usage analytics.
- Model usage analytics.
- MCP server inventory.
- Repository and ownership filters.
- Topology and relationship explorer.
- Saved views by team/platform.

### Access Needs

- Broad technical read.
- Ability to annotate ownership and tags where allowed.
- No enforcement capabilities.

## Developer

### Profile

The Developer may not be a daily Visentra user. They access it when asked to review assets tied to their identity, device, repository, IDE, or team. The experience must be direct and evidence-based.

### Jobs To Be Done

- Confirm whether a discovered agent is expected.
- Review evidence tied to their repository or device.
- Understand why ownership was inferred.
- Identify which AI tools and models their project uses.
- Provide metadata such as owner/team tags where permitted.

### Questions They Ask

- Why is this assigned to me?
- Which repo, package, or IDE config caused this detection?
- Is this my personal tool, project dependency, or deployed runtime?
- Can I export or share a link with my team?

### Success Metrics

- Low-friction scoped access.
- Clear evidence trails.
- Minimal security jargon.
- Ability to correct metadata without triggering remediation workflows.

### Required Capabilities

- Scoped inventory.
- Agent detail.
- Repository evidence.
- Ownership explanation.
- Shareable filtered links.

### Access Needs

- Read access to owned/team assets.
- Limited evidence access.
- Optional tag/owner metadata updates.

## Auditor / Compliance

### Profile

The Auditor or Compliance user consumes visibility evidence for reviews, control testing, and reporting. They require immutable, timestamped, exportable records and clear scope boundaries.

### Jobs To Be Done

- Review inventory snapshots.
- Confirm discovery coverage at a point in time.
- Export evidence for audits.
- Validate that agent assets have owners and source provenance.
- Review historical discovery events.

### Questions They Ask

- What was known at the audit date?
- Which sources contributed to the inventory?
- Which assets lacked owners?
- Can the inventory be exported with evidence and timestamps?
- Were any data sources unavailable during the period?

### Success Metrics

- Audit-ready export package generated quickly.
- Immutable export history.
- Clear field definitions and evidence provenance.
- No ability to change operational state.

### Required Capabilities

- Snapshot view.
- Export history.
- Discovery events.
- Read-only search.
- Field dictionary.
- Coverage evidence.

### Access Needs

- Visibility-only.
- Export permission if authorized.
- No collector settings, no admin configuration, no governance actions.

## Persona-Based Product Implications

| Product Area | Implication |
|---|---|
| Navigation | Support both executive dashboard entry and analyst search/inventory entry. |
| RBAC | Separate evidence read, export, source administration, and metadata editing. |
| UI Density | Provide high-density analyst views and summary executive cards. |
| Evidence | Every persona needs trust signals, but at different levels of detail. |
| Exports | Export is core, not secondary, especially for CISO, SecOps, and Auditor users. |
| Realtime | Most valuable for discovery runs, operations, and event streams. |
| Settings | Platform Engineer needs deep collector settings; other personas should not see irrelevant configuration. |

## Related Documents

- [04-user-journeys.md](./04-user-journeys.md)
- [06-navigation-structure.md](./06-navigation-structure.md)
- [07-ui-screens.md](./07-ui-screens.md)
- [19-security-and-access-control.md](./19-security-and-access-control.md)
