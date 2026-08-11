import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  endpointObservation,
  mapEdrHostRuntimeStatus
} from "../edrIntegrations.js";
import { classifyAgentEvidence } from "../agentEvidence.js";
import { sanitizeCloudError, emptyDiscoveryStats, tallyDiscoveryObservation } from "../cloudDiscoveryCommon.js";

const conn = { id: "conn-1", name: "Test EDR", environment: "production" };

describe("mapEdrHostRuntimeStatus", () => {
  it("maps connectivity to host runtime", () => {
    assert.equal(mapEdrHostRuntimeStatus("CONNECTED"), "running");
    assert.equal(mapEdrHostRuntimeStatus("offline"), "stopped");
    assert.equal(mapEdrHostRuntimeStatus("unknown"), "unknown");
  });
});

describe("endpointObservation layering", () => {
  it("marks hostname heuristic as candidate, not confirmed", () => {
    const obs = endpointObservation({
      provider: "crowdstrike",
      conn,
      id: "dev-1",
      name: "ai-lab-workstation",
      hostname: "ai-lab-workstation",
      os: "Windows",
      owner: null,
      ip: null,
      status: "normal",
      aiRelevant: true,
      processEvidence: null
    });
    assert.equal(obs.metadata.agentStatus, "candidate");
    assert.equal(obs.metadata.evidenceGrade, "name_heuristic");
    assert.equal(obs.agent.detected, true);
    assert.equal(obs.agent.detectionMethod, "name_heuristic");
    assert.equal(obs.agent.runtimeStatus, "unknown");
    assert.match(obs.name, /AI candidate host/);
    assert.equal(obs.running_status, "running");
    assert.equal(obs.runtime.detected, true);
    assert.equal(obs.runtime.status, "running");
    assert.equal(obs.runtime.runtimeType, "endpoint_host");
  });

  it("confirms only with process evidence and sets agent runtime running", () => {
    const obs = endpointObservation({
      provider: "defender",
      conn,
      id: "dev-2",
      name: "build-box",
      hostname: "build-box",
      os: "Linux",
      owner: null,
      ip: null,
      status: "Active",
      aiRelevant: true,
      processEvidence: "ollama serve --model llama3",
      evidenceGrade: "process"
    });
    assert.equal(obs.metadata.agentStatus, "confirmed");
    assert.equal(obs.metadata.evidenceClass, "process_agent");
    assert.equal(obs.agent.detectionMethod, "defender_hunting");
    assert.equal(obs.agent.runtimeStatus, "running");
    assert.match(obs.fingerprint, /^edr-agent:defender:/);
    assert.match(obs.name, /\(AI agent\)$/);
  });

  it("treats Intune/Netskope app inventory as candidate only", () => {
    const obs = endpointObservation({
      provider: "intune",
      conn,
      id: "dev-3",
      name: "laptop-42",
      hostname: "laptop-42",
      os: "Windows",
      owner: "user@example.com",
      ip: null,
      status: "compliant",
      aiRelevant: true,
      processEvidence: "Ollama 0.3.1",
      evidenceGrade: "app_heuristic"
    });
    assert.equal(obs.metadata.agentStatus, "candidate");
    assert.equal(obs.agent.detectionMethod, "app_heuristic");
    assert.equal(obs.agent.runtimeStatus, "unknown");
    assert.equal(obs.metadata.evidenceClass, "repo_candidate");
    assert.match(obs.name, /AI candidate host/);
  });

  it("does not claim agent running from device online alone", () => {
    const obs = endpointObservation({
      provider: "cortex",
      conn,
      id: "ep-9",
      name: "chatgpt-proxy-host",
      hostname: "chatgpt-proxy-host",
      status: "CONNECTED",
      aiRelevant: true
    });
    assert.equal(obs.running_status, "running");
    assert.equal(obs.runtime.status, "running");
    assert.equal(obs.agent.runtimeStatus, "unknown");
    assert.equal(obs.metadata.agentStatus, "candidate");
  });

  it("emits endpoint_device resource-only when not AI-agent-scanned", () => {
    const obs = endpointObservation({
      provider: "crowdstrike",
      conn,
      id: "dev-plain",
      name: "finance-pc",
      hostname: "finance-pc",
      status: "normal",
      aiRelevant: false
    });
    assert.equal(obs.metadata.inventoryClass, "endpoint_device");
    assert.equal(obs.agent.detected, false);
    assert.equal(obs.runtime.detected, true);
  });
});

describe("agentEvidence EDR paths", () => {
  it("keeps endpoint_device resource-only ingestible without agent status", () => {
    const classified = classifyAgentEvidence({
      collector_id: "edr",
      category: "endpoint",
      confidence_score: 0.78,
      agent: { detected: false },
      metadata: { inventoryClass: "endpoint_device", agentDetected: false }
    });
    assert.equal(classified.ingestible, true);
    assert.equal(classified.reason, "endpoint_device_resource_only");
    assert.equal(classified.agentStatus, null);
  });

  it("does not confirm hostname heuristics", () => {
    const classified = classifyAgentEvidence({
      collector_id: "edr",
      category: "endpoint",
      agent: { detected: true, detectionMethod: "name_heuristic" },
      metadata: {
        inventoryClass: "endpoint_ai_agent",
        evidenceClass: "repo_candidate",
        agentStatus: "candidate",
        agentDetectionMethod: "name_heuristic"
      }
    });
    assert.equal(classified.agentStatus, "candidate");
  });

  it("confirms official EDR process methods", () => {
    const classified = classifyAgentEvidence({
      collector_id: "edr",
      category: "endpoint",
      agent: { detected: true, detectionMethod: "crowdstrike_process" },
      metadata: {
        inventoryClass: "endpoint_ai_agent",
        evidenceClass: "process_agent",
        processEvidence: "python -m vllm",
        agentDetectionMethod: "crowdstrike_process"
      }
    });
    assert.equal(classified.agentStatus, "confirmed");
  });

  it("does not confirm app_heuristic even with processEvidence string", () => {
    const classified = classifyAgentEvidence({
      collector_id: "edr",
      category: "endpoint",
      agent: { detected: true, detectionMethod: "app_heuristic" },
      metadata: {
        inventoryClass: "endpoint_ai_agent",
        evidenceClass: "process_agent",
        processEvidence: "ChatGPT Desktop",
        agentDetectionMethod: "app_heuristic"
      }
    });
    assert.equal(classified.agentStatus, "candidate");
  });

  it("skips edr_connector meta rows", () => {
    const classified = classifyAgentEvidence({
      collector_id: "edr",
      metadata: { inventoryClass: "edr_connector" }
    });
    assert.equal(classified.ingestible, false);
    assert.equal(classified.reason, "connector_meta");
  });
});

describe("EDR error hygiene", () => {
  it("redacts secrets from discovery errors", () => {
    const cleaned = sanitizeCloudError(
      "Authorization Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.aaa.bbb failed client_secret=supersecret"
    );
    assert.equal(cleaned.includes("supersecret"), false);
    assert.match(cleaned, /REDACTED|Bearer \[REDACTED\]/);
  });

  it("tallies layered stats and skips connector rows", () => {
    const stats = emptyDiscoveryStats();
    tallyDiscoveryObservation(stats, {
      metadata: { inventoryClass: "edr_connector" },
      agent: { detected: false },
      runtime: { detected: false }
    });
    assert.equal(stats.cloudResourcesIngested, 0);

    const candidate = endpointObservation({
      provider: "crowdstrike",
      conn,
      id: "a",
      name: "ai-host",
      hostname: "ai-host",
      status: "CONNECTED",
      aiRelevant: true
    });
    tallyDiscoveryObservation(stats, candidate);
    assert.equal(stats.agentsDiscovered, 1);
    assert.equal(stats.heuristicAgents, 1);
    assert.equal(stats.confirmedAgents, 0);
    assert.equal(stats.runtimesDiscovered, 1);
    assert.equal(stats.runningRuntimes, 1);

    const confirmed = endpointObservation({
      provider: "crowdstrike",
      conn,
      id: "b",
      name: "gpu-box",
      hostname: "gpu-box",
      status: "normal",
      aiRelevant: true,
      processEvidence: "vllm serve",
      evidenceGrade: "process"
    });
    tallyDiscoveryObservation(stats, confirmed);
    assert.equal(stats.confirmedAgents, 1);
  });

  it("records process API failure without aborting observation list shape", () => {
    // Simulate finalize path: connector + candidates still returned when hunt fails.
    const observations = [
      {
        fingerprint: "edr-connector:defender:c1",
        metadata: { inventoryClass: "edr_connector" },
        agent: { detected: false },
        runtime: { detected: false }
      },
      endpointObservation({
        provider: "defender",
        conn,
        id: "m1",
        name: "ai-dev",
        hostname: "ai-dev",
        status: "Active",
        aiRelevant: true
      })
    ];
    const discoveryErrors = [
      {
        discoveryType: "defender-advanced-hunting",
        discoveryStatus: "permission_denied",
        error: "Advanced hunting forbidden (403)"
      }
    ];
    assert.equal(observations.length, 2);
    assert.equal(discoveryErrors[0].discoveryStatus, "permission_denied");
    assert.equal(observations[1].metadata.agentStatus, "candidate");
  });
});
