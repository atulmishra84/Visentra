import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { cypherIdent } from "../neo4j.js";

describe("cypherIdent", () => {
  it("accepts schema labels and relationship types", () => {
    assert.equal(cypherIdent("Agent"), "Agent");
    assert.equal(cypherIdent("CloudResource"), "CloudResource");
    assert.equal(cypherIdent("MCPServer"), "MCPServer");
    assert.equal(cypherIdent("INVOKES_MODEL"), "INVOKES_MODEL");
    assert.equal(cypherIdent("USES_KNOWLEDGE_BASE"), "USES_KNOWLEDGE_BASE");
  });

  it("rejects tokens that cannot be interpolated into Cypher", () => {
    assert.equal(cypherIdent("MCP Server"), null);
    assert.equal(cypherIdent("cloud-resource"), null);
    assert.equal(cypherIdent("Agent} DETACH DELETE a //"), null);
    assert.equal(cypherIdent(""), null);
    assert.equal(cypherIdent(null), null);
  });
});
