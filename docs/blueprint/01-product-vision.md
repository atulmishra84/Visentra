# 01 - Product Vision

## Executive Summary

AgentRadar is the world's first **Enterprise AI Agent Discovery & Visibility Platform**. It gives enterprises a live inventory of AI agents, agentic developer tools, model-connected automations, AI runtime services, and the relationships that connect them to people, devices, repositories, cloud infrastructure, SaaS applications, data stores, MCP servers, tools, and models.

The market is moving faster than enterprise visibility. Developers install coding agents in IDEs, teams adopt SaaS assistants, platforms launch autonomous workflow agents, cloud teams deploy model-backed services, and security teams inherit an expanding surface they cannot see. AgentRadar exists to close that visibility gap.

The product positioning:

- **CrowdStrike for AI Agents**: enterprise-wide visibility into agent presence — **agentless first**, with optional **EDR integrations** for endpoint evidence (no AgentRadar client required on laptops).
- **Wiz for AI**: cloud, identity, repository, model, framework, and topology intelligence across the AI attack surface.
- **Datadog for AI Runtime**: timelines, events, activity streams, usage views, and operational visibility for agentic systems.
- **ServiceNow CMDB for AI Assets**: authoritative asset inventory and relationship map for AI agents and AI-adjacent infrastructure.

## Discovery posture (locked)

**AgentRadar is an agentless platform.**

| Principle | Meaning |
|-----------|---------|
| No proprietary endpoint agent required | Customers do **not** deploy an AgentRadar client/daemon on developer machines for core discovery. |
| Agentless by default | Cloud APIs, Kubernetes APIs, SaaS APIs, CI/CD, git, logs, and identity integrations drive inventory. |
| Endpoint coverage via EDR | When laptop/IDE/process visibility is needed, AgentRadar **pulls from existing EDR / endpoint management** (e.g. CrowdStrike, Microsoft Defender/Intune, Cortex XDR) rather than installing its own agent. |
| Optional future sensors | Any future lightweight sensor is non-default and never a prerequisite for cloud/SaaS discovery. |

AgentRadar is not an agent governance product in V1/V2. It does not approve, block, remediate, quarantine, or enforce policy against agents. It discovers, normalizes, correlates, maps, searches, exports, and visualizes.

## Market Problem

Enterprise AI adoption is happening through dozens of unsynchronized channels:

1. Developers add coding assistants and local agents to IDEs.
2. Engineering teams test frameworks such as LangChain, LlamaIndex, AutoGen, CrewAI, Semantic Kernel, Mastra, OpenAI Agents SDK, and custom orchestration layers.
3. Cloud teams deploy AI workloads in Kubernetes, serverless, VM, managed AI, and data platform environments.
4. Business teams use SaaS agents inside productivity, CRM, ITSM, customer support, and analytics products.
5. Users install browser extensions that invoke LLMs and execute actions.
6. Teams wire MCP servers into local assistants, IDEs, SaaS clients, and internal tools.
7. Local LLM runtimes appear on laptops, workstations, build machines, and lab servers.
8. Autonomous agents run unattended in CI, job schedulers, notebooks, workflow systems, and cloud containers.

Existing security and operations stacks see fragments of this activity, but no system provides a unified agent inventory with graph relationships and enterprise search.

## Product Thesis

The enterprise needs an **AI agent asset intelligence layer** before it can safely operate, optimize, or govern AI agents. Discovery and visibility are prerequisites for every later workflow.

AgentRadar should become the system of record for:

- Which agents exist.
- Where they run.
- Who owns or uses them.
- Which models they call.
- Which tools and MCP servers they invoke.
- Which identities they use.
- Which repositories, devices, cloud accounts, containers, and SaaS tenants they touch.
- How these relationships change over time.
- Which environments are covered by discovery and which are blind spots.

## Product Phases

### V1: Discovery

V1 delivers the asset inventory layer. It discovers agentic artifacts across enterprise surfaces, normalizes them into a canonical object model, resolves identities, scores confidence, builds relationships, and exposes search, inventory, topology, and export experiences.

V1 answers:

- What AI agents are present?
- What evidence proves their existence?
- Which discovery source found them?
- Where do they run?
- Which owner, team, identity, repository, cloud account, IDE, model, tools, and MCP servers are associated?
- How fresh is the evidence?
- What coverage gaps remain?

V1 does not require runtime event collection from every agent. It can infer and inventory from static, configuration, metadata, process, package, repository, cloud, SaaS, and endpoint signals.

### V2: Visibility

V2 deepens from inventory to time-based visibility. It adds richer telemetry, event timelines, relationship change history, activity streams, usage trends, runtime state, and investigation views.

V2 answers:

- What did the agent do over time?
- Which tools, models, MCP servers, and identities were used during an activity window?
- Which relationships changed?
- Which runtime paths explain usage, cost, volume, or exposure?
- Which agents are newly observed, dormant, modified, or rapidly expanding?

V2 remains visibility-oriented. It still avoids governance and remediation commitments.

### Later: Governance and Remediation

Later roadmap phases may include policy, approval, remediation, agent allowlisting, response workflows, or enforcement integrations. These are explicitly out of current scope. See [30-roadmap.md](./30-roadmap.md).

## Discovery Categories

AgentRadar must support all major AI agent discovery categories. Each category contributes different evidence and confidence.

| Category | Definition | Example Signals | Primary Buyers |
|---|---|---|---|
| IDE | Agents and assistants embedded in developer editors and coding environments. | Extensions, settings, plugin manifests, config files, IDE process metadata, workspace usage. | Platform Engineering, AppSec, CISO. |
| Local | Local agent processes, CLIs, background daemons, scripts, and user-space tools. | Process names, binaries, shell history indicators, package installs, local configs, task schedulers. | SecOps, Platform Engineering. |
| Framework | Agent frameworks and orchestration libraries in codebases and deployed apps. | Dependencies, imports, lockfiles, framework config, code patterns, runtime metadata. | AI Platform Engineering, Developers. |
| Cloud | Agent workloads, model endpoints, functions, notebooks, AI services, cloud identities, and managed AI integrations. | Cloud asset APIs, tags, IAM roles, container definitions, serverless handlers, managed service metadata. | Cloud Security, AI Platform Engineering. |
| Containers | Agent runtimes in Kubernetes, ECS, Docker, CI runners, and image registries. | Images, labels, env vars, commands, SBOMs, pod specs, container logs metadata. | Platform Engineering, SecOps. |
| SaaS | AI agents and assistants in third-party SaaS platforms. | SaaS app APIs, admin exports, integration configs, app marketplace installs, audit metadata. | CISO, IT, Compliance. |
| MCP | Model Context Protocol servers, clients, tools, resources, and transport configurations. | MCP config files, server manifests, tool schemas, endpoint URLs, auth modes, IDE/SaaS client connections. | AI Platform Engineering, AppSec. |
| Local LLM | On-device and self-hosted model runtimes used by agents. | Ollama, LM Studio, llama.cpp, vLLM, TGI, local model caches, inference ports, model manifests. | SecOps, AI Platform Engineering. |
| Browser | Agentic browser extensions, sidebars, automation plugins, and web-based AI clients. | Extension inventories, browser policies, extension permissions, host access, local storage metadata. | SecOps, IT, CISO. |
| Autonomous | Scheduled, unattended, or self-directed agents running jobs, workflows, and task loops. | Cron, CI workflows, queues, long-running workers, task frameworks, autonomy indicators, execution schedules. | CISO, SecOps, Platform Engineering. |

## Product Promise

AgentRadar promises an enterprise team can answer, within minutes:

1. "Show me every AI agent in our environment."
2. "Show me which agents use Anthropic, OpenAI, Bedrock, Gemini, local models, or internal endpoints."
3. "Show me which agents connect to MCP servers and what tools those servers expose."
4. "Show me which agents are running on executive laptops, developer workstations, Kubernetes clusters, and SaaS tenants."
5. "Show me newly discovered agents since last week."
6. "Show me which environments are not covered by discovery."
7. "Export the inventory for audit, CMDB reconciliation, or security review."

## Non-Goals

The following are not V1/V2 goals:

- Blocking agent execution.
- Disabling IDE extensions.
- Revoking cloud permissions.
- Quarantining devices or containers.
- Enforcing policy-as-code.
- Running approval workflows.
- Creating tickets automatically as remediation.
- Rewriting agent prompts.
- Inspecting private prompt contents by default.
- Capturing sensitive model inputs/outputs unless explicitly configured for a later product area.
- Providing a governance risk score that implies enforcement obligations.

## Strategic Differentiators

### Breadth of Discovery

AgentRadar spans endpoint, IDE, repository, cloud, container, SaaS, browser, MCP, and local runtime sources. Competitors may cover one slice; AgentRadar unifies them.

### Evidence-Backed Inventory

Every object has source evidence, first seen, last seen, confidence, and provenance. Users can drill from an agent to the observations that created it.

### Graph-Native Visibility

Agent relationships are first-class. Users can navigate from an agent to identities, repositories, tools, models, MCP servers, cloud accounts, devices, containers, and SaaS apps.

### Enterprise Search and Export

Security and platform teams need queryable, exportable inventories. AgentRadar makes AI agent assets searchable by owner, model, tool, runtime, cloud, repository, tag, status, and confidence.

### Product Boundary Clarity

Discovery and visibility are clear and valuable without governance. This prevents overreach, simplifies implementation, and accelerates adoption.

## Customer Outcomes

| Outcome | V1 Capability | V2 Enhancement |
|---|---|---|
| Establish AI agent inventory | Multi-source discovery and normalized asset model. | Time-aware lifecycle and drift analysis. |
| Identify unmanaged agents | Coverage gaps, unknown ownership, low-confidence assets. | New/dormant/reactivated agent timelines. |
| Understand model usage | Model relationships and provider usage inventory. | Usage charts and activity trends. |
| Map AI attack surface | Graph relationships across identity, cloud, tools, and repos. | Runtime paths and relationship changes over time. |
| Support audits | Exportable inventory, evidence, timestamps, and source metadata. | Historical snapshots and timeline evidence. |
| Improve platform planning | Framework, IDE, cloud, and SaaS usage analytics. | Adoption trends and operational telemetry. |

## Primary Product Metrics

### Discovery Metrics

- Number of discovered agents.
- Percentage of agents with owner resolved.
- Percentage of agents with model relationship resolved.
- Percentage of agents with runtime location resolved.
- Discovery source coverage by environment.
- Mean time from source observation to inventory availability.
- Deduplication precision and false merge rate.
- Confidence distribution across discovered assets.

### Visibility Metrics

- Event ingestion latency.
- Timeline completeness by source.
- Relationship change detection latency.
- Active vs dormant agent counts.
- Tool/model usage trend coverage.
- Topology query latency.

### Adoption Metrics

- Weekly active investigators.
- Saved searches created.
- Exports generated.
- Topology map sessions.
- Inventory drill-down depth.
- Coverage gap workflows completed.

## Competitive Frame

AgentRadar should feel familiar to enterprise buyers:

- Like CrowdStrike, it should make previously invisible endpoint/runtime activity visible.
- Like Wiz, it should make cloud and identity relationships explorable.
- Like Datadog, it should make time-series activity and operational signals easy to inspect.
- Like ServiceNow CMDB, it should become a trusted asset registry.

The product should not imitate consumer AI dashboards. It should present as a serious enterprise command center with fast search, dense tables, strong filters, evidence trails, export, RBAC, and operational reliability.

## Narrative for Stakeholders

> "AI agents are already inside your enterprise. They are in IDEs, laptops, SaaS apps, browser extensions, cloud accounts, containers, repositories, and automation platforms. AgentRadar gives you the first complete map: every agent, every relationship, every owner, every runtime, and every blind spot. Before you govern AI agents, you need to see them."

## Related Documents

- [02-product-architecture.md](./02-product-architecture.md)
- [05-information-architecture.md](./05-information-architecture.md)
- [09-discovery-sources.md](./09-discovery-sources.md)
- [30-roadmap.md](./30-roadmap.md)
