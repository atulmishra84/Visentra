# AWS Adversarial Inventory (Agentic Red-Team Ready)

The AWS deep scanner emits `metadata.adversarial_surface` on every ingested
observation. This block is designed as **attack-surface input** for agentic
red-teaming frameworks (AgentBreaker, SIRAJ, DeepTeam, PyRIT, etc.) and maps to
OWASP LLM Top 10 + Agentic ASI themes via `owasp_hints`.

Schema version: **1.0.0** (`ADVERSARIAL_SCHEMA_VERSION`)

## Classification (always present)

| Field | Meaning |
|---|---|
| `agent_detected` | True only for confirmed agent entities (e.g. Bedrock Agents) |
| `category` | `agent` \| `knowledge_base` \| `model_endpoint` \| `runtime` \| `ai_resource` \| … |
| `confidence_score` | 0–1 discovery confidence |
| `evidence[]` | Why it was classified that way |

**Hard rule:** Bedrock Knowledge Bases and SageMaker endpoints are **not** agents.

## P0 fields (critical for adversarial testing)

| Field | Why it matters |
|---|---|
| `tools[]` + `parameters_schema` | Tool misuse / ASI02 — primary attack interface |
| `instructions` (hash/preview/safety flags) | Prompt injection / goal hijack surface |
| `identity_and_access` | Privilege compromise / excessive agency |
| `data_access` | Sensitive info disclosure / exfiltration reach |

## P1 fields

| Field | Why it matters |
|---|---|
| `mcp_servers[]` | Extra tool planes (when discovered) |
| `memory_and_context` | KB/memory poisoning (ASI06 / LLM08) |
| `connectivity` | Egress, code exec, inbound triggers |

## Collection sources (AWS deep scan)

| Signal | API |
|---|---|
| Agent + instruction + role + guardrail | `bedrock:GetAgent` |
| Tools / parameter schemas | `ListAgentActionGroups` + `GetAgentActionGroup` |
| Associated KBs | `ListAgentKnowledgeBases` |
| Model endpoint runtime | `sagemaker:DescribeEndpoint` |
| Lambda role / env **names** | `lambda:GetFunctionConfiguration` |

Partial data is expected: missing fields stay `null`/`[]` with `confidence` + `evidence`.

## Extra IAM (beyond list APIs)

```text
bedrock:GetAgent
bedrock:ListAgentActionGroups
bedrock:GetAgentActionGroup
bedrock:ListAgentKnowledgeBases
sagemaker:DescribeEndpoint
lambda:GetFunctionConfiguration
```

## Env toggles

| Variable | Default |
|---|---|
| `AWS_DISCOVERY_DEEP_SCAN` | always `true` (cannot be turned off unless break-glass) |
| `AWS_DISCOVERY_DEEP_SCAN_ALLOW_OFF` | `false` — break-glass only; do not set in production |
| `AWS_DISCOVERY_DEEP_MAX_ACTION_GROUPS` | `15` |

`permission_denied` on deep APIs is **not** deep scan being off — it means IAM blocked
`GetAgent` / related calls. Grant deep-scan IAM and re-run; see `AWS_DISCOVERY.md`.

## Consumer tip

Prefer `metadata.adversarial_surface` as the red-team contract. Legacy fields
(`agentStatus`, `inventoryClass`, `tools`, `risk_indicators`) remain for UI/backward compatibility.
