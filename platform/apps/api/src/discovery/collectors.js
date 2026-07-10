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
          const connectors = await listActiveCloudConnectors(ctx.pool, ctx.tenantId);

          for (const conn of connectors) {
            if (conn.provider === "azure") {
              try {
                const { observations, stats } = await discoverAzureConnector(conn);
                out.push(...observations);
                if (ctx.pool) {
                  await ctx.pool.query(
                    `INSERT INTO discovery_events (tenant_id, event_type, severity, message, payload)
                     VALUES ($1,'connector.scan','info',$2,$3::jsonb)`,
                    [
                      ctx.tenantId,
                      `Azure connector "${conn.name}" scanned ${stats.totalResourcesScanned} resources, found ${stats.aiRelevantResources} AI-relevant`,
                      JSON.stringify({
                        connectorId: conn.id,
                        provider: "azure",
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
                console.warn("Azure connector scan failed:", message);
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
                      `Azure connector "${conn.name}" failed: ${message}`,
                      JSON.stringify({ connectorId: conn.id, provider: "azure" })
                    ]
                  );
                }
                out.push({
                  collector_id: "cloud_stub",
                  fingerprint: `azure-connector-error:${conn.id}`,
                  name: `Azure connector error — ${conn.name}`,
                  category: "cloud",
                  cloud_provider: "azure",
                  confidence_score: 0.2,
                  running_status: "unknown",
                  risk_indicators: ["connector_auth_failed"],
                  metadata: {
                    connectorId: conn.id,
                    connectorName: conn.name,
                    discoveryMode: "azure-arm-error",
                    error: message
                  }
                });
              }
              continue;
            }

            // AWS/GCP: credentialed placeholder until live adapters land
            out.push({
              collector_id: "cloud_stub",
              fingerprint: `cloud-connector:${conn.provider}:${conn.id}`,
              name: `${conn.provider.toUpperCase()} connector — ${conn.name}`,
              category: "cloud",
              cloud_provider: conn.provider === "gcp" ? "gcp" : conn.provider,
              region: conn.config.region || null,
              provider: conn.provider,
              deployment_type: "cloud",
              running_status: "unknown",
              confidence_score: 0.55,
              metadata: {
                connectorId: conn.id,
                connectorName: conn.name,
                discoveryMode: "credentialed-connector-pending-live-adapter",
                environment: conn.environment
              }
            });
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
  }
};

export const DEFAULT_COLLECTORS = ["demo", "ide_filesystem", "process", "mcp", "cloud_stub", "k8s_stub"];

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
