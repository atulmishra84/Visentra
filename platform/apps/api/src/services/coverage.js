/**
 * Coverage map: which collectors/connectors are configured vs producing inventory.
 */

const SOURCE_CATALOG = [
  { id: "cloud_azure", label: "Microsoft Azure", category: "cloud", collector: "cloud_stub", providers: ["azure"] },
  { id: "cloud_aws", label: "Amazon Web Services", category: "cloud", collector: "cloud_stub", providers: ["aws"] },
  { id: "cloud_gcp", label: "Google Cloud", category: "cloud", collector: "cloud_stub", providers: ["gcp"] },
  { id: "k8s", label: "Kubernetes API", category: "container", collector: "k8s_api", providers: ["kubernetes"] },
  { id: "edr", label: "EDR / Endpoint", category: "endpoint", collector: "edr", providers: ["crowdstrike", "defender", "intune", "cortex", "netskope"] },
  { id: "saas", label: "SaaS platforms", category: "saas", collector: "saas_platform", providers: ["m365_copilot", "salesforce", "workday", "servicenow"] },
  { id: "git", label: "Git / SCM", category: "repo", collector: "git_sources", providers: ["github", "gitlab"] },
  { id: "identity", label: "Entra identity", category: "identity", collector: "identity_entra", providers: ["entra_identity"] },
  { id: "ide", label: "IDE filesystem", category: "ide", collector: "ide_filesystem", providers: [] },
  { id: "process", label: "Host processes", category: "local", collector: "process", providers: [] },
  { id: "mcp", label: "MCP servers", category: "mcp", collector: "mcp", providers: [] }
];

export async function buildCoverageMap(pool, tenantId, collectorIds = []) {
  const connectors = await pool.query(
    `SELECT id, name, provider, status, last_tested_at, last_error, updated_at
     FROM connectors WHERE tenant_id=$1`,
    [tenantId]
  );
  const byProvider = new Map();
  for (const row of connectors.rows) {
    const list = byProvider.get(row.provider) || [];
    list.push(row);
    byProvider.set(row.provider, list);
  }

  const agentCounts = await pool.query(
    `SELECT unnest(source_collectors) AS collector, COUNT(*)::int AS c
     FROM agents WHERE tenant_id=$1
     GROUP BY 1`,
    [tenantId]
  );
  const agentsByCollector = Object.fromEntries(agentCounts.rows.map((r) => [r.collector, r.c]));

  const lastJobs = await pool.query(
    `SELECT collector_ids, status, finished_at, started_at, agents_found, error
     FROM discovery_jobs WHERE tenant_id=$1
     ORDER BY created_at DESC LIMIT 20`,
    [tenantId]
  );

  const sources = SOURCE_CATALOG.map((src) => {
    const connected = (src.providers || []).flatMap((p) => byProvider.get(p) || []);
    const active = connected.filter((c) => c.status === "active");
    const errored = connected.filter((c) => c.status === "error");
    const agents = agentsByCollector[src.collector] || 0;
    const lastJob = lastJobs.rows.find((j) => (j.collector_ids || []).includes(src.collector));
    let status = "blind";
    if (src.providers.length === 0) {
      status = agents > 0 ? "covered" : "available";
    } else if (active.length) {
      status = agents > 0 ? "covered" : errored.length ? "degraded" : "configured";
    } else if (errored.length) {
      status = "error";
    } else if (connected.length) {
      status = "disabled";
    }

    return {
      id: src.id,
      label: src.label,
      category: src.category,
      collector: src.collector,
      status,
      connectorsConfigured: connected.length,
      connectorsActive: active.length,
      connectorsError: errored.length,
      agentsDiscovered: agents,
      lastJobStatus: lastJob?.status || null,
      lastJobAt: lastJob?.finished_at || lastJob?.started_at || null,
      collectorEnabled: collectorIds.includes(src.collector) || !collectorIds.length
    };
  });

  const summary = {
    covered: sources.filter((s) => s.status === "covered").length,
    configured: sources.filter((s) => s.status === "configured").length,
    blind: sources.filter((s) => s.status === "blind").length,
    error: sources.filter((s) => ["error", "degraded"].includes(s.status)).length,
    total: sources.length
  };

  return { summary, sources, collectors: collectorIds };
}
