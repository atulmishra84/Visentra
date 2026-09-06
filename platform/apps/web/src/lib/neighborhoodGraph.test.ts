import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { GraphEdge, GraphNode } from "./api";
import {
  filterNeighborhood,
  neighborhoodKpis,
  neuralLayout,
  nodeLayer,
  nodeRisk,
  securityLayout
} from "./neighborhoodGraph";

const agent: GraphNode = {
  id: "a1",
  type: "Agent",
  name: "claims-bot",
  category: "agent",
  shadowAi: true,
  shadowAiScore: 80,
  shadowAiTags: ["shadow_ai", "phi"]
};

const identity: GraphNode = {
  id: "i1",
  type: "Identity",
  name: "svc-claims",
  category: "identity"
};

const tool: GraphNode = {
  id: "t1",
  type: "Tool",
  name: "update-claim",
  category: "tool"
};

const kb: GraphNode = {
  id: "d1",
  type: "BedrockKnowledgeBase",
  name: "claims-kb",
  kindLabel: "BedrockKnowledgeBase"
};

const edges: GraphEdge[] = [
  { id: "e1", source: "i1", target: "a1", type: "ASSUMES" },
  { id: "e2", source: "a1", target: "t1", type: "USES_TOOL" },
  { id: "e3", source: "a1", target: "d1", type: "USES_KNOWLEDGE_BASE" }
];

describe("neighborhoodGraph", () => {
  it("assigns security layers left to right", () => {
    assert.equal(nodeLayer(identity), "identity");
    assert.equal(nodeLayer(agent), "agent");
    assert.equal(nodeLayer(tool), "runtime");
    assert.equal(nodeLayer(kb), "data");
  });

  it("treats high-score shadow agents as critical", () => {
    assert.equal(nodeRisk(agent), "critical");
    assert.equal(nodeRisk(tool), "low");
  });

  it("lays out layers in Identity → Agent → Runtime → Data columns", () => {
    const laid = securityLayout([agent, identity, tool, kb]);
    const xs = Object.fromEntries(laid.map((node) => [node.id, node.x]));
    assert.ok(xs.i1 < xs.a1 && xs.a1 < xs.t1 && xs.t1 < xs.d1);
  });

  it("filters by relationship scope without dropping the seed neighborhood", () => {
    const filtered = filterNeighborhood([agent, identity, tool, kb], edges, {
      relTypes: ["USES_TOOL"]
    });
    assert.deepEqual(
      filtered.nodes.map((node) => node.id).sort(),
      ["a1", "t1"]
    );
    assert.equal(filtered.edges.length, 1);
  });

  it("places the seed agent at the neural-network center", () => {
    const laid = neuralLayout([agent, identity, tool, kb], edges, "a1");
    const byId = Object.fromEntries(laid.map((node) => [node.id, node]));
    assert.equal(byId.a1.ring, 0);
    const dist = (id: string) => Math.hypot(byId[id].x - byId.a1.x, byId[id].y - byId.a1.y);
    assert.ok(dist("i1") > 80);
    assert.ok(dist("t1") > 80);
    assert.ok(dist("d1") > 80);
  });

  it("counts shadow and critical KPIs", () => {
    const kpis = neighborhoodKpis([agent, identity, tool, kb], edges);
    assert.equal(kpis.nodes, 4);
    assert.equal(kpis.edges, 3);
    assert.equal(kpis.critical, 1);
    assert.equal(kpis.shadow, 1);
    assert.equal(kpis.isolated, 0);
  });
});
