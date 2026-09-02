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
