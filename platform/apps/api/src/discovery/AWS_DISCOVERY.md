# AWS AI / Agent Discovery — IAM & Configuration

Visentra AWS discovery authenticates with IAM user/role credentials configured
per connector (`accessKeyId`, `secretAccessKey`, `accountId`, `region`).

All discovery APIs used are **read-only**. Do **not** grant AdministratorAccess,
write, or delete permissions.

## Minimum IAM actions (recommended)

Attach a custom policy (or scoped managed policies) with:

| Capability | Actions |
|---|---|
| Identity check | `sts:GetCallerIdentity` |
| Bedrock agents | `bedrock:ListAgents`, `bedrock:ListAgentAliases`, `bedrock:GetAgent` (optional) |
| Bedrock knowledge bases | `bedrock:ListKnowledgeBases` |
| SageMaker endpoints | `sagemaker:ListEndpoints`, `sagemaker:DescribeEndpoint` (optional) |
| Lambda | `lambda:ListFunctions` |
| ECS | `ecs:ListClusters`, `ecs:ListServices`, `ecs:DescribeServices` |

### Notes

- Prefer least privilege over broad `*ReadOnlyAccess` when possible.
- If a deep-discovery API returns 401/403, Visentra records
  `discoveryStatus: "permission_denied"` and continues scanning.
- Environment variable **values** on Lambda are never returned; only env **names**
  (with secret-like names redacted) may appear in metadata.

## Environment configuration (optional)

| Variable | Default | Meaning |
|---|---|---|
| `AWS_DISCOVERY_AI_ONLY` | inherits `DISCOVERY_AI_ONLY` | AI-relevant posture |
| `AWS_DISCOVERY_MAX_RESOURCES` | `150` | Cap on ingested resources |
| `AWS_DISCOVERY_AGENT_SCAN` | `true` | Call Bedrock Agents APIs |
| `AWS_DISCOVERY_RUNTIME_SCAN` | `true` | Scan Lambda / ECS runtimes |

## Certainty vs unknown

| Finding | Confirmed? |
|---|---|
| Bedrock Agent from ListAgents | Agent **confirmed**; runtime usually **unknown** (request-driven) |
| Bedrock Knowledge Base | AI resource only — not an agent |
| SageMaker endpoint InService | Endpoint runtime **running**; not an agent |
| Lambda / ECS AI-named | Heuristic agent **candidate**; compute runtime from State/runningCount |

**Never inferred:** SageMaker InService ≠ agent running; Lambda Active ≠ confirmed agent;
ECS runningCount > 0 ≠ confirmed agent.
