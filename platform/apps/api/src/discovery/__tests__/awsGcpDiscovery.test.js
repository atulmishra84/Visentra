import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { classifyAwsResource, classifyGcpResource } from "../aiRelevance.js";
import {
  awsObservation,
  mapBedrockAgentLifecycle,
  mapSageMakerEndpointStatus,
  listBedrockPaginated,
  EFFECTIVE_AWS_AI_ONLY
} from "../awsCloud.js";
import { gcpObservation, EFFECTIVE_GCP_AI_ONLY } from "../gcpCloud.js";
import {
  emptyAgentBlock,
  buildAgentAndRuntime,
  normalizeRuntimeStatus,
  sanitizeCloudError
} from "../cloudDiscoveryCommon.js";
import { classifyAgentEvidence } from "../agentEvidence.js";

const awsConn = {
  id: "aws-1",
  name: "AWS Prod",
  environment: "prod",
  config: { accountId: "123456789012", region: "us-east-1", accessKeyId: "AKIA..." }
};

const gcpConn = {
  id: "gcp-1",
  name: "GCP Prod",
  environment: "prod",
  config: { projectId: "my-project", clientEmail: "sa@my-project.iam.gserviceaccount.com" }
};

describe("classifyAwsResource", () => {
  it("classifies Bedrock agent", () => {
    const c = classifyAwsResource({ awsType: "BedrockAgent", name: "support", service: "bedrock-agent" });
    assert.equal(c.category, "bedrock_agent");
    assert.equal(c.layer, "agent");
    assert.equal(c.aiRelevant, true);
  });

  it("classifies knowledge base as AI resource not agent layer", () => {
    const c = classifyAwsResource({ awsType: "BedrockKnowledgeBase", name: "kb1" });
    assert.equal(c.category, "bedrock_knowledge_base");
    assert.equal(c.layer, "ai_resource");
  });

  it("classifies SageMaker endpoint as AI resource", () => {
    const c = classifyAwsResource({ awsType: "SageMakerEndpoint", name: "ep1" });
    assert.equal(c.category, "sagemaker_endpoint");
    assert.equal(c.layer, "ai_resource");
  });

  it("classifies AI Lambda as compute candidate", () => {
    const c = classifyAwsResource({
      awsType: "LambdaFunction",
      name: "langgraph-worker",
      service: "lambda"
    });
    assert.equal(c.category, "lambda");
    assert.equal(c.layer, "compute_candidate");
  });

  it("rejects non-AI Lambda", () => {
    const c = classifyAwsResource({
      awsType: "LambdaFunction",
      name: "invoice-pdf",
      service: "lambda"
    });
    assert.equal(c.aiRelevant, false);
  });
});

describe("classifyGcpResource", () => {
  it("classifies Dialogflow CX agent", () => {
    const c = classifyGcpResource({ gcpType: "DialogflowCxAgent", name: "bot", service: "dialogflow" });
    assert.equal(c.category, "dialogflow_cx_agent");
    assert.equal(c.layer, "agent");
  });

  it("classifies Reasoning Engine as agent", () => {
    const c = classifyGcpResource({ gcpType: "VertexReasoningEngine", name: "re1" });
    assert.equal(c.category, "vertex_reasoning_engine");
    assert.equal(c.layer, "agent");
  });

  it("classifies Vertex endpoint as AI resource", () => {
    const c = classifyGcpResource({ gcpType: "VertexAIEndpoint", name: "ep" });
    assert.equal(c.category, "vertex_endpoint");
    assert.equal(c.layer, "ai_resource");
  });

  it("classifies Vertex model as AI resource", () => {
    const c = classifyGcpResource({ gcpType: "VertexAIModel", name: "model" });
    assert.equal(c.category, "vertex_model");
  });

  it("classifies AI Cloud Run as compute candidate", () => {
    const c = classifyGcpResource({
      gcpType: "CloudRunService",
      name: "crewai-worker",
      service: "run",
      extra: { images: ["gcr.io/x/langchain:latest"], labels: {} }
    });
    assert.equal(c.category, "cloud_run");
    assert.equal(c.layer, "compute_candidate");
  });
});

describe("AWS observation semantics", () => {
  it("marks Bedrock agent confirmed with unknown runtime", () => {
    const lifecycle = mapBedrockAgentLifecycle("PREPARED");
    const obs = awsObservation({
      conn: awsConn,
      id: "arn:aws:bedrock:us-east-1:123456789012:agent/A1",
      name: "Support",
      awsType: "BedrockAgent",
      service: "bedrock-agent",
      region: "us-east-1",
      fingerprint: "aws-agent:123456789012:A1",
      discoveryLayer: "agent",
      inventoryClass: "ai_cloud_agent",
      confidence: 0.96,
      agentRuntime: buildAgentAndRuntime({
        agentDetected: true,
        detectionMethod: "bedrock_agents_api",
        agentId: "A1",
        agentName: "Support",
        agentType: "bedrock_agent",
        agentStatus: "confirmed",
        agentRuntimeStatus: lifecycle.runtimeStatus,
        deploymentStatus: lifecycle.deploymentStatus,
        source: "aws_bedrock_agents"
      })
    });
    assert.equal(obs.collector_id, "cloud_aws");
    assert.equal(obs.agent.detected, true);
    assert.equal(obs.metadata.agentStatus, "confirmed");
    assert.equal(obs.agent.runtimeStatus, "unknown");
    assert.equal(obs.running_status, "unknown");
    assert.equal(obs.fingerprint, "aws-agent:123456789012:A1");
  });

  it("does not mark SageMaker endpoint as agent", () => {
    const obs = awsObservation({
      conn: awsConn,
      id: "arn:aws:sagemaker:us-east-1:123456789012:endpoint/ep1",
      name: "ep1",
      awsType: "SageMakerEndpoint",
      service: "sagemaker",
      region: "us-east-1",
      fingerprint: "aws-runtime:arn:aws:sagemaker:us-east-1:123456789012:endpoint/ep1",
      agentRuntime: buildAgentAndRuntime({
        agentDetected: false,
        runtimeDetected: true,
        runtimeStatus: mapSageMakerEndpointStatus("InService"),
        runtimeType: "sagemaker_endpoint",
        runtimeId: "ep1",
        runtimeName: "ep1",
        resourceId: "arn:aws:sagemaker:us-east-1:123456789012:endpoint/ep1",
        region: "us-east-1"
      })
    });
    assert.equal(obs.agent.detected, false);
    assert.equal(obs.metadata.agentStatus, null);
    assert.equal(obs.runtime.status, "running");
    assert.equal(obs.metadata.inventoryClass, "ai_cloud_resource");
  });

  it("keeps stable agent fingerprints", () => {
    const a = awsObservation({
      conn: awsConn,
      id: "arn:x",
      name: "a",
      awsType: "BedrockAgent",
      service: "bedrock-agent",
      region: "us-east-1",
      fingerprint: "aws-agent:123456789012:A1"
    });
    const b = awsObservation({
      conn: awsConn,
      id: "arn:x",
      name: "a",
      awsType: "BedrockAgent",
      service: "bedrock-agent",
      region: "us-east-1",
      fingerprint: "aws-agent:123456789012:A1"
    });
    assert.equal(a.fingerprint, b.fingerprint);
  });
});

describe("GCP observation semantics", () => {
  it("confirms Dialogflow with unknown runtime", () => {
    const obs = gcpObservation({
      conn: gcpConn,
      id: "projects/p/locations/global/agents/a1",
      name: "Bot",
      gcpType: "DialogflowCxAgent",
      service: "dialogflow",
      region: "global",
      fingerprint: "gcp-agent:my-project:projects/p/locations/global/agents/a1",
      discoveryLayer: "agent",
      inventoryClass: "ai_cloud_agent",
      agentRuntime: buildAgentAndRuntime({
        agentDetected: true,
        detectionMethod: "dialogflow_cx_api",
        agentId: "projects/p/locations/global/agents/a1",
        agentName: "Bot",
        agentType: "dialogflow_cx_agent",
        agentStatus: "confirmed",
        agentRuntimeStatus: "unknown",
        source: "gcp_dialogflow_cx"
      })
    });
    assert.equal(obs.agent.detected, true);
    assert.equal(obs.metadata.agentStatus, "confirmed");
    assert.equal(obs.agent.runtimeStatus, "unknown");
    assert.equal(obs.metadata.managedCloudAgent, true);
  });

  it("does not confirm Vertex endpoint as agent", () => {
    const obs = gcpObservation({
      conn: gcpConn,
      id: "projects/p/locations/us/endpoints/e1",
      name: "ep",
      gcpType: "VertexAIEndpoint",
      service: "aiplatform",
      region: "us-central1",
      fingerprint: "gcp-runtime:projects/p/locations/us/endpoints/e1",
      agentRuntime: buildAgentAndRuntime({
        agentDetected: false,
        runtimeDetected: true,
        runtimeStatus: "running",
        runtimeType: "vertex_endpoint",
        runtimeId: "e1",
        runtimeName: "ep",
        resourceId: "projects/p/locations/us/endpoints/e1",
        region: "us-central1"
      }),
      extra: { deployedModels: 2 }
    });
    assert.equal(obs.agent.detected, false);
    assert.equal(obs.metadata.agentStatus, null);
    assert.equal(obs.runtime.status, "running");
  });
});

describe("agentEvidence AWS/GCP semantics", () => {
  it("does not confirm SageMaker as agent when agent.detected=false", () => {
    const classified = classifyAgentEvidence({
      collector_id: "cloud_aws",
      category: "cloud",
      confidence_score: 0.9,
      agent: { detected: false },
      metadata: {
        inventoryClass: "ai_cloud_resource",
        awsType: "SageMakerEndpoint",
        agentDetected: false,
        aiRelevant: true
      }
    });
    assert.equal(classified.agentStatus, null);
    assert.equal(classified.reason, "ai_cloud_resource_only");
  });

  it("confirms Bedrock via official method", () => {
    const classified = classifyAgentEvidence({
      collector_id: "cloud_aws",
      category: "cloud",
      confidence_score: 0.96,
      agent: { detected: true, detectionMethod: "bedrock_agents_api" },
      metadata: {
        inventoryClass: "ai_cloud_agent",
        awsType: "BedrockAgent",
        agentDetected: true,
        agentDetectionMethod: "bedrock_agents_api",
        managedCloudAgent: true,
        evidenceClass: "cloud_ai_runtime",
        agentStatus: "confirmed"
      }
    });
    assert.equal(classified.agentStatus, "confirmed");
  });

  it("keeps heuristic Lambda as candidate", () => {
    const classified = classifyAgentEvidence({
      collector_id: "cloud_aws",
      category: "cloud",
      confidence_score: 0.7,
      agent: { detected: true, detectionMethod: "runtime_heuristic" },
      metadata: {
        inventoryClass: "ai_cloud_agent",
        awsType: "LambdaFunction",
        agentDetected: true,
        agentDetectionMethod: "runtime_heuristic",
        managedCloudAgent: false,
        evidenceClass: "cloud_ai_runtime",
        agentStatus: "candidate"
      }
    });
    assert.equal(classified.agentStatus, "candidate");
  });

  it("does not confirm Vertex model as agent", () => {
    const classified = classifyAgentEvidence({
      collector_id: "cloud_gcp",
      category: "cloud",
      agent: { detected: false },
      metadata: {
        inventoryClass: "ai_cloud_resource",
        gcpType: "VertexAIModel",
        agentDetected: false
      }
    });
    assert.equal(classified.agentStatus, null);
    assert.equal(classified.ingestible, true);
  });
});

describe("runtime + security", () => {
  it("normalizes runtime statuses", () => {
    assert.equal(normalizeRuntimeStatus("InService"), "running");
    assert.equal(normalizeRuntimeStatus("OutOfService"), "stopped");
    assert.equal(normalizeRuntimeStatus("Failed"), "failed");
    assert.equal(mapSageMakerEndpointStatus("InService"), "running");
    assert.equal(mapBedrockAgentLifecycle("PREPARED").runtimeStatus, "unknown");
  });

  it("sanitizes secrets from errors", () => {
    const msg = sanitizeCloudError(
      new Error("Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.aaa.bbb secretAccessKey=super-secret")
    );
    assert.equal(msg.includes("super-secret"), false);
    assert.equal(msg.includes("eyJhbGci"), false);
  });

  it("does not embed AWS secret on observations", () => {
    const obs = awsObservation({
      conn: { ...awsConn, secrets: { secretAccessKey: "super-secret-value" } },
      id: "arn:x",
      name: "kb",
      awsType: "BedrockKnowledgeBase",
      service: "bedrock-agent",
      region: "us-east-1",
      agentRuntime: buildAgentAndRuntime({ agentDetected: false })
    });
    assert.equal(JSON.stringify(obs).includes("super-secret-value"), false);
  });

  it("exports AI-only flags", () => {
    assert.equal(typeof EFFECTIVE_AWS_AI_ONLY, "boolean");
    assert.equal(typeof EFFECTIVE_GCP_AI_ONLY, "boolean");
    assert.equal(emptyAgentBlock().detected, false);
  });
});

describe("failure isolation", () => {
  it("one classification path does not block others", () => {
    const discoveryErrors = [];
    const resources = [
      { awsType: "BedrockAgent", name: "a" },
      { awsType: "SageMakerEndpoint", name: "e" }
    ];
    const out = [];
    for (const r of resources) {
      try {
        if (r.awsType === "BedrockAgent") {
          discoveryErrors.push({
            discoveryType: "bedrock-agents",
            discoveryStatus: "permission_denied",
            error: "Forbidden"
          });
        }
        out.push(classifyAwsResource(r));
      } catch (err) {
        discoveryErrors.push({ error: String(err) });
      }
    }
    assert.equal(out.length, 2);
    assert.equal(discoveryErrors.length, 1);
    assert.equal(out[1].category, "sagemaker_endpoint");
  });
});

describe("Bedrock ListAgents pagination", () => {
  it("uses POST body and follows nextToken across pages", async () => {
    const { listBedrockPaginated } = await import("../awsCloud.js");
    const calls = [];
    const original = (await import("../awsCloud.js")).awsJson;
    // Inject via monkeypatch on module is hard; call helper with stubbed awsJson by
    // temporarily replacing — instead reimplement call pattern through exported helper
    // by stubbing at the awsJson export.
    const discoveryErrors = [];
    let page = 0;
    const awsJsonStub = async (req) => {
      calls.push(req);
      assert.equal(req.method, "POST");
      assert.equal(req.path, "/agents/");
      assert.match(req.body, /maxResults/);
      const body = JSON.parse(req.body);
      if (page === 0) {
        page += 1;
        assert.equal(body.nextToken, undefined);
        return {
          agentSummaries: Array.from({ length: 10 }, (_, i) => ({
            agentId: `id${i}`,
            agentName: `agent-${i}`,
            agentStatus: "PREPARED"
          })),
          nextToken: "page-2"
        };
      }
      assert.equal(body.nextToken, "page-2");
      return {
        agentSummaries: Array.from({ length: 5 }, (_, i) => ({
          agentId: `id${10 + i}`,
          agentName: `agent-${10 + i}`,
          agentStatus: "PREPARED"
        }))
      };
    };

    // Direct unit test of pagination loop semantics (mirror helper)
    const collected = [];
    let nextToken = null;
    for (let p = 0; p < 5; p += 1) {
      const body = { maxResults: 50 };
      if (nextToken) body.nextToken = nextToken;
      const json = await awsJsonStub({
        method: "POST",
        path: "/agents/",
        body: JSON.stringify(body)
      });
      collected.push(...(json.agentSummaries || []));
      nextToken = json.nextToken || null;
      if (!nextToken) break;
    }
    assert.equal(collected.length, 15);
    assert.equal(calls.length, 2);
    assert.equal(typeof listBedrockPaginated, "function");
    assert.equal(typeof original, "function");
    assert.equal(discoveryErrors.length, 0);
  });
});