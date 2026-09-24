import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  extractFoundryFoundationModel,
  inferFoundryAgentNameFromIdentity,
  isPlaceholderFoundationModel,
  linkEntraIdentitiesToFoundryAgents,
  parseEntraIdentityTags,
  entraAgentIdentityObservation,
  enrichEntraIdentitiesFromFoundryTags,
  foundryProjectEndpointCandidates
} from "../azureDeepScan.js";
import { enrichAgentRow } from "../../services/agentDepth.js";

describe("Foundry vs Entra Agent ID model", () => {
  it("treats microsoft-agent-identity as a placeholder, not a model", () => {
    assert.equal(isPlaceholderFoundationModel("microsoft-agent-identity"), true);
    assert.equal(isPlaceholderFoundationModel("gpt-4o"), false);
    assert.equal(isPlaceholderFoundationModel("gpt-4o-mini"), false);
  });

  it("extracts GPT-4o from Foundry definition.model", () => {
    assert.equal(
      extractFoundryFoundationModel(
        { name: "ai-red-team" },
        { definition: { kind: "prompt", model: "gpt-4o" } }
      ),
      "gpt-4o"
    );
    assert.equal(
      extractFoundryFoundationModel({ model: { name: "gpt-4o" } }, {}),
      "gpt-4o"
    );
    assert.equal(
      extractFoundryFoundationModel({ kind: "prompt" }, { definition: { kind: "prompt" } }),
      null
    );
  });

  it("parses Foundry linkage from Entra Agent ID tags", () => {
    const tags = parseEntraIdentityTags([
      "region:eastus2",
      "agentGuid:57076efe-4899-4742-848b-038a770584c3",
      "virtualWorkspaceId:95816eda-beb5-4045-bcae-81a86861345f",
      "projectId:foundry-baseline-agents-resource@foundry-baseline-agents@AML"
    ]);
    assert.equal(tags.agentGuid, "57076efe-4899-4742-848b-038a770584c3");
    assert.equal(tags.accountName, "foundry-baseline-agents-resource");
    assert.equal(tags.projectName, "foundry-baseline-agents");
    assert.equal(tags.region, "eastus2");
  });

  it("infers Foundry agent name from Entra display name", () => {
    const tags = parseEntraIdentityTags([
      "projectId:foundry-baseline-agents-resource@foundry-baseline-agents@AML"
    ]);
    assert.equal(
      inferFoundryAgentNameFromIdentity(
        "foundry-baseline-agents-resource-foundry-baseline-agents-ai-red-team-AgentIdentity (Entra Agent ID)",
        tags
      ),
      "ai-red-team"
    );
  });

  it("does not invent a model on the Entra identity observation", () => {
    const obs = entraAgentIdentityObservation(
      {
        id: "ea1ab011-00dc-4f7a-9f27-d9b518e48c0b",
        displayName: "foundry-baseline-agents-resource-foundry-baseline-agents-ai-red-team-AgentIdentity",
        servicePrincipalType: "ServiceIdentity",
        tags: [
          "agentGuid:57076efe-4899-4742-848b-038a770584c3",
          "projectId:foundry-baseline-agents-resource@foundry-baseline-agents@AML"
        ]
      },
      { id: "c1", name: "CTCYBERLABS", environment: "production", config: {}, secrets: {} },
      "7a570fd1-8a60-4115-9e1b-68f9102f4eab"
    );
    assert.equal(obs.model, null);
    assert.notEqual(obs.model, "microsoft-agent-identity");
    assert.equal(obs.metadata.deep?.foundationModel ?? null, null);
    assert.equal(obs.metadata.foundryLink?.projectName, "foundry-baseline-agents");
  });

  it("copies GPT-4o from the matching Foundry agent onto the Entra identity", () => {
    const ident = entraAgentIdentityObservation(
      {
        id: "ea1ab011-00dc-4f7a-9f27-d9b518e48c0b",
        displayName: "foundry-baseline-agents-resource-foundry-baseline-agents-ai-red-team-AgentIdentity",
        servicePrincipalType: "ServiceIdentity",
        tags: [
          "agentGuid:57076efe-4899-4742-848b-038a770584c3",
          "projectId:foundry-baseline-agents-resource@foundry-baseline-agents@AML"
        ]
      },
      { id: "c1", name: "CTCYBERLABS", environment: "production", config: {}, secrets: {} },
      "7a570fd1-8a60-4115-9e1b-68f9102f4eab"
    );
    const foundry = {
      fingerprint: "azure-agent:sub:57076efe-4899-4742-848b-038a770584c3",
      name: "ai-red-team (Azure Agent)",
      model: "gpt-4o",
      collector_id: "cloud_azure",
      agent: {
        detected: true,
        detectionMethod: "azure_foundry_api",
        agentId: "57076efe-4899-4742-848b-038a770584c3",
        agentName: "ai-red-team"
      },
      metadata: {
        projectName: "foundry-baseline-agents",
        foundrySource: "azure_foundry_agents",
        deepScan: "azure_foundry_agents_list",
        deep: { foundationModel: "gpt-4o", agentId: "57076efe-4899-4742-848b-038a770584c3" },
        adversarial_surface: { model: { name: "gpt-4o", foundation_model: "gpt-4o" } }
      }
    };
    linkEntraIdentitiesToFoundryAgents([ident, foundry]);
    assert.equal(ident.model, "gpt-4o");
    assert.equal(ident.metadata.modelSource, "azure_foundry_agents");
    assert.equal(ident.metadata.deep.foundationModel, "gpt-4o");
    assert.equal(ident.metadata.adversarial_surface.model.foundation_model, "gpt-4o");
    assert.equal(ident.metadata.linkedFoundryAgentId, "57076efe-4899-4742-848b-038a770584c3");
  });

  it("matches Foundry agent by inferred name when agentGuid differs from list id", () => {
    const ident = {
      collector_id: "identity_entra_agent",
      provider: "entra_agent_id",
      name: "foundry-baseline-agents-resource-foundry-baseline-agents-ai-red-team-AgentIdentity (Entra Agent ID)",
      model: null,
      metadata: {
        discoveryMode: "entra-agent-id-graph",
        tags: ["projectId:foundry-baseline-agents-resource@foundry-baseline-agents@AML"],
        deep: { foundationModel: null },
        adversarial_surface: { model: { name: null, foundation_model: null } },
        evidence: []
      },
      relationships: []
    };
    const foundry = {
      fingerprint: "azure-agent:sub:asst_abc",
      name: "ai-red-team (Azure Agent)",
      model: "gpt-4o",
      agent: { detectionMethod: "azure_foundry_api", agentId: "asst_abc", agentName: "ai-red-team" },
      metadata: {
        projectName: "foundry-baseline-agents",
        foundrySource: "azure_foundry_agents",
        deep: { foundationModel: "gpt-4o" }
      }
    };
    linkEntraIdentitiesToFoundryAgents([ident, foundry]);
    assert.equal(ident.model, "gpt-4o");
    assert.equal(ident.metadata.modelSource, "azure_foundry_agents");
  });

  it("builds Foundry project endpoints from Entra tags", () => {
    const urls = foundryProjectEndpointCandidates(
      "foundry-baseline-agents-resource",
      "foundry-baseline-agents",
      "eastus2"
    );
    assert.ok(urls.some((u) => u.includes("foundry-baseline-agents-resource.services.ai.azure.com")));
    assert.ok(urls.every((u) => u.includes("/api/projects/foundry-baseline-agents")));
  });

  it("reads GPT-4o from Foundry using Entra tags when ARM listed nothing", async () => {
    const ident = entraAgentIdentityObservation(
      {
        id: "205a4a65-a745-40f1-b20d-77d8bafba41a",
        displayName: "foundry-baseline-agents-resource-foundry-baseline-agents-ai-runtime-soc-AgentIdentity",
        servicePrincipalType: "ServiceIdentity",
        tags: [
          "agentGuid:c4536860-d56f-4459-bf56-a643b78f3d67",
          "projectId:foundry-baseline-agents-resource@foundry-baseline-agents@AML",
          "region:eastus2"
        ]
      },
      {
        id: "c1",
        name: "CTCYBERLABS",
        environment: "production",
        config: { subscriptionId: "sub-1", tenantId: "t", clientId: "c" },
        secrets: { clientSecret: "s" }
      },
      "7a570fd1-8a60-4115-9e1b-68f9102f4eab"
    );
    const errors = [];
    await enrichEntraIdentitiesFromFoundryTags(
      {
        config: { subscriptionId: "sub-1", tenantId: "t", clientId: "c" },
        secrets: { clientSecret: "s" }
      },
      [ident],
      errors,
      {
        getDataToken: async () => "token",
        listAgents: async () => ({
          ok: true,
          agents: [
            {
              id: "c4536860-d56f-4459-bf56-a643b78f3d67",
              name: "ai-runtime-soc",
              versions: { latest: { definition: { kind: "prompt", model: "gpt-4o" } } }
            }
          ]
        })
      }
    );
    assert.equal(ident.model, "gpt-4o");
    assert.equal(ident.metadata.modelSource, "azure_foundry_agents");
    assert.equal(ident.metadata.deep.foundationModel, "gpt-4o");
  });

  it("strips stale microsoft-agent-identity on API read", () => {
    const row = enrichAgentRow({
      id: "1",
      name: "ident",
      model: "microsoft-agent-identity",
      metadata: {
        discoveryMode: "entra-agent-id-graph",
        deep: { foundationModel: null },
        agentConfig: { models: [] }
      }
    });
    assert.equal(row.model, null);
  });
});
