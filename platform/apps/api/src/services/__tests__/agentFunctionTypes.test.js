import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  AGENT_FUNCTION_TYPES,
  classifyAgentFunction,
  listFunctionTypes,
  controlsForFunctionTypes
} from "../agentFunctionTypes.js";

describe("agent function types", () => {
  it("exports a stable catalog of functionality types", () => {
    const ids = listFunctionTypes().map((t) => t.id);
    assert.ok(ids.includes("conversational"));
    assert.ok(ids.includes("rag_knowledge"));
    assert.ok(ids.includes("code_execution"));
    assert.ok(ids.includes("identity_broker"));
    assert.ok(ids.includes("data_access"));
    assert.equal(AGENT_FUNCTION_TYPES.length, 10);
  });

  it("classifies Entra Agent ID as identity/access", () => {
    const result = classifyAgentFunction({
      name: "Finance copilot identity",
      category: "identity",
      metadata: { agentType: "entra_agent_identity", objectId: "abc", inventoryClass: "ai_cloud_agent" }
    });
    assert.equal(result.functionType, "identity_broker");
    assert.ok(result.complianceFocus.includes("hipaa.AC"));
  });

  it("classifies knowledge-base agents as RAG", () => {
    const result = classifyAgentFunction({
      name: "Policy retriever",
      metadata: {
        agentType: "assistant",
        agentConfig: { knowledgeSources: ["sharepoint://hr-policies"], tools: [] }
      },
      agentConfig: { knowledgeSources: ["sharepoint://hr-policies"] }
    });
    assert.ok(result.functionTypes.includes("rag_knowledge"));
    assert.ok(result.complianceFocus.includes("owasp_llm.LLM08"));
  });

  it("classifies code-interpreter tools as code execution", () => {
    const result = classifyAgentFunction({
      name: "Analyst notebook",
      metadata: { agentType: "assistant" },
      tools: [{ name: "code_interpreter", risk_flags: { can_execute_code: true } }],
      internet_access: true
    });
    assert.ok(result.functionTypes.includes("code_execution"));
    assert.ok(result.functionTypes.includes("autonomous_operator") || result.functionTypes.includes("conversational"));
  });

  it("classifies bots and copilots as conversational", () => {
    const result = classifyAgentFunction({
      name: "Contoso help bot",
      metadata: { agentType: "azure_bot_service", channels: ["teams"] },
      agentConfig: { channels: ["teams"], instructionsPresent: true }
    });
    assert.equal(result.functionType, "conversational");
  });

  it("honors operator override", () => {
    const result = classifyAgentFunction({
      name: "misc",
      metadata: { functionTypeOverride: "data_access" }
    });
    assert.equal(result.functionType, "data_access");
    assert.equal(result.functionTypeConfidence, "high");
  });

  it("filters controls by relevant function types", () => {
    const controls = [
      { id: "a", relevantFunctionTypes: ["rag_knowledge"] },
      { id: "b", relevantFunctionTypes: ["conversational"] },
      { id: "c" }
    ];
    const filtered = controlsForFunctionTypes(controls, ["rag_knowledge"]);
    assert.deepEqual(
      filtered.map((c) => c.id),
      ["a", "c"]
    );
  });
});
