import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  summarizeBedrockAgentDetail,
  summarizeSageMakerEndpointDetail,
  summarizeLambdaConfiguration,
  enrichAwsWithDeepScan,
  getBedrockAgent,
  describeSageMakerEndpoint,
  getLambdaFunctionConfiguration,
  mapBedrockAgentLifecycleDeep
} from "../awsDeepScan.js";
import { buildAgentAndRuntime, sanitizeCloudError } from "../cloudDiscoveryCommon.js";

describe("awsDeepScan summaries", () => {
  it("maps Bedrock GetAgent detail without claiming continuous runtime", () => {
    const summary = summarizeBedrockAgentDetail({
      agentId: "A1",
      agentName: "support",
      agentStatus: "PREPARED",
      foundationModel: "anthropic.claude-v2",
      instruction: "You are a helpful agent",
      updatedAt: "2026-01-01T00:00:00Z"
    });
    assert.equal(summary.deepScan, "bedrock_get_agent");
    assert.equal(summary.foundationModel, "anthropic.claude-v2");
    assert.equal(summary.agentRuntimeStatus, "unknown");
    assert.match(summary.runtimeStatusReason || "", /request-driven/i);
  });

  it("maps SageMaker DescribeEndpoint to host/model runtime only", () => {
    const summary = summarizeSageMakerEndpointDetail({
      EndpointName: "ep1",
      EndpointStatus: "InService",
      EndpointConfigName: "ep1-config",
      ProductionVariants: [{ VariantName: "AllTraffic", CurrentInstanceCount: 1 }]
    });
    assert.equal(summary.runtimeStatus, "running");
    assert.equal(summary.endpointConfigName, "ep1-config");
  });

  it("keeps Lambda env names only — never values", () => {
    const summary = summarizeLambdaConfiguration({
      FunctionName: "ai-bot",
      State: "Active",
      Runtime: "nodejs20.x",
      Environment: {
        Variables: {
          OPENAI_API_KEY: "sk-secret-should-not-appear",
          MODEL_NAME: "gpt-4"
        }
      }
    });
    assert.equal(summary.deepScan, "lambda_get_configuration");
    assert.ok(summary.envNames.some((n) => /OPENAI_API_KEY/.test(n)));
    assert.equal(JSON.stringify(summary).includes("sk-secret"), false);
    assert.equal(summary.runtimeStatus, "running");
  });

  it("keeps PREPARED lifecycle as unknown runtime", () => {
    assert.equal(mapBedrockAgentLifecycleDeep("PREPARED").runtimeStatus, "unknown");
  });
});

describe("awsDeepScan enrichment", () => {
  it("enriches Bedrock agents via injected awsJson and isolates failures", async () => {
    const discoveryErrors = [];
    const observations = [
      {
        name: "support (AI)",
        model: "bedrock-agent",
        agent: buildAgentAndRuntime({
          agentDetected: true,
          detectionMethod: "bedrock_agents_api",
          agentId: "A1",
          agentName: "support",
          agentStatus: "confirmed",
          agentRuntimeStatus: "unknown"
        }).agent,
        runtime: { detected: false, status: null },
        metadata: {
          awsType: "BedrockAgent",
          agentId: "A1",
          evidence: ["list"]
        }
      },
      {
        name: "ep1 (AI)",
        running_status: "unknown",
        runtime: { detected: true, status: "unknown" },
        metadata: { awsType: "SageMakerEndpoint", evidence: [] }
      },
      {
        name: "ai-bot (AI)",
        agent: buildAgentAndRuntime({
          agentDetected: true,
          detectionMethod: "runtime_heuristic",
          agentName: "ai-bot",
          agentStatus: "candidate",
          agentRuntimeStatus: "unknown"
        }).agent,
        runtime: { detected: true, status: "running" },
        metadata: { awsType: "LambdaFunction", evidence: [], agentStatus: "candidate" }
      }
    ];

    let calls = 0;
    const awsJson = async (req) => {
      calls += 1;
      if (String(req.path || "").includes("/agents/")) {
        return {
          agent: {
            agentId: "A1",
            agentStatus: "PREPARED",
            foundationModel: "anthropic.claude-3",
            instruction: "help"
          }
        };
      }
      if (req.headers?.["X-Amz-Target"] === "SageMaker.DescribeEndpoint") {
        return { EndpointStatus: "InService", EndpointConfigName: "cfg" };
      }
      if (String(req.path || "").includes("/configuration")) {
        return {
          State: "Active",
          Runtime: "python3.12",
          Environment: { Variables: { SECRET_TOKEN: "nope", MODEL: "x" } }
        };
      }
      return { __error: true, permissionDenied: true, message: "denied", status: 403 };
    };

    const result = await enrichAwsWithDeepScan({
      awsJson,
      conn: { id: "c1", name: "aws" },
      region: "us-east-1",
      observations,
      discoveryErrors,
      enabled: true
    });

    assert.equal(result.deepScanned, 3);
    assert.equal(calls, 3);
    assert.equal(observations[0].metadata.deepScan, "bedrock_get_agent");
    assert.equal(observations[0].agent.runtimeStatus, "unknown");
    assert.equal(observations[1].runtime.status, "running");
    assert.equal(observations[2].metadata.agentStatus, "candidate");
    assert.equal(JSON.stringify(observations).includes("nope"), false);
  });

  it("records permission_denied and continues", async () => {
    const discoveryErrors = [];
    const awsJson = async () => ({
      __error: true,
      permissionDenied: true,
      status: 403,
      message: "Forbidden"
    });
    const detail = await getBedrockAgent(awsJson, {}, "us-east-1", "A1", discoveryErrors);
    assert.equal(detail, null);
    assert.equal(discoveryErrors[0].discoveryStatus, "permission_denied");

    const ep = await describeSageMakerEndpoint(awsJson, {}, "us-east-1", "ep", discoveryErrors);
    assert.equal(ep, null);
    const fn = await getLambdaFunctionConfiguration(awsJson, {}, "us-east-1", "fn", discoveryErrors);
    assert.equal(fn, null);
    assert.equal(discoveryErrors.length, 3);
  });

  it("sanitizes deep-scan errors", () => {
    const msg = sanitizeCloudError("Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.aaa.bbb failed");
    assert.equal(msg.includes("eyJhbGci"), false);
  });

  it("no-ops when deep scan disabled", async () => {
    const observations = [{ metadata: { awsType: "BedrockAgent", agentId: "A1" } }];
    const result = await enrichAwsWithDeepScan({
      awsJson: async () => {
        throw new Error("should not call");
      },
      conn: {},
      region: "us-east-1",
      observations,
      enabled: false
    });
    assert.equal(result.deepScanned, 0);
  });
});
