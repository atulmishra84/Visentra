import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { listFrameworks, listControls, COMPLIANCE_CONTROLS } from "../complianceCatalog.js";
import { assessAgent, assessControl } from "../complianceAssess.js";

describe("Governance compliance catalog", () => {
  it("includes OWASP, HIPAA, and NIST frameworks with controls", () => {
    const frameworks = listFrameworks();
    assert.deepEqual(
      frameworks.map((f) => f.id).sort(),
      ["hipaa", "nist_ai_rmf", "owasp_llm"]
    );
    assert.ok(COMPLIANCE_CONTROLS.length >= 20);
    assert.equal(listControls("owasp_llm").length, 10);
    assert.ok(listControls("hipaa").length >= 6);
    assert.ok(listControls("nist_ai_rmf").length >= 6);
    assert.ok(listControls("owasp_llm").every((c) => Array.isArray(c.relevantFunctionTypes) && c.relevantFunctionTypes.length));
  });
});

describe("Governance auto-assessment", () => {
  it("fails Shadow AI + PHI agent on HIPAA ownership/shadow controls", () => {
    const agent = {
      id: "a1",
      name: "phi-bot",
      category: "saas",
      metadata: {
        agentStatus: "confirmed",
        evidenceClass: "platform_agent",
        hasPhi: true,
        shadowAi: true,
        adversarial_surface: {
          data_access: { has_phi: true },
          ownership: { shadow_ai: true },
          observability: { guardrails_detected: false }
        }
      }
    };
    const assessment = assessAgent(agent, { frameworks: ["hipaa"] });
    assert.equal(assessment.summary.posture, "non_compliant");
    const shadow = assessment.findings.find((f) => f.controlId === "hipaa.SHADOW");
    assert.equal(shadow?.status, "fail");
  });

  it("passes NIST MAP context when category and environment exist", () => {
    const agent = {
      id: "a2",
      name: "owned-agent",
      category: "cloud",
      owner: "secops",
      environment: "prod",
      metadata: {
        evidenceClass: "platform_agent",
        agentStatus: "confirmed",
        deep: { tools: [] }
      }
    };
    const control = listControls("nist_ai_rmf").find((c) => c.id === "nist.MAP_1");
    assert.ok(control);
    const finding = assessControl(control, agent);
    assert.equal(finding.status, "pass");
  });

  it("uses function type as NIST MAP context of use", () => {
    const agent = {
      id: "a4",
      name: "help-bot",
      metadata: {
        agentType: "azure_bot_service",
        channels: ["teams"],
        agentConfig: { channels: ["teams"], instructionsPresent: true }
      }
    };
    const control = listControls("nist_ai_rmf").find((c) => c.id === "nist.MAP_1");
    const finding = assessControl(control, agent);
    assert.equal(finding.status, "pass");
    assert.match(finding.rationale, /function type/i);
  });

  it("treats RAG-classified agents as in-scope for vector controls", () => {
    const agent = {
      id: "a5",
      name: "policy-rag",
      metadata: {
        agentType: "assistant",
        agentConfig: { knowledgeSources: ["kb://policies"] }
      },
      agentConfig: { knowledgeSources: ["kb://policies"] }
    };
    const llm08 = listControls("owasp_llm").find((c) => c.id === "owasp_llm.LLM08");
    const finding = assessControl(llm08, agent);
    assert.notEqual(finding.status, "not_applicable");
  });

  it("includes function type on the agent assessment", () => {
    const agent = {
      id: "a6",
      name: "id-agent",
      category: "identity",
      metadata: { agentType: "entra_agent_identity", objectId: "x" }
    };
    const assessment = assessAgent(agent, { frameworks: ["nist_ai_rmf"] });
    assert.equal(assessment.functionType, "identity_broker");
    assert.ok(assessment.functionTypeLabel);
  });

  it("marks HIPAA controls N/A when no PHI signals", () => {
    const agent = {
      id: "a3",
      name: "generic",
      category: "cloud",
      owner: "platform",
      metadata: { evidenceClass: "cloud_ai_runtime", deep: {} }
    };
    const assessment = assessAgent(agent, { frameworks: ["hipaa"] });
    const na = assessment.findings.filter((f) => f.status === "not_applicable");
    assert.ok(na.length >= 4);
  });
});
