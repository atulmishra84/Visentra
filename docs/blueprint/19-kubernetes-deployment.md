# 19. Kubernetes Deployment

Visentra's reference deployment is a Helm chart that installs the services from [16-backend-services.md](./16-backend-services.md), integrates cloud secret stores, configures ingress, and enables autoscaling.

Related: [18-deployment-architecture.md](./18-deployment-architecture.md), [20-aws.md](./20-aws.md), [21-azure.md](./21-azure.md), [22-gcp.md](./22-gcp.md).

## Helm chart design

```text
helm/agentradar/
├── Chart.yaml
├── values.yaml
├── values-aws.yaml
├── values-azure.yaml
├── values-gcp.yaml
├── values-byoc.yaml
├── values-saas.yaml
└── templates/
    ├── _helpers.tpl
    ├── serviceaccount.yaml
    ├── configmap.yaml
    ├── secretproviderclass.yaml
    ├── deployment-*.yaml
    ├── service.yaml
    ├── ingress.yaml
    ├── hpa.yaml
    ├── pdb.yaml
    ├── networkpolicy.yaml
    ├── job-migrations.yaml
    └── servicemonitor.yaml
```

## Workloads

| Workload | Kind | Min replicas | Notes |
|---|---|---:|---|
| `api-gateway` | Deployment | 2 | Public REST API. |
| `auth-service` | Deployment | 2 | Login/session/SSO. |
| `tenant-service` | Deployment | 2 | Tenant settings and memberships. |
| `inventory-service` | Deployment | 2 | Agents/assets/observations. |
| `discovery-orchestrator` | Deployment | 2 | Jobs, schedules, cursors. |
| `collector-workers` | Deployment | 0 | KEDA/HPA by queue; split by collector kind as needed. |
| `relationship-service` | Deployment | 2 | Edge inference and decay. |
| `graph-service` | Deployment | 2 | Traversal API. |
| `search-indexer` | Deployment | 1 | Bulk indexing/reindex. |
| `streaming-service` | Deployment | 2 | SSE fanout. |
| `migrations` | Job | 1 | Pre-rollout schema migration. |
| `maintenance` | CronJob | 1 | Decay, stale checks, cleanup. |

## Deployment standards

Every pod should define:

- service-specific `ServiceAccount`
- `runAsNonRoot: true`
- read-only root filesystem where possible
- resource requests/limits
- startup, readiness, and liveness probes
- topology spread constraints
- pod disruption budget
- config from ConfigMaps
- secrets from cloud secret store integration
- OpenTelemetry/logging environment variables

## Ingress

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: agentradar
  annotations:
    nginx.ingress.kubernetes.io/proxy-read-timeout: "3600"
    nginx.ingress.kubernetes.io/proxy-send-timeout: "3600"
spec:
  tls:
    - hosts: [agentradar.example.com]
      secretName: agentradar-tls
  rules:
    - host: agentradar.example.com
      http:
        paths:
          - path: /api/v1/discovery/events/stream
            pathType: Prefix
            backend:
              service:
                name: agentradar-streaming
                port: {name: http}
          - path: /api
            pathType: Prefix
            backend:
              service:
                name: agentradar-api-gateway
                port: {name: http}
```

| Cloud | Ingress |
|---|---|
| AWS | AWS Load Balancer Controller / ALB. |
| Azure | Application Gateway Ingress Controller or NGINX. |
| GCP | GKE Gateway/Ingress or NGINX. |

## Autoscaling

| Workload | Min | Max | Metric |
|---|---:|---:|---|
| `api-gateway` | 2 | 20 | CPU 60%, p95 latency. |
| `inventory-service` | 2 | 12 | CPU, DB pool. |
| `streaming-service` | 2 | 20 | active SSE connections. |
| `relationship-service` | 2 | 16 | edge queue lag. |
| `search-indexer` | 1 | 12 | index queue lag. |
| `collector-workers` | 0 | 100 | queue depth by collector kind. |

Use HPA for request-serving services and KEDA for queue-driven collectors/index/export workers.

## Secrets

| Secret | Consumers |
|---|---|
| `DATABASE_URL` | API, auth, tenant, inventory, discovery, relationship, migrations. |
| `REDIS_URL` | API, auth, streaming, cache users. |
| `MESSAGE_BUS_URL` | Discovery, collectors, relationship, search, streaming. |
| `OPENSEARCH_URL` | Search indexer and search API. |
| `JWT_SIGNING_KEY` | Auth; gateway verifier if asymmetric public key is not used. |
| `OIDC_CLIENT_SECRET` | Auth only. |
| `CONNECTOR_CREDENTIALS_*` | Matching collector workers only. |

Secrets should come from AWS Secrets Manager, Azure Key Vault, or GCP Secret Manager through External Secrets Operator or Secrets Store CSI.

## Network policies

Default deny ingress. Allow:

- ingress controller -> `api-gateway`, `streaming-service`
- `api-gateway` -> internal services
- services -> managed data endpoints
- collector workers -> configured source systems
- migrations -> PostgreSQL

## Values essentials

```yaml
global:
  environment: prod
  cloud: aws
  domain: agentradar.example.com
services:
  apiGateway:
    replicas: 3
    hpa: {enabled: true}
  collectorWorkers:
    keda: {enabled: true}
postgres:
  external: true
redis:
  external: true
opensearch:
  external: true
messageBus:
  provider: nats
```

## Implementation checklist

- Template service accounts, PDBs, HPAs, network policies, and ServiceMonitors.
- Add migration Job with advisory lock and retry-safe behavior.
- Add cloud-specific secret provider templates.
- Validate chart with SaaS, BYOC, AWS, Azure, and GCP values files.
