import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  identifyLlmTarget,
  discoverApiGatewayConnector,
  validateApiGatewayConnector,
  discoverOtelTracingConnector,
  validateOtelTracingConnector,
  discoverNetworkProxyConnector,
  validateNetworkProxyConnector,
  LLM_TARGET_HOST_PATTERNS
} from "../networkGatewayConnectors.js";

describe("Network, Gateway & Tracing Connectors", () => {
  describe("identifyLlmTarget helper", () => {
    it("identifies major LLM endpoints", () => {
      assert.equal(identifyLlmTarget("https://api.openai.com/v1/chat")?.provider, "openai");
      assert.equal(identifyLlmTarget("https://company.services.ai.azure.com/api")?.provider, "azure");
      assert.equal(identifyLlmTarget("https://api.anthropic.com/v1/messages")?.provider, "anthropic");
      assert.equal(identifyLlmTarget("https://generativelanguage.googleapis.com/v1")?.provider, "gcp");
      assert.equal(identifyLlmTarget("https://bedrock-runtime.us-east-1.amazonaws.com")?.provider, "aws");
      assert.equal(identifyLlmTarget("https://api.groq.com/openai")?.provider, "groq");
      assert.equal(identifyLlmTarget("https://plain-internal-api.company.com"), null);
    });
  });

  describe("API Gateway connector", () => {
    const conn = {
      id: "gw-1",
      name: "Kong Production",
      config: { baseUrl: "https://kong-admin.internal", gatewayType: "kong" },
      secrets: { apiKey: "test-key" }
    };

    it("validates gateway config", async () => {
      const valid = await validateApiGatewayConnector(conn);
      assert.equal(valid.ok, true);

      const invalid = await validateApiGatewayConnector({ config: {} });
      assert.equal(invalid.ok, false);
    });

    it("discovers AI agent routes", async () => {
      const mockRoutes = [
        { id: "r1", name: "openai-proxy", paths: ["/v1/chat"], service: { host: "api.openai.com" } },
        { id: "r2", name: "claude-route", paths: ["/anthropic/v1"], service: { host: "api.anthropic.com" } },
        { id: "r3", name: "user-profile", paths: ["/users"], service: { host: "user-service.internal" } }
      ];

      const { observations, stats } = await discoverApiGatewayConnector(conn, { mockRoutes });
      assert.equal(stats.routesScanned, 3);
      assert.equal(stats.agentsDiscovered, 2);
      assert.equal(observations.length, 2);
      assert.equal(observations[0].name, "API Gateway Route — openai-proxy");
      assert.equal(observations[0].model, "gpt-4o");
      assert.equal(observations[1].model, "claude-3-5-sonnet");
      assert.equal(observations[0].collector_id, "api_gateway");
    });
  });

  describe("OpenTelemetry Tracing connector", () => {
    const conn = {
      id: "otel-1",
      name: "OTel Collector Hub",
      config: { endpoint: "https://otel-collector.internal:4318" },
      secrets: { apiKey: "otel-secret" }
    };

    it("validates OTel endpoint", async () => {
      const valid = await validateOtelTracingConnector(conn);
      assert.equal(valid.ok, true);

      const invalid = await validateOtelTracingConnector({ config: {} });
      assert.equal(invalid.ok, false);
    });

    it("extracts sub-agents, models, and execution hierarchy from GenAI traces", async () => {
      const mockTraces = [
        {
          name: "invoke_agent agent-framework-agent-with-foundry-toolbox",
          traceId: "trace-abc-123",
          attributes: {
            "gen_ai.agent.name": "agent-framework-agent-with-foundry-toolbox",
            "gen_ai.response.model": "gpt-4o-2024-11-20",
            "gen_ai.framework": "azure_agent_framework"
          }
        },
        {
          name: "invoke_agent doc_researcher_subagent",
          traceId: "trace-abc-123",
          attributes: {
            "gen_ai.agent.name": "doc_researcher_subagent",
            "gen_ai.request.model": "gpt-4o-mini",
            "gen_ai.framework": "autogen"
          }
        },
        {
          name: "db_query_users",
          traceId: "trace-abc-123",
          attributes: { "db.system": "postgresql" }
        }
      ];

      const { observations, stats } = await discoverOtelTracingConnector(conn, { mockTraces });
      assert.equal(stats.spansParsed, 3);
      assert.equal(stats.agentsDiscovered, 2);
      assert.equal(observations.length, 2);
      assert.equal(observations[0].name, "agent-framework-agent-with-foundry-toolbox");
      assert.equal(observations[0].model, "gpt-4o-2024-11-20");
      assert.equal(observations[1].name, "doc_researcher_subagent");
      assert.equal(observations[1].model, "gpt-4o-mini");
      assert.equal(observations[0].collector_id, "otel_tracing");
    });
  });

  describe("Network & Proxy connector", () => {
    const conn = {
      id: "proxy-1",
      name: "Squid Egress Proxy",
      config: { logSourceUrl: "https://proxy-logs.internal/access.json", proxyType: "squid" },
      secrets: { apiKey: "proxy-auth" }
    };

    it("validates network proxy endpoint", async () => {
      const valid = await validateNetworkProxyConnector(conn);
      assert.equal(valid.ok, true);

      const invalid = await validateNetworkProxyConnector({ config: {} });
      assert.equal(invalid.ok, false);
    });

    it("detects agent egress traffic to LLM endpoints", async () => {
      const mockLogs = [
        { srcIp: "10.0.12.44", destHost: "api.openai.com", method: "POST", status: 200 },
        { srcIp: "10.0.15.82", destHost: "foundry-baseline.services.ai.azure.com", method: "POST", status: 200 },
        { srcIp: "10.0.2.11", destHost: "internal-wiki.company.com", method: "GET", status: 200 }
      ];

      const { observations, stats } = await discoverNetworkProxyConnector(conn, { mockLogs });
      assert.equal(stats.sessionsAnalyzed, 3);
      assert.equal(stats.agentsDiscovered, 2);
      assert.equal(observations.length, 2);
      assert.match(observations[0].name, /10\.0\.12\.44/);
      assert.equal(observations[0].provider, "openai");
      assert.equal(observations[0].model, "gpt-4o");
      assert.match(observations[1].name, /10\.0\.15\.82/);
      assert.equal(observations[1].provider, "azure");
      assert.equal(observations[0].collector_id, "network_proxy");
    });
  });
});
