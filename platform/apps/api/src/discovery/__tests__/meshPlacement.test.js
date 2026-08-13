import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildAgentMeshPlacement } from "../../services/agentDepth.js";

describe("buildAgentMeshPlacement cloud vs endpoint", () => {
  it("places Bedrock agents on SaaS plane / SaaS lane — not Endpoint", () => {
    const mesh = buildAgentMeshPlacement({
      collector_id: "cloud_aws",
      name: "support-bot (AI)",
      category: "cloud",
      cloud_provider: "aws",
      provider: "aws",
      deployment_type: "cloud",
      framework: "BedrockAgent",
      metadata: {
        awsType: "BedrockAgent",
        inventoryClass: "ai_cloud_agent",
        agentStatus: "confirmed"
      }
    });
    assert.equal(mesh.agentPlane, "saas_third_party");
    assert.equal(mesh.environmentLane, "saas");
  });

  it("does not treat SageMakerEndpoint as EDR endpoint plane", () => {
    const mesh = buildAgentMeshPlacement({
      collector_id: "cloud_aws",
      name: "chat-ep (AI)",
      category: "cloud",
      cloud_provider: "aws",
      provider: "aws",
      deployment_type: "cloud",
      framework: "SageMakerEndpoint",
      metadata: {
        awsType: "SageMakerEndpoint",
        inventoryClass: "ai_cloud_resource",
        endpointStatus: "InService"
      }
    });
    assert.equal(mesh.agentPlane, "saas_third_party");
    assert.equal(mesh.environmentLane, "saas");
    assert.notEqual(mesh.agentPlane, "endpoint");
  });

  it("places AI Lambda on serverless plane", () => {
    const mesh = buildAgentMeshPlacement({
      collector_id: "cloud_aws",
      name: "ai-worker (AI)",
      category: "cloud",
      cloud_provider: "aws",
      provider: "aws",
      deployment_type: "cloud",
      framework: "LambdaFunction",
      metadata: { awsType: "LambdaFunction", inventoryClass: "ai_cloud_agent" }
    });
    assert.equal(mesh.agentPlane, "serverless");
  });

  it("keeps EDR devices on endpoint plane / endpoints lane", () => {
    const mesh = buildAgentMeshPlacement({
      collector_id: "edr",
      name: "laptop-1 (AI candidate host)",
      category: "endpoint",
      provider: "crowdstrike",
      deployment_type: "endpoint",
      metadata: { inventoryClass: "endpoint_ai_agent", edrProvider: "crowdstrike" }
    });
    assert.equal(mesh.agentPlane, "endpoint");
    assert.equal(mesh.environmentLane, "endpoints");
  });

  it("reclassifies previously pinned cloud→endpoint mesh metadata", () => {
    const mesh = buildAgentMeshPlacement({
      collector_id: "cloud_aws",
      name: "bedrock-agent (AI)",
      category: "cloud",
      cloud_provider: "aws",
      provider: "aws",
      deployment_type: "cloud",
      framework: "BedrockAgent",
      metadata: {
        awsType: "BedrockAgent",
        mesh: { agentPlane: "endpoint", environmentLane: "endpoints" }
      }
    });
    assert.equal(mesh.agentPlane, "saas_third_party");
    assert.equal(mesh.environmentLane, "saas");
  });
});
