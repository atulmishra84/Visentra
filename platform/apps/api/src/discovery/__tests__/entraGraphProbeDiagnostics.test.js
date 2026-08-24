import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { decodeEntraAccessTokenClaims } from "../azureDeepScan.js";

const here = dirname(fileURLToPath(import.meta.url));

function fakeJwt(payload) {
  const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${header}.${body}.sig`;
}

describe("Azure Graph probe diagnostics", () => {
  it("decodeEntraAccessTokenClaims reads application roles", () => {
    const token = fakeJwt({
      roles: ["Directory.Read.All", "AgentIdentity.Read.All"],
      appid: "app-1",
      tid: "tenant-1",
      aud: "https://graph.microsoft.com"
    });
    const claims = decodeEntraAccessTokenClaims(token);
    assert.deepEqual(claims.roles, ["Directory.Read.All", "AgentIdentity.Read.All"]);
    assert.equal(claims.appid, "app-1");
    assert.equal(claims.tid, "tenant-1");
  });

  it("decodeEntraAccessTokenClaims returns empty roles when consent missing", () => {
    const token = fakeJwt({ appid: "app-1", tid: "tenant-1", aud: "https://graph.microsoft.com" });
    const claims = decodeEntraAccessTokenClaims(token);
    assert.deepEqual(claims.roles, []);
  });

  it("capability probe tries multiple Entra Graph paths and surfaces token roles", () => {
    const src = readFileSync(join(here, "../azureDeepScan.js"), "utf8");
    assert.match(src, /graphProbeDetail/);
    assert.match(src, /tokenRoles/);
    assert.match(src, /missingRoles/);
    assert.match(src, /readGraphProbeFailure/);
    assert.match(src, /entraProbeUrls/);
    assert.match(src, /servicePrincipalType-filter/);
    assert.match(src, /despite Graph app roles present/);
    const connectors = readFileSync(join(here, "../../services/connectors.js"), "utf8");
    assert.match(connectors, /caps\?\.message/);
    assert.match(connectors, /graphProbeDetail/);
  });
});
