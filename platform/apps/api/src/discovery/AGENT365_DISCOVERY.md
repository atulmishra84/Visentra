# Agent 365 / Copilot Studio catalog discovery

Agents created or published with **Microsoft Agent 365** (including Copilot Studio
agents published into the Agent 365 catalog) are **not** Azure ARM / Foundry
resources. The Azure connector cannot see them.

Visentra inventories them through the **Microsoft 365 Copilot / Agent 365** SaaS
connector (`m365_copilot`) via Microsoft Graph.

## API

| Operation | Endpoint |
|---|---|
| List packages (agents) | `GET /v1.0/copilot/admin/catalog/packages` (fallback: `/beta/...`) |
| Package detail (deep) | `GET /v1.0/copilot/admin/catalog/packages/{id}` (fallback: `/beta/...`) |
| Agent filter (MS docs) | `$filter=supportedHosts/any(h:h eq 'Copilot')` |

Official docs: [List Copilot packages](https://learn.microsoft.com/en-us/microsoft-365/copilot/extensibility/api/admin-settings/package/copilotpackages-list),
[Get Copilot package](https://learn.microsoft.com/en-us/microsoft-365/copilot/extensibility/api/admin-settings/package/copilotpackage-get),
and [Agent 365 Graph API](https://learn.microsoft.com/en-us/microsoft-agent-365/admin/graph-api).

## Required permissions / license

| Requirement | Why |
|---|---|
| Entra app + client secret on the `m365_copilot` connector | Same pattern as existing Graph discovery |
| Application permission **`CopilotPackages.Read.All`** (admin consent) | Catalog list **and** package detail (deep) |
| AI Administrator or Global Administrator context (tenant feature) | Admin catalog APIs |
| **Microsoft Agent 365** license in the tenant | Microsoft requires this for the Package Management API |

Without these, Graph returns `403` and Visentra records
`discoveryStatus: "permission_denied"` / `deepScanStatus: "permission_denied"` with a clear hint.
Secondary heuristics (service principals / Teams apps by name) may still find some
Copilot-related apps but **will miss most Agent 365 catalog agents** and never get deep profiles.

## Env toggles

| Variable | Default | Meaning |
|---|---|---|
| `M365_AGENT365_CATALOG_SCAN` | `true` | Call Copilot admin catalog packages |
| `M365_AGENT365_PACKAGE_LIMIT` | `200` | Cap catalog packages ingested |
| `M365_AGENT365_DEEP_SCAN` | always on | Package detail enrichment (tools / ACL / adversarial) |
| `M365_AGENT365_DEEP_SCAN_ALLOW_OFF` | `false` | Break-glass: allow setting deep scan off |
| `M365_AGENT365_DEEP_LIMIT` | `40` | Cap package detail calls per discovery run |

Deep scan is **always on** unless `M365_AGENT365_DEEP_SCAN_ALLOW_OFF=true` **and**
`M365_AGENT365_DEEP_SCAN=false` (same product stance as AWS).

## What gets confirmed as an agent

A catalog package is treated as an agent when **any** of:

- `supportedHosts` includes `Copilot` or `M365`
- `elementTypes` includes Bot / DeclarativeAgent / CustomEngineAgent
- `platform` looks like Copilot Studio / Agent Builder / Agent 365

Plain Office add-ins without those signals are **not** invented as agents.
Deep scan **only enriches** those catalog observations — it never invents new agents.

## Deep scan + adversarial surface (AWS parity)

After listing packages, Visentra calls package detail and stamps:

| Field | Source |
|---|---|
| `metadata.deep` (`agent365-deep.v1`, `awsDeepCompatible: aws-deep.v2`) | Package detail: description, sensitivity, ACLs/gestures, `elementDetails` → tools / KB hints, instruction preview+hash when present |
| `metadata.deepScanStatus` | `ok` / `permission_denied` / `error` / `skipped` |
| `metadata.adversarial_surface` (schema `1.0.0`) | Same builder as AWS (`attachAdversarialSurface`) with tools, instructions, data classes, connectivity, inbound host triggers |

**Honesty limits vs Bedrock GetAgent:**

- Graph does **not** return foundation model or a full system prompt like `GetAgent`
- Tools / KBs are inferred from `elementDetails[].definition` JSON when present
- No AWS `roleArn` — use `metadata.deep.access.availableTo` / `deployedTo` for blast radius
- Full instruction text is **not** persisted in `metadata.deep` (preview + hash only)

`deepScanStatus=permission_denied` means detail enrichment was blocked by Graph IAM —
not that deep scan is “off”.

## How to scan

1. Create/update connector provider **`m365_copilot`** (UI label: Microsoft 365 Copilot / Agent 365)
2. Config: `tenantId`, `clientId`; secret: `clientSecret`
3. Grant `CopilotPackages.Read.All` (+ org read as needed) and admin-consent
4. Ensure Agent 365 license is present in the tenant
5. Run SaaS / discovery job (not the Azure connector)
6. Open Agent Detail — Deep profile / adversarial panels use the same UI as AWS when `metadata.deep` is present

## Azure vs Agent 365

| Plane | Connector | Sees Agent 365 agents? | Deep / adversarial? |
|---|---|---|---|
| Azure ARM + Foundry / Assistants / Bot Service | `azure` | **No** | N/A |
| Graph Copilot admin catalog | `m365_copilot` | **Yes** (when permitted) | **Yes** via package detail |
