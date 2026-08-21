# AWS AI / Agent Discovery — IAM & Configuration

Visentra AWS discovery authenticates with IAM user/role credentials configured
per connector (`accessKeyId`, `secretAccessKey`, `accountId`, `region`).

All discovery APIs used are **read-only**. Do **not** grant AdministratorAccess,
write, or delete permissions.

## Discovery layers

1. **List** — Bedrock agents/KBs, SageMaker endpoints, AI-named Lambda/ECS  
2. **Deep scan** (default on) — `GetAgent`, agent versions, action groups/tools, agent KBs (`GetKnowledgeBase`), `DescribeEndpoint`, `GetFunctionConfiguration` → full `metadata.deep` profile (`aws-deep.v2`)  
3. **Classify** — confirmed agent vs AI resource vs heuristic candidate  
4. **Adversarial surface** — `metadata.adversarial_surface` for red-team consumers (see `ADVERSARIAL_INVENTORY.md`)

Hard rules: AI resource ≠ confirmed agent ≠ agent running. Deep scan does **not**
claim Bedrock `PREPARED` or SageMaker `InService` as a running AI agent.

`metadata.deep` (Bedrock) includes: model, lifecycle, role, guardrails, memory/prompt-override
presence, instruction preview+hash (not full text), action groups, tools (+ schemas),
normalized knowledge bases, and identity summary.

## Minimum IAM actions (recommended)

Attach a custom policy:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "VisentraAwsDiscoveryReadOnly",
      "Effect": "Allow",
      "Action": [
        "sts:GetCallerIdentity",
        "bedrock:ListAgents",
        "bedrock:ListAgentAliases",
        "bedrock:ListAgentVersions",
        "bedrock:GetAgent",
        "bedrock:ListAgentActionGroups",
        "bedrock:GetAgentActionGroup",
        "bedrock:ListAgentKnowledgeBases",
        "bedrock:ListKnowledgeBases",
        "bedrock:GetKnowledgeBase",
        "sagemaker:ListEndpoints",
        "sagemaker:DescribeEndpoint",
        "lambda:ListFunctions",
        "lambda:GetFunctionConfiguration",
        "ecs:ListClusters",
        "ecs:ListServices",
        "ecs:DescribeServices"
      ],
      "Resource": "*"
    }
  ]
}
```

| Capability | Actions |
|---|---|
| Identity check | `sts:GetCallerIdentity` |
| Bedrock agents (list) | `bedrock:ListAgents`, `bedrock:ListAgentAliases` |
| Bedrock agents (deep) | `bedrock:GetAgent`, `bedrock:ListAgentVersions`, `bedrock:ListAgentActionGroups`, `bedrock:GetAgentActionGroup`, `bedrock:ListAgentKnowledgeBases` |
| Bedrock knowledge bases | `bedrock:ListKnowledgeBases`, `bedrock:GetKnowledgeBase` |
| SageMaker (list + deep) | `sagemaker:ListEndpoints`, `sagemaker:DescribeEndpoint` |
| Lambda (list + deep) | `lambda:ListFunctions`, `lambda:GetFunctionConfiguration` |
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
| `AWS_DISCOVERY_AGENT_SCAN` | `true` | Call Bedrock Agents list APIs |
| `AWS_DISCOVERY_RUNTIME_SCAN` | `true` | Scan Lambda / ECS runtimes |
| `AWS_DISCOVERY_DEEP_SCAN` | `true` | GetAgent / DescribeEndpoint / GetFunctionConfiguration |
| `AWS_DISCOVERY_DEEP_MAX_AGENTS` | `40` | Cap deep GetAgent calls |
| `AWS_DISCOVERY_DEEP_MAX_ENDPOINTS` | `40` | Cap DescribeEndpoint calls |
| `AWS_DISCOVERY_DEEP_MAX_LAMBDAS` | `40` | Cap GetFunctionConfiguration calls |
| `AWS_DISCOVERY_DEEP_MAX_ACTION_GROUPS` | `15` | Cap GetAgentActionGroup expansions |
| `AWS_DISCOVERY_DEEP_MAX_KB_DETAILS` | `10` | Cap GetKnowledgeBase detail calls |

## Certainty vs unknown

| Finding | Confirmed? |
|---|---|
| Bedrock Agent from ListAgents (+ optional GetAgent) | Agent **confirmed**; runtime usually **unknown** (request-driven) |
| Bedrock Knowledge Base | AI resource only — not an agent |
| SageMaker endpoint InService | Endpoint runtime **running**; not an agent |
| Lambda / ECS AI-named (+ optional GetFunctionConfiguration) | Heuristic agent **candidate**; compute runtime from State/runningCount |

**API note:** Bedrock Agents list APIs (`ListAgents`, `ListKnowledgeBases`, `ListAgentAliases`)
are **POST** `/agents/` (etc.) with a JSON body and `nextToken` pagination. Visentra follows
all pages so accounts with >10 agents are fully inventoried.

**Region note:** The connector `region` must match where the agents were created
(e.g. agents in `us-west-2` are invisible to a connector set to `us-east-1`).

**Never inferred:** SageMaker InService ≠ agent running; Lambda Active ≠ confirmed agent;
ECS runningCount > 0 ≠ confirmed agent; GetAgent `PREPARED` ≠ agent running.
