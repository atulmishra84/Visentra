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

| Plane | What it finds | Default | Required permission |
|---|---|---|---|
| ARM | Foundry agents, Assistants, Bot Service, AI resources, compute heuristics | on | Azure Reader / Cognitive roles |
| Entra Agent ID | Graph `GET /servicePrincipals/microsoft.graph.agentIdentity` | `ENTRA_AGENT_ID_SCAN=true` | **`AgentIdentity.Read.All`** (preferred) or Application.Read.All |
| Power Platform | Copilot Studio agents as Dataverse `bot` records | `POWER_PLATFORM_SCAN=true` | Power Platform management app + Dataverse app user |
| Teams catalog | Org Teams apps with bots (confirmed) or agent heuristics (candidate) | `TEAMS_CATALOG_SCAN=true` | `TeamsApp.Read.All` |
| Agent 365 catalog | Graph Copilot admin catalog packages | `AZURE_AGENT365_CATALOG_SCAN=true` | **`CopilotPackages.Read.All`** + Agent 365 license |
| M365 Agent Registry | Defender XDR Advanced Hunting | off / not implemented | Defender XDR |

### Why Entra shows agents but Visentra shows none

Those Entra **"Agent identities"** rows (e.g. `a365ct-…-AgentIdentity`) are **not ARM resources**. They only appear after Graph allows:

`GET /servicePrincipals/microsoft.graph.agentIdentity`

1. On the **same app registration used by the Azure connector** (e.g. AgentRadar-SSO):
   - Add application permission **`AgentIdentity.Read.All`**
   - Optionally **`CopilotPackages.Read.All`** for Agent 365 catalog packages
   - Click **Grant admin consent**
2. Deploy code that includes Entra Agent ID ecosystem scanning (#55+)
3. **Test** the Azure connector — capabilities must show `entraAgentIdDiscovery: true`
4. Re-run **Scan cloud**
5. Inventory → **All** or **Cloud** (Cloud includes `cloud_provider=azure` rows such as Entra Agent ID / Copilot Studio, not only `category=cloud`). Look for names ending in `AgentIdentity` / provider `entra_agent_id`
6. If still empty, open the discovery event and check `ecosystem.entraAgentIdentities`, `warning`, `statsByCollector.entraAgentId.attempts`, and `discoveryErrorSamples`

### “I already added the permissions” but probes are still false

Connector Test issues a **client-credentials** Graph token for the connector’s `clientId`. Flags stay `false` until that token’s `roles` claim includes the app permissions **and** Graph returns HTTP 2xx.

Typical causes (permission row exists in the portal but probe still fails):

1. **Admin consent not granted** — API permissions list the role, but Status is not a green “Granted for &lt;tenant&gt;”. Click **Grant admin consent**.
2. **Delegated instead of Application** — Visentra uses app-only auth; Delegated `AgentIdentity.Read.All` does **not** appear in the token `roles`.
3. **Wrong app registration** — permissions were added on a different app than the connector `clientId`. Test message now includes `GraphProbe.clientId` / `tokenAppId` / `tokenRoles` so you can compare.
4. **Consent on a different tenant** than the connector `tenantId`.
5. For Agent 365 only: permission OK but tenant has **no Agent 365 license** → catalog probe can still be 403/404.

After fixing consent, wait 1–2 minutes, **Test** again, and confirm `tokenRoles` contains `AgentIdentity.Read.All` (and `CopilotPackages.Read.All` if needed).

Legacy Copilot Studio apps that are plain Application service principals (not Agent ID) appear in some Entra lists but need **Power Platform** Dataverse discovery, not Entra Agent ID.

### Copilot Studio setup

1. Register the connector app as a Power Platform management app: `New-PowerAppManagementApp -ApplicationId <clientId>`
2. Add the app’s service principal as an **Application User** with a security role in each Dataverse environment to scan
3. Graph permissions for Entra Agent ID / Teams / Agent 365 as in the table above

> You can still use a dedicated `m365_copilot` SaaS connector for Agent 365; the Azure ecosystem now also calls the same Graph catalog when `CopilotPackages.Read.All` is on the Azure app.

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
