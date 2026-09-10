import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  stampAgentIdentification,
  buildAgentIdentification,
  howIdentifiedFromCloud
} from "../agentIdentification.js";
import { enrichObservationWithDepth, buildOwnership } from "../agentDepth.js";

describe("stampAgentIdentification", () => {
  it("copies AWS Bedrock locator fields from obs.agent onto metadata", () => {
    const stamped = stampAgentIdentification({
      cloud_provider: "aws",
      provider: "aws",
      region: "us-east-1",
      endpoint: "arn:aws:bedrock:us-east-1:123456789012:agent/ABCD",
      agent: {
        detected: true,
        detectionMethod: "bedrock_agents_api",
        agentId: "ABCD",
        agentName: "Support",
        agentType: "bedrock_agent"
      },
      metadata: {
        accountId: "123456789012",
        awsType: "BedrockAgent",
        aliases: ["PROD"]
      }
    });
    assert.equal(stamped.metadata.agentId, "ABCD");
    assert.equal(stamped.metadata.agentName, "Support");
    assert.equal(stamped.metadata.agentArn, "arn:aws:bedrock:us-east-1:123456789012:agent/ABCD");
    assert.match(stamped.metadata.howIdentified, /AWS Bedrock ListAgents/);
    assert.match(stamped.metadata.howIdentified, /123456789012/);
    assert.match(stamped.metadata.howIdentified, /ABCD/);
  });

  it("copies Azure Foundry agentId that only lived on obs.agent", () => {
    const stamped = stampAgentIdentification({
      cloud_provider: "azure",
      provider: "azure",
      endpoint: "/subscriptions/sub-1/resourceGroups/rg1/providers/Microsoft.CognitiveServices/accounts/foundry",
      agent: {
        detected: true,
        detectionMethod: "azure_foundry_api",
        agentId: "agent-123",
        agentName: "SupportBot"
      },
      runtime: {
        resourceId: "/subscriptions/sub-1/resourceGroups/rg1/providers/Microsoft.CognitiveServices/accounts/foundry"
      },
      metadata: {
        subscriptionId: "sub-1",
        tenantId: "tenant-1",
        resourceGroup: "rg1",
        azureType: "Microsoft.CognitiveServices/accounts",
        foundrySource: "azure_foundry_agents"
      }
    });
    assert.equal(stamped.metadata.agentId, "agent-123");
    assert.equal(stamped.metadata.azureResourceId, "/subscriptions/sub-1/resourceGroups/rg1/providers/Microsoft.CognitiveServices/accounts/foundry");
    assert.match(stamped.metadata.howIdentified, /azure_foundry_api/);
    assert.match(stamped.metadata.howIdentified, /sub-1/);
  });
});

describe("buildOwnership identity provider", () => {
  it("does not call Azure ARM tenantId an Entra identity provider", () => {
    const ownership = buildOwnership({
      cloud_provider: "azure",
      provider: "azure",
      metadata: {
        tenantId: "tenant-1",
        subscriptionId: "sub-1",
        azureType: "Microsoft.CognitiveServices/accounts",
        agentId: "agent-123"
      }
    });
    assert.equal(ownership.identityProvider, "azure");
    assert.equal(ownership.objectId, null);
    assert.equal(ownership.subscriptionId, "sub-1");
    assert.equal(ownership.agentId, "agent-123");
  });

  it("still labels Entra when objectId is present", () => {
    const ownership = buildOwnership({
      provider: "entra_agent_id",
      metadata: { tenantId: "tenant-1", objectId: "oid-1", appId: "app-1" }
    });
    assert.equal(ownership.identityProvider, "entra");
  });
});

describe("enrichObservationWithDepth identification", () => {
  it("persists identification on metadata and summary", () => {
    const enriched = enrichObservationWithDepth({
      collector_id: "cloud_aws",
      cloud_provider: "aws",
      name: "Support (AI)",
      region: "us-east-1",
      endpoint: "arn:aws:bedrock:us-east-1:123456789012:agent/ABCD",
      agent: {
        detected: true,
        detectionMethod: "bedrock_agents_api",
        agentId: "ABCD",
        agentName: "Support"
      },
      metadata: {
        accountId: "123456789012",
        awsType: "BedrockAgent",
        evidenceClass: "cloud_ai_runtime",
        agentStatus: "confirmed"
      }
    });
    assert.equal(enriched.metadata.agentId, "ABCD");
    assert.equal(enriched.metadata.accountId, "123456789012");
    const ids = buildAgentIdentification(enriched);
    assert.equal(ids.agentId, "ABCD");
    assert.equal(ids.accountId, "123456789012");
    assert.equal(ids.agentArn, "arn:aws:bedrock:us-east-1:123456789012:agent/ABCD");
  });
});

describe("howIdentifiedFromCloud", () => {
  it("prefers Bedrock list wording", () => {
    const text = howIdentifiedFromCloud(
      { cloud_provider: "aws", region: "eu-west-1" },
      { accountId: "111122223333", agentId: "XYZ", managedCloudAgent: true },
      { detectionMethod: "bedrock_agents_api" }
    );
    assert.equal(text, "AWS Bedrock ListAgents · account 111122223333 · agent XYZ · eu-west-1");
  });
});
