import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { agentFilters } from "../../lib/agentFilters.js";

const here = dirname(fileURLToPath(import.meta.url));
const azureDeepScanSrc = readFileSync(join(here, "../azureDeepScan.js"), "utf8");

describe("Entra agents visibility fixes", () => {
  it("cast loop only commits on non-empty Graph agentIdentity pages", () => {
    assert.match(
      azureDeepScanSrc,
      /if \(result\.ok && count > 0\)/,
      "must continue to beta/filter when v1.0 returns 200 []"
    );
    assert.doesNotMatch(
      azureDeepScanSrc,
      /if \(result\.ok\) \{\s*items = result\.items \|\| \[\];\s*sourceApi =[\s\S]*?break;/
    );
  });

  it("caps unbounded servicePrincipals client fallback", () => {
    assert.match(azureDeepScanSrc, /maxItems:\s*clientCap/);
    assert.match(azureDeepScanSrc, /graphGetAllPages\([\s\S]*?maxItems/);
  });

  it("warns on empty Entra plane, not only permission_denied", () => {
    assert.match(azureDeepScanSrc, /entraEmpty/);
    assert.match(azureDeepScanSrc, /Entra Agent ID plane returned 0 identities/);
  });

  it("Inventory Cloud surface includes cloud_provider rows (Entra identity)", () => {
    const cloud = agentFilters({ surface: "cloud" });
    assert.match(cloud.clauses, /cloud_provider IS NOT NULL/);
    assert.match(cloud.clauses, /category,''\)\) = 'cloud'/);

    const legacy = agentFilters({ category: "cloud" });
    assert.match(legacy.clauses, /cloud_provider IS NOT NULL/);

    const identity = agentFilters({ category: "identity" });
    assert.match(identity.clauses, /category ILIKE/);
    assert.equal(identity.params[0], "%identity%");
  });
});
