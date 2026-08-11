# GCP AI / Agent Discovery — IAM & Configuration

Visentra GCP discovery authenticates with a **service account** configured per
connector (`projectId`, `clientEmail`, `privateKey`).

All discovery APIs used are **read-only**. Do **not** grant Owner/Editor roles.

## Minimum IAM roles (recommended)

| Capability | Role(s) |
|---|---|
| Project identity | `roles/browser` or `roles/resourcemanager.projectViewer` |
| Vertex AI endpoints/models/reasoning engines | `roles/aiplatform.viewer` |
| Dialogflow CX agents | `roles/dialogflow.viewer` or `roles/dialogflow.agentReader` |
| Discovery Engine | `roles/discoveryengine.viewer` |
| Cloud Run | `roles/run.viewer` |
| Enabled APIs fallback | `roles/serviceusage.serviceUsageViewer` |

### Notes

- Prefer viewer roles over admin.
- If a deep-discovery API returns 401/403, Visentra records
  `discoveryStatus: "permission_denied"` and continues scanning.
- Cloud Run env **values** are never returned; only env **names** (secret-like
  names redacted) may appear in metadata.
- Private keys must never be logged; errors are sanitized.

## Environment configuration (optional)

| Variable | Default | Meaning |
|---|---|---|
| `GCP_DISCOVERY_AI_ONLY` | inherits `DISCOVERY_AI_ONLY` | AI-relevant posture |
| `GCP_DISCOVERY_MAX_RESOURCES` | `150` | Cap on ingested resources |
| `GCP_DISCOVERY_AGENT_SCAN` | `true` | Dialogflow CX + Reasoning Engines |
| `GCP_DISCOVERY_RUNTIME_SCAN` | `true` | Cloud Run deep scan |
| `GCP_DISCOVERY_LOCATIONS` | common Vertex regions | Region list for Vertex/Cloud Run |

## Certainty vs unknown

| Finding | Confirmed? |
|---|---|
| Dialogflow CX agent | Agent **confirmed**; runtime **unknown** (no continuous runtime field) |
| Vertex Reasoning Engine | Agent **confirmed**; runtime **unknown** unless API exposes it |
| Vertex endpoint with deployedModels | Endpoint runtime may be **running**; not an agent |
| Vertex model / Discovery Engine | AI resource only |
| Cloud Run AI-named | Heuristic agent **candidate**; Ready = compute runtime |

**Never inferred:** Vertex endpoint serving ≠ agent running; Cloud Run Ready ≠
confirmed agent; model registry entry ≠ agent.
