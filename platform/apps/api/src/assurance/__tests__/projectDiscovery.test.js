import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { evaluateControl, getAssuranceControl } from "../effectiveness.js";
import { projectAssuranceFacts } from "../projectDiscovery.js";

describe("projectAssuranceFacts", () => {
  it("keeps Foundry identity and tools without claiming unread permission planes", () => {
    const facts = projectAssuranceFacts(
      {
        name: "ai-red-team",
        model: "gpt-4o",
        identity_used: "ai-red-team-AgentIdentity",
        tools: [{ type: "code_interpreter", name: "code_interpreter" }],
        permissions: [],
        metadata: {
          objectId: "39ae895a",
          foundationModel: "gpt-4o",
          foundryLink: { accountName: "foundry-baseline", projectName: "agents", inferredAgentName: "ai-red-team" }
        }
      },
      []
    );

    assert.equal(facts.snapshot.coverage.authorization, false);
    assert.equal(facts.snapshot.coverage.database, false);
    assert.equal(facts.snapshot.coverage.api, false);
    assert.equal(facts.snapshot.coverage.runtime, false);
    assert.ok(facts.snapshot.chain.some((step) => step.name === "gpt-4o"));
    assert.ok(facts.snapshot.capabilities.some((item) => item.resource === "code_interpreter"));
    const result = evaluateControl({
      control: getAssuranceControl("C-002"),
      snapshot: facts.snapshot,
      events: facts.events
    });
    assert.equal(result.status, "unknown");
  });

  it("turns a real gateway route and an OTel span into api capability and a runtime event", () => {
    const facts = projectAssuranceFacts(
      { name: "gateway-agent", tools: [], permissions: [], metadata: {} },
      [
        {
          collector_id: "api_gateway",
          payload: {
            collector_id: "api_gateway",
            metadata: { discoveryMode: "api-gateway-routes", routePath: "/v1/chat", targetHost: "api.openai.com" }
          }
        },
        {
          observed_at: "2026-09-17T12:00:00.000Z",
          payload: {
            collector_id: "otel_tracing",
            name: "doc-researcher",
            model: "gpt-4o-mini",
            metadata: {
              discoveryMode: "otel-runtime-traces",
              spanName: "invoke_agent doc-researcher",
              runtime: { operation: "invoke_agent", httpMethod: "POST", httpTarget: "/v1/responses" }
            }
          }
        }
      ]
    );

    assert.equal(facts.snapshot.coverage.api, true);
    assert.equal(facts.snapshot.coverage.runtime, true);
    assert.equal(facts.events[0].source, "discovery:otel");
    assert.equal(facts.events[0].resource, "/v1/responses");
    assert.equal(facts.events[0].kind, "api");
  });

  it("maps a collected database permission without inventing a runtime breach", () => {
    const facts = projectAssuranceFacts(
      {
        name: "sql-agent",
        permissions: ["Microsoft.Sql/servers/databases/write"],
        tools: [],
        metadata: {}
      },
      []
    );
    assert.equal(facts.snapshot.coverage.database, true);
    const result = evaluateControl({
      control: getAssuranceControl("C-002"),
      snapshot: facts.snapshot,
      events: []
    });
    assert.equal(result.status, "ineffective");
  });

  it("does not treat a host-inferred model as an observed model", () => {
    const facts = projectAssuranceFacts(
      {
        name: "proxy-agent",
        model: "gpt-4o",
        tools: [],
        permissions: [],
        metadata: { modelSource: "host_inference" }
      },
      []
    );
    assert.equal(facts.snapshot.chain.some((step) => step.step === "model"), false);
  });
});
