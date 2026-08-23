# Azure AI / Agent Discovery — RBAC & Configuration

Visentra Azure discovery authenticates with a **service principal**
(`tenantId`, `clientId`, `clientSecret`, `subscriptionId`) configured per connector.

All discovery APIs used are **read-only**. Do **not** grant Contributor, Owner,
write, or delete roles.

## Minimum RBAC (recommended)

Assign these built-in roles at subscription (or scoped resource-group) level:

| Capability | Built-in role | Why |
|---|---|---|
| ARM resource discovery | **Reader** | `GET /subscriptions/{id}/resources` and resource GETs |
| Cognitive / Foundry account + projects | **Cognitive Services Account Reader** (or Reader) | List accounts/projects via ARM |
| Foundry Agents / Assistants data plane | **Azure AI User** or **Cognitive Services OpenAI User** | `GET …/agents`, `GET …/assistants` (data plane) |
| Container Apps | **Reader** | App + revision metadata |
| App Service / Functions | **Reader** | Site metadata (no app setting secret values are fetched) |
| VMs | **Reader** | Instance view / power state |
| AKS cluster metadata | **Reader** | Cluster GET |
| AKS workload listing | **Azure Kubernetes Service Cluster User Role** | `listClusterUserCredential` + list Deployments |

### Notes

- Prefer **Reader** over Contributor/Owner.
- If a deep-discovery API returns 401/403, Visentra records
  `discoveryStatus: "permission_denied"` and **continues** scanning other resources.
- Data-plane Foundry calls use token audiences
  `https://ai.azure.com/.default` or `https://cognitiveservices.azure.com/.default`
  in addition to ARM `https://management.azure.com/.default`.

## Environment configuration (optional)

Connector credentials stay on the connector. Global env only tunes scan behavior:

| Variable | Default | Meaning |
|---|---|---|
| `AZURE_DISCOVERY_AI_ONLY` | inherits `DISCOVERY_AI_ONLY` (true) | Ingest AI-relevant resources only |
| `AZURE_DISCOVERY_MAX_RESOURCES` | `500` | Cap on selected ARM resources |
| `AZURE_DISCOVERY_AGENT_SCAN` | `true` | Call Foundry/Assistants agent APIs |
| `AZURE_DISCOVERY_RUNTIME_SCAN` | `true` | Deep-scan ACA / AKS / Functions / App Service / VMs |

## Discovery layers (evidence)

| Layer | Meaning | Example |
|---|---|---|
| Azure resource | ARM object exists | Storage account, VM, OpenAI account |
| AI resource | Classified AI platform / AI-hosting compute | `Microsoft.CognitiveServices/accounts` kind=OpenAI |
| Agent | Actual agent entity | Foundry Agents API hit, Bot Service bot, heuristic ACA workload |

> **Agent 365 / Copilot Studio published agents** are **not** on this Azure plane.
> Use the `m365_copilot` connector + Graph Copilot admin catalog — see `AGENT365_DISCOVERY.md`.
| Runtime | Deployed compute with status | Container App revision replicas, VM power state |
| Runtime status | Evidence-backed only | `running` / `stopped` / `failed` / `unknown` |

## Deep + adversarial alignment (AWS parity)

Confirmed Foundry / Assistants / Bot Service agents are stamped with:

| Field | Schema |
|---|---|
| `metadata.deep` | `azure-deep.v1` (`awsDeepCompatible: aws-deep.v2`) |
| `metadata.adversarial_surface` | `1.0.0` (shared `attachAdversarialSurface`) |
| `deepScanStatus` | `ok` when list/detail signals are aligned |

Assistants list payloads contribute tools + instruction preview/hash when present.
Bot Service ARM confirms the bot but often has empty tools (honest empty lists).

**Never inferred:** AI resource exists ≠ agent running; VM running ≠ agent running;
Container App running ≠ confirmed agent running.
