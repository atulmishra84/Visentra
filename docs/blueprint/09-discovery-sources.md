# 09 - Discovery Sources

## Overview

Visentra discovery sources provide evidence that AI agents exist, where they run, who owns them, and which models, tools, MCP servers, repositories, clouds, devices, SaaS tenants, and identities they connect to. A source can be high-confidence, such as a SaaS admin API explicitly listing an agent, or low-confidence, such as a package dependency that suggests an agent framework.

Discovery must be additive and evidence-backed. No source should directly overwrite canonical truth without passing through normalization and identity resolution.

## Source Categories

| Category | Source Examples | Evidence Strength |
|---|---|---|
| IDE | Cursor, VS Code, JetBrains, Visual Studio, Neovim. | Medium to high when configs/extensions identify agents. |
| Local | Processes, CLIs, package managers, schedulers, user config. | Low to high depending on process/config evidence. |
| Framework | LangChain, LlamaIndex, CrewAI, AutoGen, Semantic Kernel, Mastra. | Medium to high when code/config identifies agent definitions. |
| Cloud | AWS, Azure, GCP, managed AI services, serverless, VMs. | Medium to high for deployed runtimes and identities. |
| Containers | Kubernetes, ECS, Docker, registries, CI runners. | Medium to high for workload/image evidence. |
| SaaS | ITSM, CRM, productivity, support, analytics, AI SaaS. | High when admin API exposes agent objects. |
| MCP | Client configs, server manifests, tool schemas, transports. | High for server/tool relationships. |
| Local LLM | Ollama, LM Studio, llama.cpp, vLLM, TGI, model caches. | Medium to high for local model usage. |
| Browser | Chrome/Edge/Firefox extensions, enterprise policies. | Medium when permissions/vendor identify agentic behavior. |
| Autonomous | Cron, CI, workflow engines, queues, notebooks, workers. | Medium when schedule plus model/tool evidence exists. |

## Source Evidence Contract

Every source observation should include:

- Source type and source ID.
- Collector or connector version.
- Observation timestamp.
- Source-native object ID where available.
- Source-native object type.
- Evidence fields.
- Confidence seed.
- Sensitivity classification.
- Redaction/hash status.
- Idempotency key.

## IDE Discovery

### Signals

- Installed AI extensions.
- IDE settings.
- Workspace metadata.
- MCP client configuration.
- AI assistant enablement.
- Extension marketplace IDs.
- Workspace repository mapping.

### Expected Relationships

- Agent `OBSERVED_IN` IDE.
- Agent `DEFINED_IN_REPO` Repository.
- Agent `CONNECTS_TO_MCP_SERVER` MCP Server.
- Agent `RUNS_ON` Device.
- Agent `OWNED_BY` Identity when workspace/device owner is known.

## Local Discovery

### Signals

- Running process metadata.
- CLI binaries and package installs.
- Local config files.
- User-level service definitions.
- Shell completion/package indicators.
- Local task schedulers.

### Privacy Defaults

- Do not collect command-line secrets.
- Hash local paths unless customer config allows path collection.
- Capture binary/package names and safe fingerprints.

## Framework Discovery

### Signals

- Dependency manifests and lockfiles.
- Imports and package names.
- Framework config files.
- Agent class declarations.
- Tool declarations.
- Model provider configuration.

### Framework Taxonomy

The taxonomy should support at minimum:

- LangChain.
- LlamaIndex.
- CrewAI.
- AutoGen.
- Semantic Kernel.
- OpenAI Agents SDK.
- Mastra.
- Haystack.
- Custom/internal frameworks.

## Cloud Discovery

### Signals

- Cloud asset inventory.
- IAM roles and workload identities.
- Managed AI service metadata.
- Serverless functions.
- Container services.
- VM/user data metadata.
- Tags and deployment metadata.

### Expected Relationships

- Agent `RUNS_ON` Cloud Resource.
- Cloud Resource `BELONGS_TO_ACCOUNT` Cloud Account.
- Agent `EXECUTES_AS` Identity.
- Agent `USES_MODEL` Model for managed AI endpoints when inferable.

## Container Discovery

### Signals

- Pod/deployment/task specs.
- Container images and digests.
- Labels and annotations.
- Entrypoint/command fingerprints.
- SBOM/package indicators.
- Environment variable names with sensitive values redacted.

### Expected Relationships

- Agent Instance `RUNS_IN` Container Workload.
- Container Workload `RUNS_ON` Cloud Resource or cluster.
- Agent `DEFINED_IN_REPO` Repository when image provenance exists.

## SaaS Discovery

### Signals

- Admin APIs.
- Installed apps/integrations.
- AI feature settings.
- Tenant audit metadata.
- Bot/user objects.
- Workspace-level agent configuration.

### Expected Relationships

- Agent `OBSERVED_IN` SaaS App.
- Agent `OWNED_BY` Identity or SaaS admin/team.
- Agent `USES_TOOL` SaaS-native tools when exposed.

## MCP Discovery

### Signals

- MCP client configuration.
- MCP server manifests.
- Server transport.
- Tool schemas.
- Resource declarations.
- Auth mode.
- Config locations.

### Expected Relationships

- Agent `CONNECTS_TO_MCP_SERVER` MCP Server.
- MCP Server `EXPOSES_TOOL` Tool.
- Agent `USES_TOOL` Tool.
- MCP Server `RUNS_ON` Device/Cloud/Container when runtime is known.

## Browser Discovery

### Signals

- Extension ID, name, version.
- Permissions and host permissions.
- Enterprise policy.
- AI vendor classification.
- Native messaging permission.
- Extension-to-device/user mapping.

## Autonomous Discovery

### Signals

- Cron or scheduler entries.
- CI workflow definitions.
- Queue worker configuration.
- Notebook scheduled jobs.
- Long-running loops.
- Model/tool/framework evidence.

## Source Confidence

| Evidence Pattern | Confidence Guidance |
|---|---|
| Explicit "agent" object from SaaS/cloud API | High. |
| MCP server configured in IDE assistant | High relationship confidence. |
| Framework dependency plus agent class definition | High. |
| Framework dependency only | Low to medium. |
| Process name only | Low. |
| Browser AI extension with broad permissions | Medium. |
| Local LLM runtime plus agent process | Medium-high. |

## Related Documents

- [01-product-vision.md](./01-product-vision.md)
- [10-collector-architecture.md](./10-collector-architecture.md)
- [11-normalization-pipeline.md](./11-normalization-pipeline.md)
