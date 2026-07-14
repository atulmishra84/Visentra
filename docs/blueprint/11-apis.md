# 11. APIs

Visentra exposes a tenant-scoped REST API under `/api/v1` for authentication, agents, assets, graph exploration, search, discovery jobs/events, dashboards, and export. The machine-readable contract is defined in [24-api-specifications.md](./24-api-specifications.md) and should be materialized at `platform/schemas/openapi.yaml`.

Related: [12-discovery-engine.md](./12-discovery-engine.md), [13-visibility-engine.md](./13-visibility-engine.md), [14-relationship-engine.md](./14-relationship-engine.md), [15-search-architecture.md](./15-search-architecture.md).

## Conventions

| Convention | Standard |
|---|---|
| Authentication | `Authorization: Bearer <token>` or secure httpOnly session cookie. |
| Tenant scope | Derived from authenticated membership; optional `X-Tenant-Id` for multi-tenant users. |
| Request ID | Accept `X-Request-Id`; return `requestId` in all JSON responses. |
| Idempotency | Mutating job/export endpoints require `Idempotency-Key`. |
| Pagination | Cursor pagination with `limit` and opaque `cursor`. |
| Errors | Canonical `ErrorResponse` from [24-api-specifications.md](./24-api-specifications.md). |

## REST resource map

| Domain | Method | Path | Purpose |
|---|---|---|---|
| Auth | `POST` | `/api/v1/auth/login` | Local login for BYOC/bootstrap. |
| Auth | `GET` | `/api/v1/auth/oidc/start` | Start OIDC login. |
| Auth | `GET` | `/api/v1/auth/oidc/callback` | Complete OIDC login. |
| Auth | `POST` | `/api/v1/auth/logout` | Revoke session/refresh token. |
| Auth | `GET` | `/api/v1/auth/me` | Current user, roles, tenants, permissions. |
| Agents | `GET` | `/api/v1/agents` | List agent summaries with facets. |
| Agents | `POST` | `/api/v1/agents` | Register known/manual agent metadata. |
| Agents | `GET` | `/api/v1/agents/{agentId}` | Agent detail projection. |
| Agents | `PATCH` | `/api/v1/agents/{agentId}` | Update owner, tags, criticality, metadata. |
| Agents | `GET` | `/api/v1/agents/{agentId}/observations` | Evidence observations. |
| Agents | `GET` | `/api/v1/agents/{agentId}/relationships` | Direct edges. |
| Assets | `GET` | `/api/v1/assets` | Models, tools, repos, MCP, DBs, APIs, cloud resources. |
| Assets | `GET` | `/api/v1/assets/{assetId}` | Canonical asset profile. |
| Assets | `PATCH` | `/api/v1/assets/{assetId}` | Update mutable metadata. |
| Graph | `GET` | `/api/v1/graph/neighborhood` | Expand graph around seed node(s). |
| Graph | `GET` | `/api/v1/graph/paths` | Find bounded paths between entities. |
| Graph | `POST` | `/api/v1/graph/query` | Execute approved traversal templates. |
| Graph | `GET` | `/api/v1/graph/schema` | Node labels, edge types, filters. |
| Search | `GET` | `/api/v1/search` | Simple full-text search. |
| Search | `POST` | `/api/v1/search/query` | Structured query with facets. |
| Search | `GET` | `/api/v1/search/suggest` | Typeahead. |
| Discovery | `GET` | `/api/v1/discovery/connectors` | Connector configs and health. |
| Discovery | `POST` | `/api/v1/discovery/connectors` | Create connector. |
| Discovery | `POST` | `/api/v1/discovery/jobs` | Launch scan. |
| Discovery | `GET` | `/api/v1/discovery/jobs/{jobId}` | Job status/counters. |
| Discovery | `GET` | `/api/v1/discovery/jobs/{jobId}/events` | Job event polling. |
| Discovery | `GET` | `/api/v1/discovery/events/stream` | SSE event stream. |
| Dashboards | `GET` | `/api/v1/dashboards/overview` | Executive metrics. |
| Dashboards | `GET` | `/api/v1/dashboards/coverage` | Coverage maps and gaps. |
| Dashboards | `GET` | `/api/v1/dashboards/activity` | Recent changes/jobs. |
| Export | `POST` | `/api/v1/export/jobs` | Create export artifact job. |
| Export | `GET` | `/api/v1/export/jobs/{exportId}` | Export status. |
| Export | `GET` | `/api/v1/export/jobs/{exportId}/download` | Signed download/redirect. |

## Example: agent list

Request:

```http
GET /api/v1/agents?owner=platform-ai&model=gpt-4.1&risk=high&limit=25
```

Response:

```json
{
  "requestId": "req_01jzw8h7sv9gb02c09n8ww00th",
  "items": [
    {
      "id": "agt_contract_review",
      "name": "contract-review-copilot",
      "type": "workflow_agent",
      "status": "active",
      "owner": {"id": "grp_platform_ai", "name": "Platform AI"},
      "framework": "langchain",
      "language": "python",
      "runtime": {"kind": "kubernetes", "cluster": "prod-use1", "namespace": "legal-ai"},
      "models": ["mdl_openai_gpt_4_1"],
      "tools": ["tool_jira_create_issue", "tool_s3_get_object"],
      "confidence": 0.94,
      "risk": {"level": "high", "reasons": ["external_api_access"]},
      "lastObservedAt": "2026-07-10T11:06:44Z"
    }
  ],
  "page": {"limit": 25, "nextCursor": "cur_eyJsYXN0T2JzZXJ2ZWRBdCI6..."}
}
```

## Example: discovery job

Request:

```json
{
  "name": "prod k8s and cloud scan",
  "scope": {
    "connectors": ["conn_aws_prod", "conn_k8s_prod"],
    "include": {"cloudAccounts": ["123456789012"], "kubernetesNamespaces": ["ai-*"]}
  },
  "priority": "normal",
  "reason": "weekly inventory refresh"
}
```

Response:

```json
{
  "requestId": "req_01jzw8kph5t91cqyfn154qez1w",
  "job": {
    "id": "job_01jzw8kecvf9y7yrn8s67c7qf7",
    "status": "running",
    "startedAt": "2026-07-10T11:10:00Z",
    "progress": {
      "connectorsTotal": 2,
      "connectorsCompleted": 0,
      "observationsAccepted": 1820,
      "entitiesCreated": 71,
      "entitiesUpdated": 242,
      "edgesCreated": 388
    }
  }
}
```

## Example: graph neighborhood

```json
{
  "requestId": "req_01jzw8nyk88sq5p6y9p7pdz3rp",
  "nodes": [
    {"id": "agt_contract_review", "label": "Agent", "displayName": "contract-review-copilot"},
    {"id": "mdl_openai_gpt_4_1", "label": "Model", "displayName": "gpt-4.1"}
  ],
  "edges": [
    {
      "id": "edge_77bc",
      "from": "agt_contract_review",
      "to": "mdl_openai_gpt_4_1",
      "type": "USES_MODEL",
      "confidence": 0.91,
      "evidence": {"sources": ["runtime", "llm_api"], "observationIds": ["obs_18", "obs_44"]}
    }
  ]
}
```

## Example: error

```json
{
  "requestId": "req_01jzw8r8nhtxfjz8rya36fhbvy",
  "error": {
    "code": "validation_failed",
    "message": "Request validation failed.",
    "details": [{"field": "filters.model[0]", "reason": "unknown_value"}]
  }
}
```
