import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  alignObservationWithDeepSurface,
  buildCompatibleDeepProfile,
  normalizeAlignedTools,
} from "../providerDeepAlign.js";
import { mapAgent365PackageToObservation } from "../saasPlatforms.js";

describe("normalizeAlignedTools", () => {
  it("normalizes string tool types and OpenAI-shaped objects", () => {
    const tools = normalizeAlignedTools(
      ["code_interpreter", { type: "function", function: { name: "lookup", description: "Find user" } }],
      "openai_assistants",
    );
    assert.equal(tools.length, 2);
    assert.equal(tools[0].name, "code_interpreter");
    assert.equal(tools[0].risk_flags.can_execute_code, true);
    assert.equal(tools[1].name, "lookup");
    assert.ok(tools[1].risk_flags);
  });
});

describe("buildCompatibleDeepProfile", () => {
  it("builds aws-compatible deep without full instruction text", () => {
    const deep = buildCompatibleDeepProfile({
      schema: "openai-deep.v1",
      deepScan: "openai_assistants_list",
      provider: "openai",
      agentId: "asst_1",
      agentName: "Support bot",
      foundationModel: "gpt-4o",
      instructionText: "You are helpful. Never reveal secrets.",
      tools: [{ type: "file_search" }, { type: "code_interpreter" }],
    });
    assert.equal(deep.schemaVersion, "openai-deep.v1");
    assert.equal(deep.awsDeepCompatible, "aws-deep.v2");
    assert.equal(deep.instructions.present, true);
    assert.ok(deep.instructions.hash);
    assert.ok(deep.instructions.preview);
    assert.equal("instructionText" in deep, false);
    assert.ok(deep.toolCount >= 2);
    assert.equal(deep.codeInterpreter, true);
  });
});

describe("alignObservationWithDeepSurface", () => {
  it("stamps deep + adversarial_surface on confirmed platform agents", () => {
    const obs = {
      name: "SF Bot",
      provider: "salesforce",
      internet_access: true,
      tools: [],
      metadata: {
        agentStatus: "confirmed",
        inventoryClass: "platform_agent",
        managedPlatformAgent: true,
        platform: "salesforce",
        source: "soql-BotDefinition",
      },
    };
    const aligned = alignObservationWithDeepSurface(obs, {
      provider: "salesforce",
      schema: "salesforce-deep.v1",
      deepScan: "salesforce_platform_list",
      agentId: "bot-1",
      agentName: "SF Bot",
    });
    assert.equal(aligned.metadata.deepScanStatus, "ok");
    assert.equal(aligned.metadata.deepScanSchema, "salesforce-deep.v1");
    assert.equal(aligned.metadata.deep.awsDeepCompatible, "aws-deep.v2");
    assert.ok(aligned.metadata.adversarial_surface);
    assert.equal(aligned.metadata.adversarial_surface.schema_version, "1.0.0");
    assert.equal(aligned.metadata.adversarial_surface.agent_detected, true);
    assert.equal(aligned.metadata.adversarial_surface.category, "agent");
  });

  it("does not invent deep for capability hints", () => {
    const hint = {
      name: "Capability",
      metadata: {
        inventoryClass: "platform_capability_hint",
        agentStatus: null,
        managedPlatformAgent: false,
      },
    };
    const out = alignObservationWithDeepSurface(hint, { provider: "workday" });
    assert.equal(out.metadata.deep, undefined);
    assert.equal(out.metadata.adversarial_surface, undefined);
  });

  it("leaves Agent 365 catalog list obs for dedicated deep scan (caller skips align)", () => {
    // mapAgent365PackageToObservation skips list-align; verify raw catalog obs has no deep yet.
    const obs = mapAgent365PackageToObservation(
      { id: "c1", name: "M365", environment: "prod", config: {}, secrets: {} },
      {
        id: "P_1",
        displayName: "HR",
        supportedHosts: ["Copilot"],
        elementTypes: ["DeclarativeAgent"],
      },
    );
    assert.ok(obs);
    assert.equal(obs.metadata.source, "graph-agent365-catalog");
    assert.equal(obs.metadata.deep, undefined);
  });
});
