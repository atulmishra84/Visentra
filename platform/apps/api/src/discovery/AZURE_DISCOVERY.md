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

## Discovery planes (ecosystem scanner)

Live Azure connector scans call **`discoverAzureEcosystem`** (not ARM-only):

| Plane | What it finds | Default |
|---|---|---|
| ARM | Foundry agents, Assistants, Bot Service, AI resources, compute heuristics | on |
| Entra Agent ID | Graph `ServiceIdentity` principals (Copilot Studio / Agent 365 identities) | `ENTRA_AGENT_ID_SCAN=true` |
| Power Platform | Copilot Studio agents as Dataverse `bot` records | `POWER_PLATFORM_SCAN=true` |
| Teams catalog | Org Teams apps with bots (confirmed) or agent heuristics (candidate) | `TEAMS_CATALOG_SCAN=true` |
| M365 Agent Registry | Defender XDR Advanced Hunting | off / not implemented |

### Copilot Studio setup

1. Register the connector app as a Power Platform management app: `New-PowerAppManagementApp -ApplicationId <clientId>`
2. Add the app’s service principal as an **Application User** with a security role in each Dataverse environment to scan
3. Graph permissions for Entra Agent ID / Teams: application read on service principals / Teams app catalog (admin consent)

> Published **Agent 365 catalog** packages are still best covered by the `m365_copilot` connector (Graph Copilot admin catalog). Entra Agent ID + Power Platform catch Studio/identity planes the subscription ARM scan cannot see.

## Discovery layers (evidence)

| Layer | Meaning | Example |
|---|---|---|
| Azure resource | ARM object exists | Storage account, VM, OpenAI account |
| AI resource | Classified AI platform / AI-hosting compute | `Microsoft.CognitiveServices/accounts` kind=OpenAI |
| Agent | Actual agent entity | Foundry Agents API, Bot Service, Copilot Studio Dataverse bot, Entra Agent ID |
| Runtime | Deployed compute with status | Container App revision replicas, VM power state |
| Runtime status | Evidence-backed only | `running` / `stopped` / `failed` / `unknown` |

## Deep + adversarial alignment (AWS parity)

Confirmed Foundry / Assistants / Bot Service / Copilot Studio / Entra Agent ID / Teams bots are stamped with:

| Field | Schema |
|---|---|
| `metadata.deep` | `azure-deep.v1` / `copilot-studio-deep.v1` / … (`awsDeepCompatible: aws-deep.v2`) |
| `metadata.adversarial_surface` | `1.0.0` (shared `attachAdversarialSurface`) |
| `deepScanStatus` | `ok` when list/detail signals are aligned |

Assistants list payloads contribute tools + instruction preview/hash when present.
Bot Service / Copilot Studio Dataverse lists confirm the agent; tool schemas may be empty until deeper APIs are expanded.

**Never inferred:** AI resource exists ≠ agent running; VM running ≠ agent running;
Container App running ≠ confirmed agent running.
