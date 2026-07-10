import { safeFetch, assertAllowedUrl, ALLOW } from "../utils/http.js";
import { isAiRelevantText } from "./aiRelevance.js";

const K8S_MAX_WORKLOADS = Number(process.env.K8S_DISCOVERY_MAX_WORKLOADS || 150);

function requireK8sConfig({ config = {}, secrets = {} }) {
  const apiServer = String(config.apiServer || "").trim().replace(/\/+$/, "");
  const token = String(secrets.token || "").trim();
  if (!apiServer) throw new Error("Kubernetes apiServer is required");
  const parsed = assertAllowedUrl(apiServer, { ...ALLOW.kubernetes, allowHosts: [new URL(apiServer).hostname] });
  if (!token) throw new Error("Kubernetes bearer token is required");
  return {
    apiServer: parsed.origin,
    token,
    skipTlsVerify: config.skipTlsVerify === true || String(config.skipTlsVerify || "").toLowerCase() === "true",
    policy: { ...ALLOW.kubernetes, allowHosts: [parsed.hostname] }
  };
}

async function k8sJson(conn, path) {
  const cfg = requireK8sConfig(conn);
  const res = await safeFetch(
    `${cfg.apiServer}${path}`,
    {
      headers: { Authorization: `Bearer ${cfg.token}`, Accept: "application/json" },
      skipTlsVerify: cfg.skipTlsVerify
    },
    cfg.policy
  );
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(json.message || json.reason || `Kubernetes API failed (${res.status})`);
  }
  return json;
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function podSpecFor(workload, kind) {
  if (kind === "CronJob") return workload.spec?.jobTemplate?.spec?.template?.spec || {};
  return workload.spec?.template?.spec || {};
}

function workloadLabels(workload, kind) {
  const top = asObject(workload.metadata?.labels);
  const podLabels =
    kind === "CronJob"
      ? asObject(workload.spec?.jobTemplate?.spec?.template?.metadata?.labels)
      : asObject(workload.spec?.template?.metadata?.labels);
  return { ...top, ...podLabels };
}

function workloadSignals(workload, kind) {
  const spec = podSpecFor(workload, kind);
  const containers = [...(spec.initContainers || []), ...(spec.containers || [])];
  const images = containers.map((c) => c.image).filter(Boolean);
  const envNames = [];
  const envText = [];
  for (const c of containers) {
    for (const env of c.env || []) {
      if (env.name) envNames.push(env.name);
      if (env.value && !/secret|token|key|password/i.test(env.name || "")) envText.push(env.value);
    }
  }
  const labels = workloadLabels(workload, kind);
  return {
    images,
    envNames,
    labels,
    text: [
      kind,
      workload.metadata?.name,
      workload.metadata?.namespace,
      Object.keys(labels).join(" "),
      Object.values(labels).join(" "),
      images.join(" "),
      envNames.join(" "),
      envText.join(" ")
    ].join(" ")
  };
}

function isAiWorkload(workload, kind) {
  return isAiRelevantText(workloadSignals(workload, kind).text);
}

function workloadStatus(workload, kind) {
  if (kind === "CronJob") return workload.spec?.suspend ? "suspended" : "scheduled";
  if (workload.status?.availableReplicas || workload.status?.readyReplicas) return "running";
  if (workload.status?.replicas) return "degraded";
  return "unknown";
}

function workloadObservation(conn, workload, kind, clusterKey) {
  const namespace = workload.metadata?.namespace || "default";
  const name = workload.metadata?.name || `${kind.toLowerCase()}-unknown`;
  const uid = workload.metadata?.uid || `${namespace}/${name}`;
  const signals = workloadSignals(workload, kind);
  return {
    collector_id: "k8s_api",
    fingerprint: `k8s:${clusterKey}:${kind}:${namespace}:${name}`,
    name: `Kubernetes ${kind} — ${namespace}/${name}`,
    category: "container",
    provider: "kubernetes",
    deployment_type: "container",
    container: signals.images.join(", ") || null,
    running_status: workloadStatus(workload, kind),
    confidence_score: 0.84,
    framework: kind,
    model: "kubernetes-ai-workload",
    metadata: {
      connectorId: conn.id,
      connectorName: conn.name,
      discoveryMode: "kubernetes-api-live",
      inventoryClass: "kubernetes_workload",
      evidenceClass: "cloud_ai_runtime",
      agentStatus: "candidate",
      apiServer: conn.config.apiServer,
      namespace,
      kind,
      uid,
      labels: signals.labels,
      images: signals.images,
      envNames: signals.envNames,
      aiRelevant: true,
      environment: conn.environment
    },
    relationships: [
      {
        rel_type: "RUNS_IN",
        to_type: "KubernetesCluster",
        to_key: clusterKey,
        to_name: conn.name || clusterKey
      },
      {
        rel_type: "DEPLOYED_IN",
        to_type: "KubernetesNamespace",
        to_key: `${clusterKey}:${namespace}`,
        to_name: namespace
      }
    ]
  };
}

export async function validateK8sConnector(conn) {
  const cfg = requireK8sConfig(conn);
  const json = await k8sJson(conn, "/api/v1/namespaces?limit=1");
  return {
    ok: true,
    message: `Authenticated to Kubernetes API at ${cfg.apiServer}. Namespace probe returned ${(json.items || []).length} item(s).`
  };
}

export async function discoverK8sConnector(conn) {
  const cfg = requireK8sConfig(conn);
  const clusterKey = `k8s-${new URL(cfg.apiServer).hostname}`;
  const observations = [
    {
      collector_id: "k8s_api",
      fingerprint: `k8s-connector-scan:${conn.id}:${clusterKey}`,
      name: `Kubernetes scan — ${conn.name}`,
      category: "container",
      provider: "kubernetes",
      deployment_type: "container",
      running_status: "running",
      confidence_score: 0.92,
      framework: "cluster-scan",
      metadata: {
        connectorId: conn.id,
        connectorName: conn.name,
        discoveryMode: "kubernetes-api-live",
        inventoryClass: "kubernetes_connector",
        apiServer: cfg.apiServer,
        environment: conn.environment,
        maxWorkloads: K8S_MAX_WORKLOADS
      },
      relationships: [
        {
          rel_type: "RUNS_IN",
          to_type: "KubernetesCluster",
          to_key: clusterKey,
          to_name: conn.name || clusterKey
        }
      ]
    }
  ];

  const paths = [
    ["Deployment", "/apis/apps/v1/deployments?limit=250"],
    ["StatefulSet", "/apis/apps/v1/statefulsets?limit=250"],
    ["CronJob", "/apis/batch/v1/cronjobs?limit=250"]
  ];
  let totalWorkloadsScanned = 0;
  let aiRelevantWorkloads = 0;

  for (const [kind, path] of paths) {
    const json = await k8sJson(conn, path).catch(() => ({ items: [] }));
    const items = Array.isArray(json.items) ? json.items : [];
    totalWorkloadsScanned += items.length;
    for (const item of items) {
      if (!isAiWorkload(item, kind)) continue;
      aiRelevantWorkloads += 1;
      if (observations.length <= K8S_MAX_WORKLOADS) {
        observations.push(workloadObservation(conn, item, kind, clusterKey));
      }
    }
  }

  return {
    observations,
    stats: {
      totalWorkloadsScanned,
      aiRelevantWorkloads,
      workloadsIngested: Math.max(0, observations.length - 1)
    }
  };
}
