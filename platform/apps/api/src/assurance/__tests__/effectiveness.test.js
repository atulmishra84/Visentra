import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  detectDrift,
  evaluateControl,
  getAssuranceControl,
  postureFromSnapshot
} from "../effectiveness.js";

const snapshot = {
  id: "snap-1",
  source: "entra+azure_sql+apim",
  coverage: { authorization: true, database: true, api: true, runtime: true },
  chain: [
    { step: "credential", name: "svc-patient-support" },
    { step: "identity", name: "patient-support-sp" },
    { step: "role", name: "patient.read" },
    { step: "role", name: "patient.update" }
  ],
  capabilities: [
    { kind: "role", operation: "READ", resource: "patient", dataClass: "phi", allowed: true },
    { kind: "database", operation: "UPDATE", resource: "Patient DB", dataClass: "phi", allowed: true },
    { kind: "api", operation: "GET", resource: "/diagnosis", dataClass: "phi", allowed: true },
    { kind: "database", operation: "DELETE", resource: "Patient DB", allowed: false, destructive: true }
  ]
};

const events = [
  { id: "e1", kind: "api", action: "GET", operation: "GET", resource: "/patient/123", dataClass: "phi", decision: "allowed" },
  { id: "e2", kind: "api", action: "GET", operation: "GET", resource: "/diagnosis/123", dataClass: "phi", decision: "allowed" },
  { id: "e3", kind: "database", action: "PUT", operation: "UPDATE", resource: "Patient DB", dataClass: "phi", decision: "allowed" }
];

describe("patient support assurance", () => {
  it("marks PHI access and database write as violated when runtime matches an allowed capability", () => {
    const phi = evaluateControl({
      control: getAssuranceControl("C-001"),
      snapshot,
      events
    });
    const write = evaluateControl({
      control: getAssuranceControl("C-002"),
      snapshot,
      events
    });
    assert.equal(phi.status, "violated");
    assert.equal(write.status, "violated");
    assert.equal(phi.effectivePermission.allowed, true);
    assert.ok(phi.evidence.some((item) => item.type === "runtime_event"));
    assert.ok(write.evidence.some((item) => item.type === "permission_chain"));
  });

  it("marks approved APIs effective and destructive delete effective when capability denies it", () => {
    const apis = evaluateControl({
      control: getAssuranceControl("C-003"),
      parameters: { apiAllowlist: ["/patient", "/diagnosis"] },
      snapshot,
      events
    });
    const destructive = evaluateControl({
      control: getAssuranceControl("C-004"),
      snapshot,
      events
    });
    assert.equal(apis.status, "effective");
    assert.equal(destructive.status, "effective");
  });

  it("stays ineffective when the credential can write and no runtime event has been seen", () => {
    const write = evaluateControl({
      control: getAssuranceControl("C-002"),
      snapshot: { ...snapshot, coverage: { ...snapshot.coverage, runtime: false } },
      events: []
    });
    assert.equal(write.status, "ineffective");
  });

  it("stays unknown when the permission plane was not read", () => {
    const phi = evaluateControl({
      control: getAssuranceControl("C-001"),
      snapshot: { coverage: { runtime: true }, capabilities: [], chain: [] },
      events: []
    });
    assert.equal(phi.status, "unknown");
  });

  it("records a blocked violation when enforcement stops the write", () => {
    const write = evaluateControl({
      control: getAssuranceControl("C-002"),
      snapshot,
      events: [
        { id: "e4", kind: "database", operation: "UPDATE", resource: "Patient DB", decision: "blocked" }
      ]
    });
    assert.equal(write.status, "blocked_violation");
  });

  it("flags critical drift when PHI flips from deny to allow", () => {
    const baseline = { phi: "deny", databaseWrite: "deny", permissionFingerprint: "a", toolCount: 5, mcpCount: 2 };
    const current = postureFromSnapshot({
      coverage: { authorization: true, database: true },
      capabilities: [{ allowed: true, dataClass: "phi", kind: "database", operation: "UPDATE", resource: "Patient DB" }],
      toolCount: 8,
      mcpCount: 4
    });
    const drift = detectDrift(baseline, { ...current, toolCount: 8, mcpCount: 4 });
    assert.equal(drift.drifted, true);
    assert.equal(drift.severity, "critical");
    assert.ok(drift.changes.some((change) => change.field === "phi" && change.to === "allow"));
    assert.ok(drift.changes.some((change) => change.field === "tools"));
  });
});
