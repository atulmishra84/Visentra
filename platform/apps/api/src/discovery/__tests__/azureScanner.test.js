import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  chatDeploymentModel,
  collectArmPageValues,
  discoverAzureScanner,
  explainStatus,
  inferFoundryName,
  parseFoundryTags,
  projectEndpoints,
  projectMatches
} from "../azureScanner.js";

const conn = {
  id: "c1",
  name: "CTCYBERLAB",
  environment: "production",
  config: { tenantId: "tenant", clientId: "app", subscriptionId: "sub" },
  secrets: { clientSecret: "secret" }
};

function identity() {
  return {
    id: "ea1ab011-00dc-4f7a-9f27-d9b518e48c0b",
    displayName: "foundry-baseline-agents-resource-foundry-baseline-agents-ai-red-team-AgentIdentity",
    servicePrincipalType: "ServiceIdentity",
    tags: [
      "region:eastus2",
      "agentGuid:57076efe-4899-4742-848b-038a770584c3",
      "projectId:foundry-baseline-agents-resource@foundry-baseline-agents@AML"
    ]
  };
}

describe("Azure scanner v2", () => {
  it("parses the Foundry name from the Entra identity", () => {
    const tags = parseFoundryTags(identity().tags);
    assert.equal(tags.accountName, "foundry-baseline-agents-resource");
    assert.equal(tags.projectName, "foundry-baseline-agents");
    assert.equal(inferFoundryName(identity().displayName, tags), "ai-red-team");
  });

  it("explains 404 and 403 as different failures", () => {
    assert.match(explainStatus(404, "missing"), /404 Not Found/);
    assert.match(explainStatus(403, "Forbidden"), /403 Forbidden/);
    assert.match(explainStatus(403, "Forbidden"), /AIServices\/agents\/read/);
  });

  it("reads gpt-4o from the ARM project endpoint", async () => {
    const endpoint = "https://real.services.ai.azure.com/api/projects/foundry-baseline-agents";
    assert.equal(
      projectEndpoints({
        name: "foundry-baseline-agents",
        properties: { endpoints: { "AI Foundry API": endpoint } }
      })[0],
      endpoint
    );
    const calls = [];
    const result = await discoverAzureScanner(conn, {
      getToken: async () => "token",
      listIdentities: async () => ({ ok: true, items: [identity()] }),
      listAccounts: async () => [
        {
          id: "/subscriptions/sub/resourceGroups/rg/providers/Microsoft.CognitiveServices/accounts/foundry-baseline-agents-resource",
          name: "foundry-baseline-agents-resource"
        }
      ],
      listProjects: async () => [
        { name: "foundry-baseline-agents", properties: { endpoints: { "AI Foundry API": endpoint } } }
      ],
      listDeployments: async () => [],
      request: async (_token, url) => {
        calls.push(url);
        if (url.startsWith(`${endpoint}/assistants?`)) {
          return { ok: true, status: 200, json: { data: [{ id: "asst_1", name: "ai-red-team", model: "gpt-4o" }] } };
        }
        return { ok: false, status: 404, json: {}, error: "Data-plane GET failed (404)" };
      }
    });
    assert.equal(calls[0].startsWith(endpoint), true);
    assert.equal(result.observations.length, 1);
    assert.equal(result.observations[0].name, "ai-red-team");
    assert.equal(result.observations[0].model, "gpt-4o");
    assert.equal(result.observations[0].metadata.modelSource, "azure_foundry_agents");
  });

  it("uses the only chat deployment when every agent route returns 404", async () => {
    assert.equal(
      chatDeploymentModel([
        { properties: { model: { name: "gpt-4o" } } },
        { properties: { model: { name: "text-embedding-3-large" } } }
      ]),
      "gpt-4o"
    );
    const result = await discoverAzureScanner(conn, {
      getToken: async () => "token",
      listIdentities: async () => ({ ok: true, items: [identity()] }),
      listAccounts: async () => [{ id: "/subscriptions/sub/resourceGroups/rg/providers/Microsoft.CognitiveServices/accounts/foundry-baseline-agents-resource", name: "foundry-baseline-agents-resource" }],
      listProjects: async () => [
        {
          name: "foundry-baseline-agents",
          properties: { endpoints: { "AI Foundry API": "https://real.services.ai.azure.com/api/projects/foundry-baseline-agents" } }
        }
      ],
      listDeployments: async () => [{ properties: { model: { name: "gpt-4o" } } }],
      request: async () => ({ ok: false, status: 404, json: {}, error: "Data-plane GET failed (404)" })
    });
    assert.equal(result.observations[0].name, "ai-red-team");
    assert.equal(result.observations[0].model, "gpt-4o");
    assert.equal(result.observations[0].metadata.modelSource, "azure_cognitive_deployment");
    assert.match(result.observations[0].metadata.evidence.join(" "), /404 Not Found/);
  });

  it("records 403 as a missing Foundry role and does not invent a model", async () => {
    const result = await discoverAzureScanner(conn, {
      getToken: async () => "token",
      listIdentities: async () => ({ ok: true, items: [identity()] }),
      listAccounts: async () => [{ id: "/accounts/foundry-baseline-agents-resource", name: "foundry-baseline-agents-resource" }],
      listProjects: async () => [
        {
          name: "foundry-baseline-agents",
          properties: { endpoints: { "AI Foundry API": "https://real.services.ai.azure.com/api/projects/foundry-baseline-agents" } }
        }
      ],
      listDeployments: async () => [],
      request: async () => ({ ok: false, status: 403, json: {}, error: "Forbidden" })
    });
    assert.equal(result.observations[0].model, null);
    assert.match(result.observations[0].metadata.evidence.join(" "), /403 Forbidden/);
    assert.equal(result.observations[0].metadata.modelAccessStatus, "restricted_403");
    assert.match(result.observations[0].metadata.remediationGuide, /Cognitive Services OpenAI User/);
    assert.equal(result.discoveryErrors.some((item) => item.discoveryStatus === "permission_denied"), true);
  });

  it("proactively prioritizes assistants routes for @AML hub projects", async () => {
    const { isHubProject, preferredAgentRoutes } = await import("../azureScanner.js");
    assert.equal(isHubProject({ projectId: "foundry-baseline-agents-resource@foundry-baseline-agents@AML" }), true);
    assert.equal(isHubProject({ projectId: "native-foundry-project" }), false);
    const routes = preferredAgentRoutes({ projectId: "res@proj@AML" });
    assert.equal(routes[0][0], "assistants");
  });

  it("selects chat deployment when multiple exist using candidate matching", () => {
    const deployments = [
      { name: "text-embedding-3-large", properties: { model: { name: "text-embedding-3-large" } } },
      { name: "gpt-4o", properties: { model: { name: "gpt-4o" } } },
      { name: "gpt-35-turbo", properties: { model: { name: "gpt-35-turbo" } } }
    ];
    const picked = chatDeploymentModel(deployments);
    assert.equal(picked, "gpt-4o");
  });

  it("probes foundryAgentRead capability", async () => {
    const { probeFoundryAgentReadCapability } = await import("../azureScanner.js");
    const endpoint = "https://real.services.ai.azure.com/api/projects/p1";
    const result = await probeFoundryAgentReadCapability(conn, {
      getToken: async () => "token",
      listAccounts: async () => [{ id: "/accounts/a1", name: "a1" }],
      listProjects: async () => [
        { name: "p1", properties: { endpoints: { "AI Foundry API": endpoint } } }
      ],
      request: async (_token, url) => {
        if (url.startsWith(`${endpoint}/assistants?`)) {
          return { ok: true, status: 200, json: { data: [{ id: "asst_1", name: "test-agent" }] } };
        }
        return { ok: false, status: 404, json: {}, error: "404" };
      }
    });
    assert.equal(result.ok, true);
    assert.equal(result.agentCount, 1);
    assert.match(result.message, /foundryAgentRead=true/);
  });

  it("extracts model from hosted agent environment variables or tool definitions", async () => {
    const { modelFromAgent } = await import("../azureScanner.js");
    // Standard prompt agent
    assert.equal(modelFromAgent({ versions: { latest: { definition: { model: "gpt-4o" } } } }), "gpt-4o");
    // Hosted agent with environment variable
    assert.equal(
      modelFromAgent({
        versions: {
          latest: {
            definition: {
              kind: "hosted",
              environment_variables: { AZURE_OPENAI_DEPLOYMENT_NAME: "gpt-4o" }
            }
          }
        }
      }),
      "gpt-4o"
    );
    // Hosted agent with tool definition referencing model
    assert.equal(
      modelFromAgent({
        versions: {
          latest: {
            definition: {
              kind: "hosted",
              tools: [{ type: "custom", model: "gpt-4o-mini" }]
            }
          }
        }
      }),
      "gpt-4o-mini"
    );
  });

  it("falls back to chat deployment when hosted agent definition has no model", async () => {
    const hostedAgentIdentity = {
      id: "39ae895a-8f0f-4bef-8077-d13e3039beb0",
      displayName: "foundry-baseline-agents-resource-foundry-baseline-agents-agent-framework-agent-with-foundry-toolbox-responses-AgentIdentity",
      servicePrincipalType: "ServiceIdentity",
      tags: [
        "region:eastus2",
        "agentGuid:4a095557-9bfa-435a-bea4-58dd52d8f18a",
        "projectId:foundry-baseline-agents-resource@foundry-baseline-agents@AML"
      ]
    };
    const endpoint = "https://real.services.ai.azure.com/api/projects/foundry-baseline-agents";
    const result = await discoverAzureScanner(conn, {
      getToken: async () => "token",
      listIdentities: async () => ({ ok: true, items: [hostedAgentIdentity] }),
      listAccounts: async () => [
        {
          id: "/subscriptions/sub/resourceGroups/rg/providers/Microsoft.CognitiveServices/accounts/foundry-baseline-agents-resource",
          name: "foundry-baseline-agents-resource"
        }
      ],
      listProjects: async () => [
        { name: "foundry-baseline-agents", properties: { endpoints: { "AI Foundry API": endpoint } } }
      ],
      listDeployments: async () => [
        { name: "gpt-4o", properties: { model: { name: "gpt-4o" } } }
      ],
      request: async (_token, url) => {
        // Return agent from Foundry without model in definition (hosted agent style)
        if (url.startsWith(`${endpoint}/assistants?`)) {
          return {
            ok: true,
            status: 200,
            json: {
              data: [
                {
                  id: "4a095557-9bfa-435a-bea4-58dd52d8f18a",
                  name: "agent-framework-agent-with-foundry-toolbox-responses",
                  versions: { latest: { definition: { kind: "hosted" } } }
                }
              ]
            }
          };
        }
        return { ok: false, status: 404, json: {}, error: "404" };
      }
    });

    assert.equal(result.observations.length, 1);
    assert.equal(result.observations[0].name, "agent-framework-agent-with-foundry-toolbox-responses");
    assert.equal(result.observations[0].model, "gpt-4o");
    assert.equal(result.observations[0].metadata.modelSource, "azure_cognitive_deployment");
    assert.ok(result.observations[0].metadata.evidence.some(e => e.includes("Foundation model gpt-4o mapped from chat deployment")));
  });

  it("matches an ARM project whose name is account/project", () => {
    const project = {
      name: "foundry-baseline-agents-resource/foundry-baseline-agents",
      id: "/subscriptions/sub/resourceGroups/rg/providers/Microsoft.CognitiveServices/accounts/foundry-baseline-agents-resource/projects/foundry-baseline-agents",
      properties: { endpoints: { "AI Foundry API": "https://real.services.ai.azure.com/api/projects/foundry-baseline-agents" } }
    };
    assert.equal(projectMatches(project, "foundry-baseline-agents"), true);
    assert.equal(
      projectEndpoints(project)[0],
      "https://real.services.ai.azure.com/api/projects/foundry-baseline-agents"
    );
  });

  it("follows nextLink when the first ARM page is empty", async () => {
    const pages = {
      "https://management.azure.com/start": {
        ok: true,
        value: [],
        nextLink: "https://management.azure.com/page-2"
      },
      "https://management.azure.com/page-2": {
        ok: true,
        value: [{ name: "foundry-test-agents-resource" }],
        nextLink: "https://management.azure.com/page-4"
      },
      "https://management.azure.com/page-4": {
        ok: true,
        value: [{ name: "a365ct" }, { name: "foundry-baseline-agents-resource" }],
        nextLink: null
      }
    };
    const result = await collectArmPageValues("https://management.azure.com/start", async (url) => pages[url]);
    assert.deepEqual(
      result.map((account) => account.name),
      ["foundry-test-agents-resource", "a365ct", "foundry-baseline-agents-resource"]
    );
  });

  it("stops when ARM nextLink repeats", async () => {
    const result = await collectArmPageValues("https://management.azure.com/loop", async () => ({
      ok: true,
      value: [{ name: "once" }],
      nextLink: "https://management.azure.com/loop"
    }));
    assert.deepEqual(result.map((account) => account.name), ["once"]);
  });
});
