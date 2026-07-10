# 28. UI Wireframes

Wireframes for primary AgentRadar screens. Components map to [17-frontend-components.md](./17-frontend-components.md), APIs to [11-apis.md](./11-apis.md), and live updates to [13-visibility-engine.md](./13-visibility-engine.md).

## Global shell

```text
+--------------------------------------------------------------------------------+
| AgentRadar | Dashboard Agents Assets Graph Search Discovery Coverage Exports   |
|            | [Tenant: Acme Corp v] [Global search..............] [User menu]   |
+--------------------------------------------------------------------------------+
| Breadcrumbs: Home / Current Page                                                |
+--------------------------------------------------------------------------------+
| Page content                                                                    |
+--------------------------------------------------------------------------------+
| Toasts: discovery completed | export ready | connector warning                  |
+--------------------------------------------------------------------------------+
```

## Login

```text
+--------------------------------------+
| AgentRadar                           |
| Enterprise AI inventory visibility   |
|                                      |
| [ Sign in with SSO ]                 |
|                                      |
| Email    [____________________]      |
| Password [____________________]      |
| MFA code [______]                    |
| [ Sign in ]                          |
| Error / request ID                   |
+--------------------------------------+
```

## Overview dashboard

```text
+--------------------------------------------------------------------------------+
| Dashboard                                                       [Last 7 days v] |
+--------------------------------------------------------------------------------+
| [Total 438] [Active 391] [New 31] [Stale 18] [Coverage 82%]                    |
+--------------------------------------------------------------------------------+
| Model Usage                         | Framework Distribution                    |
| gpt-4.1       ######## 182          | LangChain       ######## 201              |
| claude        ######    97          | LlamaIndex      ####      84              |
| azure-openai  ####      73          | Custom          ###       60              |
+--------------------------------------------------------------------------------+
| Discovery Health                    | Recent Changes                            |
| K8s prod OK 2m ago                  | + agent contract-review-copilot           |
| GitHub OK 8m ago                    | ~ edge USES_MODEL updated                 |
| LLM API Warn 1h stale               | + mcp server filesystem-tools             |
+--------------------------------------------------------------------------------+
```

## Agent inventory

```text
+--------------------------------------------------------------------------------+
| Agents                                            [Export] [Add known agent]    |
+--------------------------------------------------------------------------------+
| Filters: Owner[v] Model[v] Framework[v] Cloud[v] Repo[v] Risk[v]               |
|          Tool[v] Language[v] Department[v] Project[v] BU[v] [Reset]            |
+--------------------------------------------------------------------------------+
| Name                       Owner        Model       Runtime    Conf Risk         |
| contract-review-copilot    Platform AI  gpt-4.1     k8s/prod   94%  High         |
| invoice-triage-agent       Finance AI   gpt-4.1     k8s/prod   91%  High         |
| support-router             CX AI        claude      process    78%  Medium       |
+--------------------------------------------------------------------------------+
| < Previous                                                       Next >          |
+--------------------------------------------------------------------------------+
```

## Agent detail

```text
+--------------------------------------------------------------------------------+
| contract-review-copilot                         [Graph] [Export] [Edit]         |
| LangChain | Python | Active | Confidence 94% | Last seen 4m                    |
| Owner: Platform AI | Department: Legal Technology | BU: Corporate              |
+--------------------------------------------------------------------------------+
| Summary: Assists legal operations with contract clause review.                  |
+--------------------------------------------------------------------------------+
| Runtime                                | Repository                              |
| Kubernetes prod-use1/legal-ai          | acme/legal-ai-services                  |
| deployment/contract-review             | services/contract-review                |
+--------------------------------------------------------------------------------+
| Models                                 | Tools / MCP                             |
| gpt-4.1 conf 91% evidence 4            | jira_create_issue conf 88%              |
| text-embedding conf 84%                | MCP filesystem-tools conf 86%           |
+--------------------------------------------------------------------------------+
| Data/API Dependencies                  | Mini Graph                              |
| s3 legal-contracts READS_FROM          | Agent -> Model -> Tool -> MCP           |
| postgres legal_ops READS_FROM          | Agent -> DB -> API                      |
+--------------------------------------------------------------------------------+
| Tabs: Observations | Timeline | Relationships | Raw JSON                         |
+--------------------------------------------------------------------------------+
```

## Asset inventory/detail

```text
+--------------------------------------------------------------------------------+
| Assets                                                                          |
| Tabs: All Models Tools MCP Repositories Cloud DBs APIs                          |
+--------------------------------------------------------------------------------+
| Type        Name                       Provider     Used by  Last seen          |
| Model       gpt-4.1                    OpenAI       43       5m                 |
| MCP Server  filesystem-tools           internal     12       7m                 |
| Repo        acme/legal-ai-services     GitHub       4        12m                |
+--------------------------------------------------------------------------------+
```

```text
+--------------------------------------------------------------------------------+
| Asset: gpt-4.1                                           [Open in graph]        |
| Type: Model | Provider: OpenAI | Deployment: vendor_api | Last seen 5m          |
+--------------------------------------------------------------------------------+
| Metadata                              | Usage Summary                            |
| Canonical ID mdl_openai_gpt_4_1       | Agents using 43                          |
| Client libs openai-python/langchain   | High-confidence edges 39                 |
+--------------------------------------------------------------------------------+
| Used by Agents: contract-review-copilot, invoice-triage-agent, support-router   |
+--------------------------------------------------------------------------------+
```

## Graph explorer

```text
+--------------------------------------------------------------------------------+
| Graph Explorer                                                                  |
| Seed [contract-review-copilot________] [Expand] Depth[2] Conf[70%]              |
+--------------------------------------------------------------------------------+
| +------------------------------------------------------+ +--------------------+ |
| | Developer -> IDE -> Repo -> Agent                    | | Inspector          | |
| |                         |-> Model                    | | Selected: Agent    | |
| |                         |-> Tool -> MCP Server       | | Confidence: 94%    | |
| |                         |-> DB -> Cloud -> API -> Ext| | [Open] [Expand]    | |
| +------------------------------------------------------+ +--------------------+ |
+--------------------------------------------------------------------------------+
| Legend: Developer IDE Repo Agent Model Tool MCP DB Cloud API External           |
+--------------------------------------------------------------------------------+
```

## Search

```text
+--------------------------------------------------------------------------------+
| Search [ invoice extraction________________________________________ ] [Search]  |
+--------------------------------------------------------------------------------+
| Facets                               | Results                                  |
| Owner: [x] finance-ai (18)           | 1. invoice-triage-agent        Agent     |
| Model: [x] gpt-4.1 (22)              |    Workflow agent for invoice extraction |
| Framework: langchain (19)            |    finance-ai | gpt-4.1 | high          |
| Cloud: aws (31)                      | 2. acme/finance-automation     Repo      |
| Risk: [x] high (9)                   | 3. invoice_triage_system_prompt Prompt   |
| More: repo tool prompt language dept hostname project BU                        |
+--------------------------------------------------------------------------------+
```

## Discovery and job detail

```text
+--------------------------------------------------------------------------------+
| Discovery                                                     [Run scan]        |
+--------------------------------------------------------------------------------+
| Connectors: [AWS prod OK] [K8s prod OK] [GitHub OK] [LLM API Warn]              |
+--------------------------------------------------------------------------------+
| Recent Jobs                                                                     |
| prod k8s and cloud scan | Running | 62% | 1,820 observations                    |
| github delta            | Complete|100% | 244 observations                      |
+--------------------------------------------------------------------------------+
```

```text
+--------------------------------------------------------------------------------+
| Job: prod k8s and cloud scan                         Running 62% [Cancel]       |
| Scope: conn_aws_prod, conn_k8s_prod | Started 11:09 UTC                        |
+--------------------------------------------------------------------------------+
| [############----------------] 62%                                               |
| Observations 1,820 | Entities created 71 | Edges created 388                    |
+--------------------------------------------------------------------------------+
| Timeline: job started -> k8s emitted -> aws throttled -> graph updated           |
| Tasks: collector | partition | status | retry | cursor | last event             |
+--------------------------------------------------------------------------------+
```

## Coverage map

```text
+--------------------------------------------------------------------------------+
| Coverage: Overall 82% | Runtime 91% | Source 74% | LLM 68% | MCP 55%           |
+--------------------------------------------------------------------------------+
| Tenant Acme                                                                     |
| ├─ Finance BU 88% #########-                                                    |
| │  ├─ AWS prod 93% #########-                                                    |
| │  └─ GitHub repos 81% ########--                                                |
| └─ Legal BU 79% ########--                                                       |
|    ├─ K8s prod 96% ##########                                                    |
|    └─ MCP configs 44% ####------                                                 |
+--------------------------------------------------------------------------------+
| Gaps: permission_denied AWS us-west-2 11 | stale_cursor GitHub archive 4         |
+--------------------------------------------------------------------------------+
```

## Relationship and activity dashboards

```text
+--------------------------------------------------------------------------------+
| Activity Dashboard [Last 24h]                                                   |
| New entities sparkline | Stale entities | Recent discovery jobs | Edge changes   |
+--------------------------------------------------------------------------------+
```

```text
+--------------------------------------------------------------------------------+
| Relationship Dashboard [Last 30d]                                               |
| Top connected agents | External connectivity | MCP usage | Data dependencies    |
+--------------------------------------------------------------------------------+
```

## Exports and settings

```text
+--------------------------------------------------------------------------------+
| Exports                                                     [Create export]     |
| monthly-agent-inventory | agents | parquet | complete | expires 3d             |
| graph-legal-ai          | graph  | json    | running  | -                      |
+--------------------------------------------------------------------------------+
```

```text
+--------------------------------------------------------------------------------+
| Settings                                                                        |
| Users/Roles | Tenants | Authentication | API Tokens | Connectors              |
| User table, role matrix, SSO settings, token list, connector credentials status |
+--------------------------------------------------------------------------------+
```

## Responsive behavior

| Screen | Narrow viewport |
|---|---|
| Dashboard | Cards stack; charts full-width. |
| Agents/Search | Facets move to drawer; table becomes cards. |
| Agent detail | Panels stack; mini graph moves below dependencies. |
| Graph | Inspector becomes bottom drawer. |
| Discovery job | Task table becomes grouped cards. |

## Empty/error states

| State | Behavior |
|---|---|
| No agents | Explain connector setup and offer run scan. |
| No search results | Show active filters, clear action, suggestions. |
| Unauthorized | Show access message with tenant/user context. |
| SSE disconnected | Show subtle banner and polling fallback. |
| Export expired | Offer recreate with same filters. |
