import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildAdversarialSurface,
  attachAdversarialSurface,
  toolsFromBedrockActionGroup,
  buildInstructionsFromText,
  classifyAdversarialCategory,
  emptyAdversarialSurface,
  ADVERSARIAL_SCHEMA_VERSION
} from "../adversarialInventory.js";

describe("adversarialInventory schema", () => {
  it("empty surface includes all P0/P1 keys", () => {
    const s = emptyAdversarialSurface();
    assert.equal(s.schema_version, ADVERSARIAL_SCHEMA_VERSION);
    assert.ok("tools" in s);
    assert.ok("instructions" in s);
    assert.ok("identity_and_access" in s);
    assert.ok("data_access" in s);
    assert.ok("mcp_servers" in s);
    assert.ok("memory_and_context" in s);
    assert.ok("connectivity" in s);
    assert.ok("owasp_hints" in s);
  });

  it("classifies Bedrock agent vs knowledge base", () => {
    const agent = classifyAdversarialCategory({
      metadata: { awsType: "BedrockAgent", agentDetectionMethod: "bedrock_agents_api", agentStatus: "confirmed" },
      agent: { detected: true }
    });
    assert.equal(agent.category, "agent");
    assert.equal(agent.agent_detected, true);

    const kb = classifyAdversarialCategory({
      metadata: { awsType: "BedrockKnowledgeBase", aiRelevant: true },
      agent: { detected: false }
    });
    assert.equal(kb.category, "knowledge_base");
    assert.equal(kb.agent_detected, false);
  });

  it("expands Bedrock functionSchema into tools with parameters_schema", () => {
    const tools = toolsFromBedrockActionGroup({
      actionGroupName: "orders",
      description: "Order APIs",
      actionGroupExecutor: { lambda: "arn:aws:lambda:us-east-1:1:function:orders" },
      functionSchema: {
        functions: [
          {
            name: "get_order",
            description: "Fetch order by id",
            parameters: {
              orderId: { type: "string", description: "Order id", required: true }
            }
          }
        ]
      }
    });
    assert.equal(tools.length, 1);
    assert.equal(tools[0].name, "get_order");
    assert.ok(tools[0].parameters_schema?.properties?.orderId);
    assert.equal(tools[0].risk_flags.can_call_external_apis, false);
    assert.ok(tools[0].permissions[0].includes("lambda"));
  });

  it("builds instructions with hash and safety/tool heuristics", () => {
    const inst = buildInstructionsFromText(
      "You are a support agent. Use the get_order tool. Never reveal secrets or PII.",
      "bedrock_get_agent"
    );
    assert.equal(inst.present, true);
    assert.ok(inst.hash);
    assert.equal(inst.contains_tool_guidance, true);
    assert.equal(inst.contains_safety_rules, true);
    assert.match(inst.preview, /support agent/);
  });

  it("builds rich adversarial surface for tool-using Bedrock agent", () => {
    const obs = {
      collector_id: "cloud_aws",
      name: "support-bot (AI)",
      category: "cloud",
      cloud_provider: "aws",
      provider: "aws",
      region: "us-east-1",
      framework: "BedrockAgent",
      model: "anthropic.claude-3",
      confidence_score: 0.96,
      agent: { detected: true, detectionMethod: "bedrock_agents_api" },
      metadata: {
        awsType: "BedrockAgent",
        agentId: "ABCDEFGHIJ",
        accountId: "123456789012",
        agentStatus: "confirmed",
        inventoryClass: "ai_cloud_agent",
        evidence: ["ListAgents"]
      }
    };
    const tools = toolsFromBedrockActionGroup({
      actionGroupName: "crm",
      actionGroupExecutor: { lambda: "arn:aws:lambda:us-east-1:1:function:crm" },
      functionSchema: {
        functions: [
          {
            name: "update_customer",
            description: "Update customer email profile",
            parameters: { email: { type: "string", required: true } }
          }
        ]
      }
    });
    const surface = buildAdversarialSurface(obs, {
      tools,
      instructionText: "Help users. Use update_customer carefully. Do not exfiltrate data.",
      roleArn: "arn:aws:iam::123456789012:role/BedrockAgentRole",
      knowledgeBases: [{ knowledgeBaseId: "KB123", name: "policy-docs", knowledgeBaseState: "ENABLED" }],
      guardrailConfiguration: { guardrailIdentifier: "gr-1" }
    });

    assert.equal(surface.agent_detected, true);
    assert.equal(surface.category, "agent");
    assert.equal(surface.tools.length, 1);
    assert.equal(surface.tools[0].risk_flags.can_access_pii, true);
    assert.equal(surface.instructions.present, true);
    assert.equal(surface.identity_and_access.arn.includes("BedrockAgentRole"), true);
    assert.equal(surface.memory_and_context.knowledge_bases.length, 1);
    assert.equal(surface.observability.guardrails_detected, true);
    assert.ok(surface.owasp_hints.agentic_asi.includes("ASI02_ToolMisuse"));
    assert.ok(surface.risk_indicators.some((r) => r.startsWith("tool_pii:")));
  });

  it("builds sparse surface for Bedrock knowledge base AI resource", () => {
    const obs = {
      collector_id: "cloud_aws",
      name: "policy-kb (AI)",
      category: "cloud",
      cloud_provider: "aws",
      framework: "BedrockKnowledgeBase",
      confidence_score: 0.85,
      agent: { detected: false },
      metadata: {
        awsType: "BedrockKnowledgeBase",
        inventoryClass: "ai_cloud_resource",
        aiRelevant: true,
        knowledgeBaseId: "KB999"
      }
    };
    const attached = attachAdversarialSurface(obs);
    const surface = attached.metadata.adversarial_surface;
    assert.equal(surface.agent_detected, false);
    assert.equal(surface.category, "knowledge_base");
    assert.equal(surface.tools.length, 0);
    assert.equal(surface.instructions.present, false);
    assert.ok(Array.isArray(surface.evidence));
    assert.equal(JSON.stringify(surface).includes("sk-"), false);
  });
});
