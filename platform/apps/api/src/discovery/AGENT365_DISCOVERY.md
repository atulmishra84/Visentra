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
| Agent filter (MS docs) | `$filter=supportedHosts/any(h:h eq 'Copilot')` |

Official docs: [List Copilot packages](https://learn.microsoft.com/en-us/microsoft-365/copilot/extensibility/api/admin-settings/package/copilotpackages-list)
and [Agent 365 Graph API](https://learn.microsoft.com/en-us/microsoft-agent-365/admin/graph-api).

## Required permissions / license

| Requirement | Why |
|---|---|
| Entra app + client secret on the `m365_copilot` connector | Same pattern as existing Graph discovery |
| Application permission **`CopilotPackages.Read.All`** (admin consent) | Catalog list/read |
| AI Administrator or Global Administrator context (tenant feature) | Admin catalog APIs |
| **Microsoft Agent 365** license in the tenant | Microsoft requires this for the Package Management API |

Without these, Graph returns `403` and Visentra records
`discoveryStatus: "permission_denied"` with a clear hint. Secondary heuristics
(service principals / Teams apps by name) may still find some Copilot-related
apps but **will miss most Agent 365 catalog agents**.

## Env toggles

| Variable | Default | Meaning |
|---|---|---|
| `M365_AGENT365_CATALOG_SCAN` | `true` | Call Copilot admin catalog packages |
| `M365_AGENT365_PACKAGE_LIMIT` | `200` | Cap catalog packages ingested |

## What gets confirmed as an agent

A catalog package is treated as an agent when **any** of:

- `supportedHosts` includes `Copilot` or `M365`
- `elementTypes` includes Bot / DeclarativeAgent / CustomEngineAgent
- `platform` looks like Copilot Studio / Agent Builder / Agent 365

Plain Office add-ins without those signals are **not** invented as agents.

## How to scan

1. Create/update connector provider **`m365_copilot`** (UI label: Microsoft 365 Copilot / Agent 365)
2. Config: `tenantId`, `clientId`; secret: `clientSecret`
3. Grant `CopilotPackages.Read.All` (+ org read as needed) and admin-consent
4. Ensure Agent 365 license is present in the tenant
5. Run SaaS / discovery job (not the Azure connector)

## Azure vs Agent 365

| Plane | Connector | Sees Agent 365 agents? |
|---|---|---|
| Azure ARM + Foundry / Assistants / Bot Service | `azure` | **No** |
| Graph Copilot admin catalog | `m365_copilot` | **Yes** (when permitted) |
