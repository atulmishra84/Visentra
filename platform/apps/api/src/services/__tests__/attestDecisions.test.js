import assert from "node:assert/strict";
import http from "http";
import { describe, it } from "node:test";
import {
  attestAgent,
  attestPolicy,
  attestReachable,
  attestSyncUrl,
  decisionRequest,
  deliverAttestFeed,
  DEFAULT_DECISIONS_URL
} from "../attestDecisions.js";

describe("Attest decisions feed", () => {
  it("registers a discovered agent and turns a runtime action into a decision request", () => {
    const agent = attestAgent({
      id: "agent-1",
      name: "ai-red-team",
      identity_used: "ai-red-team-AgentIdentity",
      cloud_provider: "azure",
      owner: "security",
      permissions: ["Microsoft.Sql/servers/databases/write"]
    });
    assert.equal(agent.id, "agent-1");
    assert.equal(agent.identity.provider, "azure");
    assert.equal(agent.identity.payload.scopes[0].name, "Microsoft.Sql/servers/databases/write");
    assert.equal("prompt" in agent, false);

    const request = decisionRequest("agent-1", {
      operation: "POST",
      resource: "/v1/responses",
      kind: "api"
    });
    assert.deepEqual(request, {
      agent_id: "agent-1",
      operation: "POST",
      resource: "/v1/responses"
    });
    assert.equal("prompt" in request, false);
  });

  it("targets the local decisions endpoint and the agent sync on the same host", () => {
    assert.equal(attestSyncUrl(DEFAULT_DECISIONS_URL), "http://127.0.0.1:3000/api/integration/agentradar/sync");
    const policy = attestPolicy(DEFAULT_DECISIONS_URL);
    assert.equal(policy.allowHttp, true);
    assert.equal(policy.allowPrivate, true);
    assert.equal(attestReachable(400, JSON.stringify({ decision: "block", error: "agent_id required" })), true);
    assert.equal(attestReachable(401, "Unauthorized"), false);
  });

  it("syncs agents before posting decisions and stops when Attest rejects a call", async () => {
    const calls = [];
    const result = await deliverAttestFeed({
      decisionsUrl: DEFAULT_DECISIONS_URL,
      apiKey: "test-key",
      agents: [{ id: "agent-1", name: "ai-red-team" }],
      requests: [
        { agent_id: "agent-1", operation: "POST", resource: "/v1/responses" },
        { agent_id: "agent-1", operation: "GET", resource: "/patient/123" }
      ],
      post: async (url, apiKey, body) => {
        calls.push({ url, apiKey, body });
        if (String(url).endsWith("/api/decisions") && body.resource === "/patient/123") {
          return { status: 404, ok: false, body: JSON.stringify({ decision: "block", reason: "Agent is not in Attest" }) };
        }
        return { status: 200, ok: true, body: JSON.stringify({ decision: "allow", reason: "Controls hold for this call." }) };
      }
    });

    assert.equal(calls[0].url, "http://127.0.0.1:3000/api/integration/agentradar/sync");
    assert.equal(calls[0].apiKey, "test-key");
    assert.equal(calls[1].url, DEFAULT_DECISIONS_URL);
    assert.equal(calls.length, 3);
    assert.equal(result.ok, false);
    assert.equal(result.decisionCount, 1);
    assert.equal(result.decisions[0].decision, "allow");
    assert.equal(result.decisions[1].decision, "block");
  });

  it("posts the agent sync and the decision to a local Attest listener", async () => {
    const seen = [];
    const server = http.createServer((req, res) => {
      const chunks = [];
      req.on("data", (chunk) => chunks.push(chunk));
      req.on("end", () => {
        seen.push({
          url: req.url,
          key: req.headers["x-api-key"],
          body: JSON.parse(Buffer.concat(chunks).toString("utf8"))
        });
        const decision = req.url === "/api/decisions";
        res.end(JSON.stringify(decision ? { decision: "allow", reason: "Controls hold for this call." } : { status: "success" }));
      });
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    try {
      const result = await deliverAttestFeed({
        decisionsUrl: `http://127.0.0.1:${port}/api/decisions`,
        apiKey: "local-key",
        agents: [{ id: "a", name: "agent" }],
        requests: [{ agent_id: "a", operation: "POST", resource: "/v1/responses" }]
      });
      assert.equal(result.ok, true);
      assert.equal(result.decisionCount, 1);
      assert.equal(seen[0].url, "/api/integration/agentradar/sync");
      assert.equal(seen[0].key, "local-key");
      assert.equal(seen[1].body.resource, "/v1/responses");
      assert.equal(seen[1].body.prompt, undefined);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});
