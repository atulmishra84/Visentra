import fs from "fs";
import path from "path";
import os from "os";
import { demoObservations } from "./demoData.js";

function readJsonSafe(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

/** @typedef {{ id: string, scan: (ctx: object) => Promise<object[]> }} Collector */

export const collectors = {
  demo: {
    id: "demo",
    async scan(ctx) {
      return demoObservations(ctx.tenantId);
    }
  },

  ide_filesystem: {
    id: "ide_filesystem",
    async scan(ctx) {
      const home = os.homedir();
      const candidates = [
        path.join(home, ".cursor", "mcp.json"),
        path.join(home, "Library", "Application Support", "Claude", "claude_desktop_config.json"),
        path.join(home, ".config", "Claude", "claude_desktop_config.json"),
        path.join(home, ".continue", "config.json")
      ];
      const out = [];
      for (const file of candidates) {
        const json = readJsonSafe(file);
        if (!json) continue;
        const ide = file.includes("cursor")
          ? "Cursor"
          : file.includes("Claude")
            ? "Claude Desktop"
            : file.includes("continue")
              ? "Continue.dev"
              : "IDE";
        const servers = json.mcpServers || json.mcp?.servers || {};
        out.push({
          collector_id: "ide_filesystem",
          fingerprint: `ide-config:${ide}:${os.hostname()}`,
          name: `${ide} AI Config — ${os.hostname()}`,
          category: "ide",
          owner: ctx.ownerHint || process.env.USER || "local-user",
          hostname: os.hostname(),
          operating_system: `${os.type()} ${os.release()}`,
          ide,
          deployment_type: "ide",
          mcp_connections: Object.keys(servers),
          tools: Object.keys(servers),
          running_status: "unknown",
          confidence_score: 0.8,
          filesystem_access: true,
          relationships: [
            {
              rel_type: "RUNS_IN",
              to_type: "IDE",
              to_key: ide.toLowerCase().replace(/\s+/g, "-"),
              to_name: ide
            },
            ...Object.keys(servers).map((name) => ({
              rel_type: "CONNECTS_MCP",
              to_type: "MCPServer",
              to_key: `mcp-${name}`,
              to_name: name
            }))
          ],
          metadata: { config_path: file }
        });
      }
      return out;
    }
  },

  process: {
    id: "process",
    async scan() {
      // Lightweight heuristic: inspect /proc on Linux when available
      const out = [];
      try {
        if (!fs.existsSync("/proc")) return out;
        const pids = fs.readdirSync("/proc").filter((p) => /^\d+$/.test(p));
        for (const pid of pids.slice(0, 400)) {
          let cmdline = "";
          try {
            cmdline = fs.readFileSync(`/proc/${pid}/cmdline`, "utf8").replace(/\0/g, " ");
          } catch {
            continue;
          }
          const lower = cmdline.toLowerCase();
          let hit = null;
          if (lower.includes("ollama")) hit = { name: "Ollama", category: "local_llm", provider: "ollama", model: "ollama" };
          else if (lower.includes("langgraph")) hit = { name: "LangGraph process", category: "framework", framework: "LangGraph" };
          else if (lower.includes("crewai")) hit = { name: "CrewAI process", category: "framework", framework: "CrewAI" };
          else if (lower.includes("autogen")) hit = { name: "AutoGen process", category: "framework", framework: "AutoGen" };
          else if (lower.includes("vllm")) hit = { name: "vLLM server", category: "local_llm", provider: "vllm" };
          if (!hit) continue;
          out.push({
            collector_id: "process",
            fingerprint: `proc:${hit.name}:${pid}`,
            ...hit,
            hostname: os.hostname(),
            deployment_type: "local",
            running_status: "running",
            confidence_score: 0.65,
            metadata: { pid, cmdline: cmdline.slice(0, 500) },
            relationships: [
              { rel_type: "RUNS_ON", to_type: "Device", to_key: os.hostname(), to_name: os.hostname() }
            ]
          });
        }
      } catch {
        /* ignore */
      }
      return out;
    }
  },

  mcp: {
    id: "mcp",
    async scan(ctx) {
      // Reuse IDE configs specifically for MCP server inventory as assets/agents
      const ideHits = await collectors.ide_filesystem.scan(ctx);
      const out = [];
      for (const hit of ideHits) {
        for (const name of hit.mcp_connections || []) {
          out.push({
            collector_id: "mcp",
            fingerprint: `mcp-server:${name}:${hit.hostname}`,
            name: `MCP Server — ${name}`,
            category: "mcp",
            deployment_type: "mcp",
            hostname: hit.hostname,
            owner: hit.owner,
            tools: [name],
            mcp_connections: [name],
            running_status: "unknown",
            confidence_score: 0.78,
            relationships: [
              {
                rel_type: "CONNECTS_MCP",
                to_type: "MCPServer",
                to_key: `mcp-${name}`,
                to_name: name
              }
            ]
          });
        }
      }
      return out;
    }
  },

  cloud_stub: {
    id: "cloud_stub",
    async scan(ctx) {
      const out = [];

      if (ctx.pool && ctx.tenantId) {
        try {
          const { listActiveCloudConnectors } = await import("../services/connectors.js");
          const { discoverAzureConnector } = await import("./azureArm.js");
          const { discoverAwsConnector } = await import("./awsCloud.js");
          const { discoverGcpConnector } = await import("./gcpCloud.js");
          const connectors = await listActiveCloudConnectors(ctx.pool, ctx.tenantId);
          const discoverers = {
            azure: discoverAzureConnector,
            aws: discoverAwsConnector,
            gcp: discoverGcpConnector
          };
          const labels = { azure: "Azure", aws: "AWS", gcp: "GCP" };

          for (const conn of connectors) {
            const discoverer = discoverers[conn.provider];
            if (discoverer) {
              const label = labels[conn.provider] || conn.provider;
              try {
                const { observations, stats } = await discoverer(conn);
                out.push(...observations);
                if (ctx.pool) {
                  await ctx.pool.query(
                    `INSERT INTO discovery_events (tenant_id, event_type, severity, message, payload)
                     VALUES ($1,'connector.scan','info',$2,$3::jsonb)`,
                    [
                      ctx.tenantId,
                      `${label} connector "${conn.name}" scanned ${stats.totalResourcesScanned || 0} resources — ingested ${stats.cloudResourcesIngested || 0} cloud assets (${stats.aiRelevantResources || 0} AI-relevant)`,
                      JSON.stringify({
                        connectorId: conn.id,
                        provider: conn.provider,
                        ...stats
                      })
                    ]
                  );
                  await ctx.pool.query(
                    `UPDATE connectors SET last_tested_at=NOW(), last_error=NULL, status='active', updated_at=NOW()
                     WHERE id=$1 AND tenant_id=$2`,
                    [conn.id, ctx.tenantId]
                  );
                }
              } catch (err) {
                const message = err.message || String(err);
                console.warn(`${label} connector scan failed:`, message);
                if (ctx.pool) {
                  await ctx.pool.query(
                    `UPDATE connectors SET status='error', last_tested_at=NOW(), last_error=$3, updated_at=NOW()
                     WHERE id=$1 AND tenant_id=$2`,
                    [conn.id, ctx.tenantId, message]
                  );
                  await ctx.pool.query(
                    `INSERT INTO discovery_events (tenant_id, event_type, severity, message, payload)
                     VALUES ($1,'connector.scan.error','error',$2,$3::jsonb)`,
                    [
                      ctx.tenantId,
                      `${label} connector "${conn.name}" failed: ${message}`,
                      JSON.stringify({ connectorId: conn.id, provider: conn.provider })
                    ]
                  );
                }
                out.push({
                  collector_id: "cloud_stub",
                  fingerprint: `${conn.provider}-connector-error:${conn.id}`,
                  name: `${label} connector error — ${conn.name}`,
                  category: "cloud",
                  cloud_provider: conn.provider,
                  confidence_score: 0.2,
                  running_status: "unknown",
                  risk_indicators: ["connector_auth_failed"],
                  metadata: {
                    connectorId: conn.id,
                    connectorName: conn.name,
                    discoveryMode: `${conn.provider}-api-error`,
                    error: message
                  }
                });
              }
              continue;
            }
          }
        } catch (err) {
          console.warn("cloud connector scan:", err.message);
        }
      }

      if (process.env.DEMO_CLOUD === "true" && !out.length) {
        out.push({
          collector_id: "cloud_stub",
          fingerprint: "cloud-stub:vertex:demo",
          name: "Vertex AI Agent (stub)",
          category: "cloud",
          cloud_provider: "gcp",
          region: "us-central1",
          provider: "google",
          model: "gemini-2.0-flash",
          deployment_type: "cloud",
          running_status: "unknown",
          confidence_score: 0.55,
          relationships: [
            {
              rel_type: "DEPLOYED_IN",
              to_type: "CloudResource",
              to_key: "vertex-demo",
              to_name: "Vertex AI demo"
            }
          ]
        });
      }

      return out;
    }
  },

  k8s_stub: {
    id: "k8s_stub",
    async scan() {
      const manifestDir = process.env.K8S_SAMPLE_DIR || path.join(process.cwd(), "sample-manifests");
      const out = [];
      try {
        if (!fs.existsSync(manifestDir)) return out;
        for (const file of fs.readdirSync(manifestDir)) {
          if (!file.endsWith(".json") && !file.endsWith(".yaml") && !file.endsWith(".yml")) continue;
          const raw = fs.readFileSync(path.join(manifestDir, file), "utf8");
          const lower = raw.toLowerCase();
          if (!/(ai|llm|agent|langchain|bedrock|openai|anthropic)/.test(lower)) continue;
          out.push({
            collector_id: "k8s_stub",
            fingerprint: `k8s-manifest:${file}`,
            name: `K8s AI workload — ${file}`,
            category: "container",
            deployment_type: "container",
            container: file,
            running_status: "unknown",
            confidence_score: 0.6,
            metadata: { manifest: file },
            relationships: [
              {
                rel_type: "DEPLOYED_IN",
                to_type: "CloudResource",
                to_key: `k8s-${file}`,
                to_name: file
              }
            ]
          });
        }
      } catch {
        /* ignore */
      }
      return out;
    }
  },

  k8s_api: {
    id: "k8s_api",
    async scan(ctx) {
      const out = [];
      if (!ctx.pool || !ctx.tenantId) return out;

      try {
        const { listActiveK8sConnectors } = await import("../services/connectors.js");
        const { discoverK8sConnector } = await import("./k8sApi.js");
        const connectors = await listActiveK8sConnectors(ctx.pool, ctx.tenantId);

        for (const conn of connectors) {
          try {
            const { observations, stats } = await discoverK8sConnector(conn);
            out.push(...observations);
            await ctx.pool.query(
              `UPDATE connectors SET last_tested_at=NOW(), last_error=NULL, status='active', updated_at=NOW()
               WHERE id=$1 AND tenant_id=$2`,
              [conn.id, ctx.tenantId]
            );
            await ctx.pool.query(
              `INSERT INTO discovery_events (tenant_id, event_type, severity, message, payload)
               VALUES ($1,'connector.scan','info',$2,$3::jsonb)`,
              [
                ctx.tenantId,
                `Kubernetes connector "${conn.name}" scanned ${stats.totalWorkloadsScanned || 0} workloads — ingested ${stats.workloadsIngested || 0} AI workloads`,
                JSON.stringify({ connectorId: conn.id, provider: conn.provider, category: "container", ...stats })
              ]
            );
          } catch (err) {
            const message = err.message || String(err);
            console.warn("Kubernetes connector scan failed:", message);
            await ctx.pool.query(
              `UPDATE connectors SET status='error', last_tested_at=NOW(), last_error=$3, updated_at=NOW()
               WHERE id=$1 AND tenant_id=$2`,
              [conn.id, ctx.tenantId, message]
            );
            await ctx.pool.query(
              `INSERT INTO discovery_events (tenant_id, event_type, severity, message, payload)
               VALUES ($1,'connector.scan.error','error',$2,$3::jsonb)`,
              [
                ctx.tenantId,
                `Kubernetes connector "${conn.name}" failed: ${message}`,
                JSON.stringify({ connectorId: conn.id, provider: conn.provider, category: "container" })
              ]
            );
            out.push({
              collector_id: "k8s_api",
              fingerprint: `k8s-connector-error:${conn.id}`,
              name: `Kubernetes connector error — ${conn.name}`,
              category: "container",
              provider: "kubernetes",
              confidence_score: 0.2,
              running_status: "unknown",
              risk_indicators: ["connector_auth_failed"],
              metadata: {
                connectorId: conn.id,
                connectorName: conn.name,
                discoveryMode: "kubernetes-api-error",
                inventoryClass: "kubernetes_connector",
                error: message
              }
            });
          }
        }
      } catch (err) {
        console.warn("kubernetes connector scan:", err.message);
      }

      return out;
    }
  },

  git_sources: {
    id: "git_sources",
    async scan(ctx) {
      const out = [];
      if (!ctx.pool || !ctx.tenantId) return out;

      try {
        const { listActiveGitSourceConnectors } = await import("../services/connectors.js");
        const { discoverGitSourceConnector } = await import("./gitSources.js");
        const connectors = await listActiveGitSourceConnectors(ctx.pool, ctx.tenantId);
        const labels = { github: "GitHub", gitlab: "GitLab" };

        for (const conn of connectors) {
          const label = labels[conn.provider] || conn.provider;
          try {
            const { observations, stats } = await discoverGitSourceConnector(conn);
            out.push(...observations);
            await ctx.pool.query(
              `UPDATE connectors SET last_tested_at=NOW(), last_error=NULL, status='active', updated_at=NOW()
               WHERE id=$1 AND tenant_id=$2`,
              [conn.id, ctx.tenantId]
            );
            await ctx.pool.query(
              `INSERT INTO discovery_events (tenant_id, event_type, severity, message, payload)
               VALUES ($1,'connector.scan','info',$2,$3::jsonb)`,
              [
                ctx.tenantId,
                `${label} connector "${conn.name}" scanned ${stats.reposScanned || 0} repositories — ingested ${stats.reposIngested || 0} AI-related repos`,
                JSON.stringify({ connectorId: conn.id, provider: conn.provider, category: "source", ...stats })
              ]
            );
          } catch (err) {
            const message = err.message || String(err);
            console.warn("Git source connector scan failed:", conn.provider, message);
            await ctx.pool.query(
              `UPDATE connectors SET status='error', last_tested_at=NOW(), last_error=$3, updated_at=NOW()
               WHERE id=$1 AND tenant_id=$2`,
              [conn.id, ctx.tenantId, message]
            );
            await ctx.pool.query(
              `INSERT INTO discovery_events (tenant_id, event_type, severity, message, payload)
               VALUES ($1,'connector.scan.error','error',$2,$3::jsonb)`,
              [
                ctx.tenantId,
                `${label} connector "${conn.name}" failed: ${message}`,
                JSON.stringify({ connectorId: conn.id, provider: conn.provider, category: "source" })
              ]
            );
            out.push({
              collector_id: "git_sources",
              fingerprint: `git-connector-error:${conn.provider}:${conn.id}`,
              name: `${label} connector error — ${conn.name}`,
              category: "repository",
              provider: conn.provider,
              confidence_score: 0.2,
              running_status: "unknown",
              risk_indicators: ["connector_auth_failed"],
              metadata: {
                connectorId: conn.id,
                connectorName: conn.name,
                discoveryMode: "git-source-error",
                inventoryClass: "source_connector",
                error: message
              }
            });
          }
        }
      } catch (err) {
        console.warn("git source scan:", err.message);
      }

      return out;
    }
  },

  identity_entra: {
    id: "identity_entra",
    async scan(ctx) {
      const out = [];
      if (!ctx.pool || !ctx.tenantId) return out;

      try {
        const { listActiveIdentityConnectors } = await import("../services/connectors.js");
        const { discoverEntra } = await import("./entraIdentity.js");
        const connectors = await listActiveIdentityConnectors(ctx.pool, ctx.tenantId);

        for (const conn of connectors) {
          try {
            const { observations, stats } = await discoverEntra(conn);
            out.push(...observations);
            await ctx.pool.query(
              `UPDATE connectors SET last_tested_at=NOW(), last_error=NULL, status='active', updated_at=NOW()
               WHERE id=$1 AND tenant_id=$2`,
              [conn.id, ctx.tenantId]
            );
            await ctx.pool.query(
              `INSERT INTO discovery_events (tenant_id, event_type, severity, message, payload)
               VALUES ($1,'connector.scan','info',$2,$3::jsonb)`,
              [
                ctx.tenantId,
                `Entra ID connector "${conn.name}" scanned ${(stats.servicePrincipalsScanned || 0) + (stats.applicationsScanned || 0)} identities — ingested ${stats.identitiesIngested || 0} AI-related identities`,
                JSON.stringify({ connectorId: conn.id, provider: conn.provider, category: "identity", ...stats })
              ]
            );
          } catch (err) {
            const message = err.message || String(err);
            console.warn("Entra identity connector scan failed:", message);
            await ctx.pool.query(
              `UPDATE connectors SET status='error', last_tested_at=NOW(), last_error=$3, updated_at=NOW()
               WHERE id=$1 AND tenant_id=$2`,
              [conn.id, ctx.tenantId, message]
            );
            await ctx.pool.query(
              `INSERT INTO discovery_events (tenant_id, event_type, severity, message, payload)
               VALUES ($1,'connector.scan.error','error',$2,$3::jsonb)`,
              [
                ctx.tenantId,
                `Entra ID connector "${conn.name}" failed: ${message}`,
                JSON.stringify({ connectorId: conn.id, provider: conn.provider, category: "identity" })
              ]
            );
            out.push({
              collector_id: "identity_entra",
              fingerprint: `entra-connector-error:${conn.id}`,
              name: `Entra ID connector error — ${conn.name}`,
              category: "identity",
              provider: "entra_identity",
              confidence_score: 0.2,
              running_status: "unknown",
              risk_indicators: ["connector_auth_failed"],
              metadata: {
                connectorId: conn.id,
                connectorName: conn.name,
                discoveryMode: "entra-graph-error",
                inventoryClass: "identity_connector",
                error: message
              }
            });
          }
        }
      } catch (err) {
        console.warn("entra identity scan:", err.message);
      }

      return out;
    }
  },

  edr: {
    id: "edr",
    async scan(ctx) {
      const out = [];
      if (!ctx.pool || !ctx.tenantId) return out;

      try {
        const { listActiveEdrConnectors } = await import("../services/connectors.js");
        const { discoverEdrConnector } = await import("./edrIntegrations.js");
        const connectors = await listActiveEdrConnectors(ctx.pool, ctx.tenantId);

        for (const conn of connectors) {
          const label =
            {
              crowdstrike: "CrowdStrike",
              defender: "Microsoft Defender",
              intune: "Microsoft Intune",
              cortex: "Cortex XDR",
              netskope: "Netskope"
            }[conn.provider] || conn.provider;

          try {
            const { observations, stats } = await discoverEdrConnector(conn);
            out.push(...observations);
            if (ctx.pool) {
              await ctx.pool.query(
                `UPDATE connectors SET last_tested_at=NOW(), last_error=NULL, status='active', updated_at=NOW()
                 WHERE id=$1 AND tenant_id=$2`,
                [conn.id, ctx.tenantId]
              );
              await ctx.pool.query(
                `INSERT INTO discovery_events (tenant_id, event_type, severity, message, payload)
                 VALUES ($1,'connector.scan','info',$2,$3::jsonb)`,
                [
                  ctx.tenantId,
                  `EDR connector "${conn.name}" (${label}) discovered ${stats.devices || 0} endpoints — ${stats.message || "ok"}`,
                  JSON.stringify({
                    connectorId: conn.id,
                    provider: conn.provider,
                    category: "edr",
                    ...stats
                  })
                ]
              );
            }
          } catch (err) {
            const message = err.message || String(err);
            console.warn("EDR connector scan failed:", conn.provider, message);
            if (ctx.pool) {
              await ctx.pool.query(
                `UPDATE connectors SET status='error', last_tested_at=NOW(), last_error=$3, updated_at=NOW()
                 WHERE id=$1 AND tenant_id=$2`,
                [conn.id, ctx.tenantId, message]
              );
              await ctx.pool.query(
                `INSERT INTO discovery_events (tenant_id, event_type, severity, message, payload)
                 VALUES ($1,'connector.scan.error','error',$2,$3::jsonb)`,
                [
                  ctx.tenantId,
                  `EDR connector "${conn.name}" (${label}) failed: ${message}`,
                  JSON.stringify({ connectorId: conn.id, provider: conn.provider, category: "edr" })
                ]
              );
            }
            out.push({
              collector_id: "edr",
              fingerprint: `edr-connector-error:${conn.provider}:${conn.id}`,
              name: `${label} connector error — ${conn.name}`,
              category: "endpoint",
              provider: conn.provider,
              confidence_score: 0.2,
              running_status: "unknown",
              risk_indicators: ["connector_auth_failed"],
              metadata: {
                connectorId: conn.id,
                connectorName: conn.name,
                discoveryMode: "edr-api-error",
                inventoryClass: "edr_connector",
                error: message
              }
            });
          }
        }
      } catch (err) {
        console.warn("edr connector scan:", err.message);
      }

      return out;
    }
  },

  saas_platform: {
    id: "saas_platform",
    async scan(ctx) {
      const out = [];
      if (!ctx.pool || !ctx.tenantId) return out;

      try {
        const { listActiveSaasConnectors } = await import("../services/connectors.js");
        const { discoverSaasConnector } = await import("./saasPlatforms.js");
        const connectors = await listActiveSaasConnectors(ctx.pool, ctx.tenantId);

        for (const conn of connectors) {
          const label =
            {
              m365_copilot: "Microsoft 365 Copilot",
              salesforce: "Salesforce Agentforce",
              workday: "Workday",
              servicenow: "ServiceNow"
            }[conn.provider] || conn.provider;

          try {
            const { observations, stats } = await discoverSaasConnector(conn);
            out.push(...observations);
            if (ctx.pool) {
              await ctx.pool.query(
                `UPDATE connectors SET last_tested_at=NOW(), last_error=NULL, status='active', updated_at=NOW()
                 WHERE id=$1 AND tenant_id=$2`,
                [conn.id, ctx.tenantId]
              );
              await ctx.pool.query(
                `INSERT INTO discovery_events (tenant_id, event_type, severity, message, payload)
                 VALUES ($1,'connector.scan','info',$2,$3::jsonb)`,
                [
                  ctx.tenantId,
                  `SaaS platform "${conn.name}" (${label}) discovered ${stats.agents || 0} agents — ${stats.message || "ok"}`,
                  JSON.stringify({
                    connectorId: conn.id,
                    provider: conn.provider,
                    category: "saas",
                    ...stats
                  })
                ]
              );
            }
          } catch (err) {
            const message = err.message || String(err);
            console.warn("SaaS platform scan failed:", conn.provider, message);
            if (ctx.pool) {
              await ctx.pool.query(
                `UPDATE connectors SET status='error', last_tested_at=NOW(), last_error=$3, updated_at=NOW()
                 WHERE id=$1 AND tenant_id=$2`,
                [conn.id, ctx.tenantId, message]
              );
              await ctx.pool.query(
                `INSERT INTO discovery_events (tenant_id, event_type, severity, message, payload)
                 VALUES ($1,'connector.scan.error','error',$2,$3::jsonb)`,
                [
                  ctx.tenantId,
                  `SaaS platform "${conn.name}" (${label}) failed: ${message}`,
                  JSON.stringify({ connectorId: conn.id, provider: conn.provider, category: "saas" })
                ]
              );
            }
            out.push({
              collector_id: "saas_platform",
              fingerprint: `saas-connector-error:${conn.provider}:${conn.id}`,
              name: `${label} connector error — ${conn.name}`,
              category: "saas",
              provider: conn.provider,
              confidence_score: 0.2,
              running_status: "unknown",
              risk_indicators: ["connector_auth_failed"],
              metadata: {
                connectorId: conn.id,
                connectorName: conn.name,
                discoveryMode: "saas-platform-error",
                inventoryClass: "saas_connector",
                error: message
              }
            });
          }
        }
      } catch (err) {
        console.warn("saas platform scan:", err.message);
      }

      return out;
    }
  }
};

export const DEFAULT_COLLECTORS = [
  "demo",
  "ide_filesystem",
  "process",
  "mcp",
  "cloud_stub",
  "k8s_api",
  "git_sources",
  "identity_entra",
  "edr",
  "saas_platform"
];

/** Production-safe collectors (no demo / sample stubs) */
export const PRODUCTION_COLLECTORS = [
  "ide_filesystem",
  "process",
  "mcp",
  "cloud_stub",
  "k8s_api",
  "git_sources",
  "identity_entra",
  "edr",
  "saas_platform"
];

export const ALL_COLLECTOR_IDS = Object.keys(collectors);

export async function runCollectors(collectorIds, ctx) {
  const ids = collectorIds?.length ? collectorIds : DEFAULT_COLLECTORS;
  const observations = [];
  for (const id of ids) {
    const collector = collectors[id];
    if (!collector) continue;
    try {
      const batch = await collector.scan(ctx);
      observations.push(...batch);
    } catch (err) {
      observations.push({
        collector_id: id,
        fingerprint: `error:${id}:${Date.now()}`,
        name: `Collector error — ${id}`,
        category: "unknown",
        confidence_score: 0,
        metadata: { error: String(err.message || err) },
        _error: true
      });
    }
  }
  return observations.filter((o) => !o._error);
}
