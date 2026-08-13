# Endpoint / EDR Discovery — Permissions & Configuration

Visentra EDR discovery authenticates with per-connector credentials and uses
**read-only** vendor APIs. Do **not** grant write, containment, or remediation
permissions for discovery.

Discovery layers (same model as Azure/AWS/GCP):

**Endpoint device → AI-relevant host (candidate) → Process-confirmed agent → Host runtime status**

Hard rules:

- Device `CONNECTED` / healthy ≠ AI agent running
- Hostname / owner heuristics → **candidate** only (`name_heuristic`)
- Intune `detectedApps` / Netskope client apps → **candidate** only (`app_heuristic`)
- Confirmed agents require live process/cmdline evidence from CrowdStrike,
  Defender Advanced Hunting, or Cortex XQL

## Minimum read-only permissions by vendor

| Provider | Auth | Minimum scopes / roles |
|---|---|---|
| CrowdStrike | OAuth client | Hosts:read; Processes:read (for confirmation) |
| Microsoft Defender | App registration | `Machine.Read.All`; `AdvancedHunting.Read.All` (recommended) |
| Microsoft Intune | App registration | `DeviceManagementManagedDevices.Read.All`; detectedApps read (optional, candidate only) |
| Cortex XDR | API key | Endpoints read; XQL query (for confirmation) |
| Netskope | API token | Clients read (v1/v2) — app inventory is candidate only |

### Notes

- If a process/hunt API returns 401/403, Visentra records
  `discoveryStatus: "permission_denied"` and continues with hostname/app candidates.
- One process-API failure does **not** abort the connector scan.
- Secrets and bearer tokens are never written to discovery error samples.

## Environment configuration (optional)

| Variable | Default | Meaning |
|---|---|---|
| `EDR_DISCOVERY_MAX_DEVICES` | `100` | Cap on devices listed per connector |
| `EDR_DISCOVERY_AGENT_SCAN` | `true` | Emit AI agent/candidate layers |
| `EDR_DISCOVERY_PROCESS_SCAN` | `true` | Call process/hunt/app APIs |

## Certainty vs unknown

| Finding | Confirmed? | Runtime |
|---|---|---|
| Hostname matches AI heuristic | Agent **candidate** | Host runtime from device health; agent runtime **unknown** |
| Intune detectedApps / Netskope apps | Agent **candidate** | Host runtime only; app ≠ process |
| CrowdStrike / Defender / Cortex process hit | Agent **confirmed** | Agent runtime **running**; host runtime separate |
| Device online / CONNECTED | Not an agent signal | Host `runtime.status=running` only |

**Never inferred:** device online ⇒ agent running; app installed ⇒ agent confirmed;
hostname containing “ai” ⇒ confirmed agent.
