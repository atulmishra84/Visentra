import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import {
  discoverAzureConnector,
  discoverAzureEcosystem,
  discoverEntraAgentIdentities,
  discoverPowerPlatformAgents,
  discoverTeamsAgentApps,
} from "../azureDeepScan.js";

const here = dirname(fileURLToPath(import.meta.url));

describe("Azure ecosystem scanner wiring", () => {
  it("exports discoverAzureEcosystem alongside ARM-only discoverAzureConnector", () => {
    assert.equal(typeof discoverAzureEcosystem, "function");
    assert.equal(typeof discoverAzureConnector, "function");
    assert.equal(typeof discoverEntraAgentIdentities, "function");
    assert.equal(typeof discoverPowerPlatformAgents, "function");
    assert.equal(typeof discoverTeamsAgentApps, "function");
  });

  it("wires cloud_stub collector to discoverAzureEcosystem (not ARM-only)", () => {
    const src = readFileSync(join(here, "../collectors.js"), "utf8");
    assert.match(src, /discoverAzureEcosystem/);
    assert.doesNotMatch(
      src,
      /azure:\s*discoverAzureConnector\b/,
      "collectors must not bind azure to ARM-only discoverAzureConnector",
    );
  });
});
