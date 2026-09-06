import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { ALLOW } from "../../utils/http.js";

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, "../azureDeepScan.js"), "utf8");

describe("Azure scanner optimizations", () => {
  it("caps ARM listing and deep-scans with bounded concurrency", () => {
    assert.match(src, /ARM_LIST_MAX_ITEMS/);
    assert.match(src, /ARM_LIST_MAX_PAGES/);
    assert.match(src, /ARM_DEEP_SCAN_CONCURRENCY/);
    assert.match(src, /mapPool\(selected, ARM_DEEP_SCAN_CONCURRENCY/);
  });

  it("shares one Graph token across Entra/Teams/Agent365 planes", () => {
    assert.match(src, /sharedGraphToken/);
    assert.match(src, /discoverEntraAgentIdentities\(conn, graphOpts\)/);
    assert.match(src, /discoverTeamsAgentApps\(conn, graphOpts\)/);
    assert.match(src, /discoverAgent365CatalogForAzure\(conn, graphOpts\)/);
  });

  it("stops paging Graph/Teams at maxItems and skips disabled M365 registry", () => {
    assert.match(src, /maxItems:\s*ENTRA_AGENT_ID_MAX/);
    assert.match(src, /maxItems:\s*TEAMS_CATALOG_MAX_APPS/);
    assert.match(src, /if \(M365_AGENT_REGISTRY_SCAN\)/);
  });

  it("registers Power Platform / Dataverse allowlists centrally", () => {
    assert.ok(ALLOW.powerPlatformAdmin);
    assert.ok(ALLOW.dataverse);
    assert.match(src, /ALLOW\.powerPlatformAdmin/);
    assert.match(src, /ALLOW\.dataverse/);
  });
});
