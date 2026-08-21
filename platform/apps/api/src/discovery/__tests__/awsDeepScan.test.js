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
  mapBedrockAgentLifecycleDeep,
  pickBedrockAgentVersion,
  normalizeAgentKnowledgeBase,
  buildBedrockDeepProfile,
  seedDataClassHints,
  summarizeActionGroup
} from "../awsDeepScan.js";
import { buildAgentAndRuntime, sanitizeCloudError } from "../cloudDiscoveryCommon.js";

describe("awsDeepScan summaries", () => {
  it("maps Bedrock GetAgent detail without claiming continuous runtime", () => {
    const summary = summarizeBedrockAgentDetail({
      agentId: "A1",
      agentName: "support",
      agentArn: "arn:aws:bedrock:us-east-1:123:agent/A1",
      agentStatus: "PREPARED",
      foundationModel: "anthropic.claude-v2",
      instruction: "You are a helpful agent. Use tools carefully. Never invent PHI.",
      agentResourceRoleArn: "arn:aws:iam::123:role/BedrockRole",
      guardrailConfiguration: { guardrailIdentifier: "g1", guardrailVersion: "1" },
      memoryConfiguration: { enabledMemoryTypes: ["SESSION_SUMMARY"], storageDays: 30 },
      promptOverrideConfiguration: { promptConfigurations: [{ promptType: "ORCHESTRATION" }] },
      updatedAt: "2026-01-01T00:00:00Z"
    });
    assert.equal(summary.deepScan, "bedrock_get_agent");
    assert.equal(summary.schemaVersion, "aws-deep.v2");
    assert.equal(summary.foundationModel, "anthropic.claude-v2");
    assert.equal(summary.agentRuntimeStatus, "unknown");
    assert.equal(summary.guardrails.present, true);
    assert.equal(summary.memoryConfiguration.enabled, true);
    assert.equal(summary.promptOverride.present, true);
    assert.ok(summary.instructionHash);
    assert.match(summary.runtimeStatusReason || "", /request-driven/i);
  });

  it("builds nested deep profile without instructionFull", () => {
    const summary = summarizeBedrockAgentDetail({
      agentId: "A1",
      agentStatus: "PREPARED",
      foundationModel: "anthropic.claude-3",
      instruction: "help with claims and patient data",
      agentResourceRoleArn: "arn:aws:iam::123:role/ClaimsRole"
    });
    const profile = buildBedrockDeepProfile(summary, {
      agentVersionUsed: "1",
      actionGroups: [{ actionGroupName: "claims-tools", functionCount: 1 }],
      actionGroupCount: 1,
      tools: [
        {
          name: "lookup_claim",
          description: "get claim",
          parameters_schema: null,
          permissions: [],
          risk_flags: { can_access_phi: true },
          source: "bedrock_action_group:claims-tools",
          confidence: "high"
        }
      ],
      knowledgeBases: [{ id: "KB1", name: "claims-kb", state: "ENABLED" }],
      knowledgeBaseCount: 1
    });
    assert.equal(profile.schemaVersion, "aws-deep.v2");
    assert.equal(profile.toolCount, 1);
    assert.equal(profile.knowledgeBases[0].name, "claims-kb");
    assert.equal(profile.identity.name, "ClaimsRole");
    assert.equal(profile.instructions.present, true);
    assert.equal("instructionFull" in profile, false);
  });

  it("picks prepared agent version over DRAFT", () => {
    assert.equal(
      pickBedrockAgentVersion({ agentVersion: "DRAFT" }, [{ agentVersion: "3", agentStatus: "PREPARED" }]),
      "3"
    );
    assert.equal(pickBedrockAgentVersion({ latestAgentVersion: "2" }, []), "2");
    assert.equal(pickBedrockAgentVersion({}, []), "DRAFT");
  });

  it("normalizes KB rows and seeds PHI/PII hints", () => {
    const kb = normalizeAgentKnowledgeBase(
      { knowledgeBaseId: "KB1", knowledgeBaseState: "ENABLED" },
      { knowledgeBaseId: "KB1", name: "clinical-notes", description: "patient charts", status: "ACTIVE" }
    );
    assert.equal(kb.name, "clinical-notes");
    assert.equal(kb.sensitivity, "phi");
    const hints = seedDataClassHints({
      knowledgeBases: [kb],
      tools: [{ name: "x", description: "y", risk_flags: { can_access_phi: true } }],
      description: "claims agent"
    });
    assert.ok(hints.dataClasses.includes("phi"));
    assert.equal(hints.primaryDataClass, "phi");
  });

  it("maps SageMaker DescribeEndpoint to host/model runtime only", () => {
    const summary = summarizeSageMakerEndpointDetail({
      EndpointName: "ep1",
      EndpointArn: "arn:aws:sagemaker:us-east-1:123:endpoint/ep1",
      EndpointStatus: "InService",
      EndpointConfigName: "ep1-config",
      ProductionVariants: [{ VariantName: "AllTraffic", CurrentInstanceCount: 1 }]
    });
    assert.equal(summary.runtimeStatus, "running");
    assert.equal(summary.endpointConfigName, "ep1-config");
    assert.equal(summary.schemaVersion, "aws-deep.v2");
  });

  it("keeps Lambda env names only — never values", () => {
    const summary = summarizeLambdaConfiguration({
      FunctionName: "ai-bot",
      FunctionArn: "arn:aws:lambda:us-east-1:123:function:ai-bot",
      State: "Active",
      Runtime: "nodejs20.x",
      VpcConfig: { VpcId: "vpc-1", SubnetIds: ["subnet-1"] },
      Layers: [{ Arn: "arn:aws:lambda:us-east-1:123:layer:x:1" }],
      Environment: {
        Variables: {
          OPENAI_API_KEY: "sk-secret-should-not-appear",
          MODEL_NAME: "gpt-4"
        }
      }
    });
    assert.equal(summary.deepScan, "lambda_get_configuration");
    assert.ok(summary.envNames.some((n) => /OPENAI_API_KEY/.test(n)));
    assert.equal(summary.vpcConfigured, true);
    assert.equal(summary.layers.length, 1);
    assert.equal(JSON.stringify(summary).includes("sk-secret"), false);
    assert.equal(summary.runtimeStatus, "running");
  });

  it("keeps PREPARED lifecycle as unknown runtime", () => {
    assert.equal(mapBedrockAgentLifecycleDeep("PREPARED").runtimeStatus, "unknown");
  });

  it("summarizes action groups", () => {
    const ag = summarizeActionGroup(
      { actionGroupId: "ag1", actionGroupName: "tools" },
      {
        actionGroupId: "ag1",
        actionGroupName: "tools",
        actionGroupExecutor: { lambda: "arn:aws:lambda:us-east-1:123:function:fn" },
        functionSchema: { functions: [{ name: "a" }, { name: "b" }] }
      }
    );
    assert.equal(ag.functionCount, 2);
    assert.match(ag.lambdaExecutor, /function:fn/);
  });
});

describe("awsDeepScan enrichment", () => {
  it("enriches Bedrock agents with full deep profile via injected awsJson", async () => {
    const discoveryErrors = [];
    const observations = [
      {
        name: "claims-intake (AI)",
        model: "bedrock-agent",
        agent: buildAgentAndRuntime({
          agentDetected: true,
          detectionMethod: "bedrock_agents_api",
          agentId: "A1",
          agentName: "claims-intake",
          agentStatus: "confirmed",
          agentRuntimeStatus: "unknown"
        }).agent,
        runtime: { detected: false, status: null },
        metadata: {
          awsType: "BedrockAgent",
          agentId: "A1",
          evidence: ["list"],
          aliases: ["PROD"]
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
      const path = String(req.path || "");
      const method = String(req.method || "GET").toUpperCase();

      if (path.match(/\/agents\/[^/]+\/$/) && method === "GET") {
        return {
          agent: {
            agentId: "A1",
            agentName: "claims-intake",
            agentStatus: "PREPARED",
            foundationModel: "anthropic.claude-3",
            instruction: "Help with claims and patient eligibility. Use tools.",
            agentResourceRoleArn: "arn:aws:iam::123:role/ClaimsRole",
            guardrailConfiguration: { guardrailIdentifier: "g1", guardrailVersion: "DRAFT" },
            latestAgentVersion: "2"
          }
        };
      }
      if (path.includes("/agentversions/") && method === "POST" && !path.includes("actiongroups") && !path.includes("knowledgebases")) {
        return {
          agentVersionSummaries: [{ agentVersion: "2", agentStatus: "PREPARED" }]
        };
      }
      if (path.includes("/actiongroups/") && method === "POST") {
        return {
          actionGroupSummaries: [
            { actionGroupId: "AG1", actionGroupName: "claims-tools", actionGroupState: "ENABLED" }
          ]
        };
      }
      if (path.includes("/actiongroups/") && method === "GET") {
        return {
          agentActionGroup: {
            actionGroupId: "AG1",
            actionGroupName: "claims-tools",
            actionGroupExecutor: { lambda: "arn:aws:lambda:us-east-1:123:function:claims" },
            functionSchema: {
              functions: [
                {
                  name: "lookup_claim",
                  description: "Lookup patient claim",
                  parameters: { claim_id: { type: "string", required: true } }
                }
              ]
            }
          }
        };
      }
      if (path.includes("/knowledgebases/") && method === "POST" && path.includes("/agents/")) {
        return {
          agentKnowledgeBaseSummaries: [
            { knowledgeBaseId: "KB1", knowledgeBaseState: "ENABLED" }
          ]
        };
      }
      if (path.match(/\/knowledgebases\/[^/]+\/$/) && method === "GET") {
        return {
          knowledgeBase: {
            knowledgeBaseId: "KB1",
            name: "claims-kb",
            description: "clinical claims corpus",
            status: "ACTIVE"
          }
        };
      }
      if (req.headers?.["X-Amz-Target"] === "SageMaker.DescribeEndpoint") {
        return { EndpointStatus: "InService", EndpointConfigName: "cfg", EndpointName: "ep1" };
      }
      if (path.includes("/configuration")) {
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
    assert.ok(calls >= 5);
    assert.equal(observations[0].metadata.deepScan, "bedrock_get_agent");
    assert.equal(observations[0].metadata.deepScanSchema, "aws-deep.v2");
    assert.equal(observations[0].metadata.agentVersionUsed, "2");
    assert.ok(observations[0].metadata.deep);
    assert.equal(observations[0].metadata.deep.toolCount, 1);
    assert.equal(observations[0].metadata.deep.tools[0].name, "lookup_claim");
    assert.equal(observations[0].metadata.deep.knowledgeBases[0].name, "claims-kb");
    assert.equal(observations[0].metadata.deep.identity.name, "ClaimsRole");
    assert.equal("instructionFull" in observations[0].metadata.deep, false);
    assert.ok(observations[0].metadata.knowledgeSources.includes("claims-kb"));
    assert.ok(observations[0].metadata.adversarial_surface);
    assert.equal(observations[0].metadata.adversarial_surface.category, "agent");
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
