import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  classifyAzureResource,
  isAzureAiResource
} from "../aiRelevance.js";
import {
  resourceToObservation,
  EFFECTIVE_AZURE_AI_ONLY
} from "../azureArm.js";
import {
  sanitizeAzureError,
  emptyAgentBlock,
  normalizeRuntimeStatus,
  parseResourceId
} from "../azureDeepScan.js";
import { classifyAgentEvidence } from "../agentEvidence.js";
import { enrichObservationWithDepth } from "../../services/agentDepth.js";

const conn = {
  id: "conn-1",
  name: "Azure Prod",
  environment: "prod",
  config: {
    tenantId: "tenant-1",
    subscriptionId: "sub-1",
    clientId: "client-1"
  },
  secrets: { clientSecret: "super-secret-value" }
};

function res(partial) {
  return {
    id: `/subscriptions/sub-1/resourceGroups/rg1/providers/${partial.type}/${partial.name}`,
    location: "eastus",
    tags: {},
    ...partial
  };
}

describe("classifyAzureResource", () => {
  it("classifies Azure OpenAI", () => {
    const c = classifyAzureResource(
      res({ type: "Microsoft.CognitiveServices/accounts", name: "my-openai", kind: "OpenAI" })
    );
    assert.equal(c.aiRelevant, true);
    assert.equal(c.category, "azure_openai");
    assert.ok(c.confidence >= 0.95);
    assert.equal(c.layer, "ai_resource");
  });

  it("classifies Azure AI Foundry / AIServices", () => {
    const c = classifyAzureResource(
      res({ type: "Microsoft.CognitiveServices/accounts", name: "foundry1", kind: "AIServices" })
    );
    assert.equal(c.aiRelevant, true);
    assert.equal(c.category, "azure_ai_foundry");
  });

  it("classifies Machine Learning workspace", () => {
    const c = classifyAzureResource(
      res({ type: "Microsoft.MachineLearningServices/workspaces", name: "mlw" })
    );
    assert.equal(c.category, "azure_machine_learning");
    assert.equal(c.aiRelevant, true);
  });

  it("classifies AI Search", () => {
    const c = classifyAzureResource(
      res({ type: "Microsoft.Search/searchServices", name: "search1" })
    );
    assert.equal(c.category, "azure_ai_search");
  });

  it("classifies Bot Service", () => {
    const c = classifyAzureResource(
      res({ type: "Microsoft.BotService/botServices", name: "bot1" })
    );
    assert.equal(c.category, "azure_bot_service");
  });

  it("classifies Container App only with AI signals", () => {
    const plain = classifyAzureResource(
      res({ type: "Microsoft.App/containerApps", name: "web-frontend" })
    );
    assert.equal(plain.aiRelevant, false);

    const ai = classifyAzureResource(
      res({
        type: "Microsoft.App/containerApps",
        name: "langgraph-worker",
        tags: { workload: "ai-agent" }
      })
    );
    assert.equal(ai.aiRelevant, true);
    assert.equal(ai.category, "azure_container_app");
    assert.equal(ai.layer, "compute_candidate");
  });

  it("classifies AKS with AI signals", () => {
    const c = classifyAzureResource(
      res({ type: "Microsoft.ContainerService/managedClusters", name: "aks-llm-cluster" })
    );
    assert.equal(c.aiRelevant, true);
    assert.equal(c.category, "azure_aks");
  });

  it("classifies Function App", () => {
    const c = classifyAzureResource(
      res({
        type: "Microsoft.Web/sites",
        name: "fn-openai-proxy",
        kind: "functionapp,linux"
      })
    );
    assert.equal(c.category, "azure_function");
    assert.equal(c.aiRelevant, true);
  });

  it("classifies App Service with AI name", () => {
    const c = classifyAzureResource(
      res({ type: "Microsoft.Web/sites", name: "my-crewai-api", kind: "app,linux" })
    );
    assert.equal(c.aiRelevant, true);
    assert.equal(c.category, "azure_app_service");
  });

  it("classifies VM with AI tags as candidate host", () => {
    const c = classifyAzureResource(
      res({
        type: "Microsoft.Compute/virtualMachines",
        name: "vm1",
        tags: { role: "ollama-host" }
      })
    );
    assert.equal(c.aiRelevant, true);
    assert.equal(c.category, "azure_vm");
  });

  it("rejects normal storage and database", () => {
    assert.equal(
      isAzureAiResource(res({ type: "Microsoft.Storage/storageAccounts", name: "data" })),
      false
    );
    assert.equal(
      isAzureAiResource(
        res({ type: "Microsoft.Sql/servers/databases", name: "orders" })
      ),
      false
    );
  });
});

describe("resourceToObservation semantics", () => {
  it("does not mark Azure OpenAI resource as confirmed agent", () => {
    const resource = res({
      type: "Microsoft.CognitiveServices/accounts",
      name: "aoai",
      kind: "OpenAI"
    });
    const classification = classifyAzureResource(resource);
    const obs = resourceToObservation(resource, conn, classification, {
      discoveryLayer: "ai_resource"
    });

    assert.equal(obs.collector_id, "cloud_azure");
    assert.equal(obs.category, "cloud");
    assert.equal(obs.cloud_provider, "azure");
    assert.equal(obs.provider, "azure");
    assert.equal(obs.deployment_type, "cloud");
    assert.equal(obs.running_status, "unknown");
    assert.equal(obs.agent.detected, false);
    assert.equal(obs.metadata.agentStatus, null);
    assert.equal(obs.metadata.managedCloudAgent, false);
    assert.equal(obs.metadata.aiRelevant, true);
    assert.equal(obs.metadata.aiResourceType, "azure_openai");
    assert.equal(obs.metadata.inventoryClass, "ai_cloud_resource");
    assert.ok(obs.metadata.evidence.length > 0);
  });

  it("builds confirmed agent observation from Foundry-style fields", () => {
    const resource = res({
      type: "Microsoft.CognitiveServices/accounts",
      name: "foundry",
      kind: "AIServices"
    });
    const classification = classifyAzureResource(resource);
    const obs = resourceToObservation(resource, conn, classification, {
      fingerprint: `azure-agent:sub-1:agent-123`,
      discoveryLayer: "agent",
      inventoryClass: "ai_cloud_agent",
      confidence: 0.96,
      agentRuntime: {
        agent: {
          detected: true,
          detectionMethod: "azure_foundry_api",
          agentId: "agent-123",
          agentName: "SupportBot",
          agentType: "prompt",
          agentStatus: "confirmed",
          runtimeStatus: "unknown",
          deploymentStatus: null,
          lastSeenAt: null,
          source: "azure_foundry_agents"
        },
        runtime: {
          detected: false,
          status: "unknown",
          runtimeType: "azure_foundry_agent",
          runtimeId: "agent-123",
          runtimeName: "SupportBot",
          resourceId: resource.id,
          region: "eastus"
        }
      }
    });

    assert.equal(obs.fingerprint, "azure-agent:sub-1:agent-123");
    assert.equal(obs.agent.detected, true);
    assert.equal(obs.agent.detectionMethod, "azure_foundry_api");
    assert.equal(obs.metadata.agentStatus, "confirmed");
    assert.equal(obs.metadata.managedCloudAgent, true);
    assert.equal(obs.running_status, "unknown");
    const enriched = enrichObservationWithDepth(obs);
    assert.equal(enriched.metadata.agentId, "agent-123");
    assert.equal(enriched.metadata.subscriptionId, "sub-1");
    assert.equal(enriched.metadata.resourceGroup, "rg1");
    assert.match(String(enriched.metadata.howIdentified), /agent-123/);
  });

  it("keeps stable fingerprints across calls", () => {
    const resource = res({
      type: "Microsoft.BotService/botServices",
      name: "bot1"
    });
    const classification = classifyAzureResource(resource);
    const a = resourceToObservation(resource, conn, classification, {
      fingerprint: `azure-agent:${conn.config.subscriptionId}:${resource.id}`
    });
    const b = resourceToObservation(resource, conn, classification, {
      fingerprint: `azure-agent:${conn.config.subscriptionId}:${resource.id}`
    });
    assert.equal(a.fingerprint, b.fingerprint);
  });

  it("separates VM runtime running from agent runtime unknown", () => {
    const resource = res({
      type: "Microsoft.Compute/virtualMachines",
      name: "gpu-llm",
      tags: { app: "vllm" }
    });
    const classification = classifyAzureResource(resource);
    const obs = resourceToObservation(resource, conn, classification, {
      fingerprint: `azure-runtime:${resource.id}`,
      runningStatus: "running",
      agentRuntime: {
        agent: {
          ...emptyAgentBlock(),
          detected: true,
          detectionMethod: "runtime_heuristic",
          agentId: resource.id,
          agentName: resource.name,
          agentType: "vm_workload_candidate",
          agentStatus: "candidate",
          runtimeStatus: "unknown"
        },
        runtime: {
          detected: true,
          status: "running",
          runtimeType: "azure_vm",
          runtimeId: resource.id,
          runtimeName: resource.name,
          resourceId: resource.id,
          region: "eastus"
        }
      }
    });

    assert.equal(obs.runtime.status, "running");
    assert.equal(obs.agent.runtimeStatus, "unknown");
    assert.equal(obs.metadata.agentStatus, "candidate");
    assert.notEqual(obs.metadata.agentStatus, "confirmed");
  });
});

describe("agentEvidence Azure semantics", () => {
  it("does not confirm CognitiveServices resource as agent", () => {
    const classified = classifyAgentEvidence({
      collector_id: "cloud_azure",
      category: "cloud",
      confidence_score: 0.9,
      agent: { detected: false },
      metadata: {
        inventoryClass: "ai_cloud_resource",
        azureType: "Microsoft.CognitiveServices/accounts",
        aiRelevant: true,
        agentDetected: false
      }
    });
    assert.equal(classified.agentStatus, null);
    assert.equal(classified.ingestible, true);
    assert.equal(classified.reason, "ai_cloud_resource_only");
  });

  it("confirms Foundry API agents", () => {
    const classified = classifyAgentEvidence({
      collector_id: "cloud_azure",
      category: "cloud",
      confidence_score: 0.96,
      agent: {
        detected: true,
        detectionMethod: "azure_foundry_api"
      },
      metadata: {
        inventoryClass: "ai_cloud_agent",
        agentDetected: true,
        agentDetectionMethod: "azure_foundry_api",
        managedCloudAgent: true,
        evidenceClass: "cloud_ai_runtime",
        agentStatus: "confirmed"
      }
    });
    assert.equal(classified.agentStatus, "confirmed");
    assert.ok(classified.confidence_score >= 0.92);
  });

  it("keeps heuristic agents as candidates", () => {
    const classified = classifyAgentEvidence({
      collector_id: "cloud_azure",
      category: "cloud",
      confidence_score: 0.7,
      agent: {
        detected: true,
        detectionMethod: "runtime_heuristic"
      },
      metadata: {
        inventoryClass: "ai_cloud_agent",
        agentDetected: true,
        agentDetectionMethod: "runtime_heuristic",
        managedCloudAgent: false,
        evidenceClass: "cloud_ai_runtime",
        agentStatus: "candidate"
      }
    });
    assert.equal(classified.agentStatus, "candidate");
  });
});

describe("runtime status normalization", () => {
  it("maps running/stopped/failed/unknown", () => {
    assert.equal(normalizeRuntimeStatus("Running"), "running");
    assert.equal(normalizeRuntimeStatus("deallocated"), "stopped");
    assert.equal(normalizeRuntimeStatus("Failed"), "failed");
    assert.equal(normalizeRuntimeStatus(""), "unknown");
    assert.equal(normalizeRuntimeStatus("Starting"), "unknown");
  });
});

describe("security sanitization", () => {
  it("never echoes client secrets or bearer tokens", () => {
    const msg = sanitizeAzureError(
      new Error(
        "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.aaa.bbb failed client_secret=super-secret-value access_token=abc"
      )
    );
    assert.equal(msg.includes("super-secret-value"), false);
    assert.equal(msg.includes("eyJhbGci"), false);
    assert.equal(msg.includes("Bearer [REDACTED]"), true);
    assert.equal(msg.includes("client_secret=[REDACTED]"), true);
  });

  it("does not put secrets on observations", () => {
    const resource = res({
      type: "Microsoft.CognitiveServices/accounts",
      name: "aoai",
      kind: "OpenAI"
    });
    const obs = resourceToObservation(resource, conn, classifyAzureResource(resource));
    const blob = JSON.stringify(obs);
    assert.equal(blob.includes("super-secret-value"), false);
    assert.equal(blob.includes("clientSecret"), false);
  });
});

describe("failure isolation helpers", () => {
  it("parseResourceId extracts rg and subscription", () => {
    const parsed = parseResourceId(
      "/subscriptions/sub-1/resourceGroups/rg1/providers/Microsoft.App/containerApps/app1"
    );
    assert.equal(parsed.subscriptionId, "sub-1");
    assert.equal(parsed.resourceGroup, "rg1");
    assert.equal(parsed.name, "app1");
  });

  it("exports EFFECTIVE_AZURE_AI_ONLY boolean", () => {
    assert.equal(typeof EFFECTIVE_AZURE_AI_ONLY, "boolean");
  });
});
