import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { discoveryJobStaleMs } from "../pipeline.js";

describe("discoveryJobStaleMs", () => {
  it("defaults to 10 minutes", () => {
    assert.equal(discoveryJobStaleMs({}), 10 * 60 * 1000);
  });

  it("honors DISCOVERY_JOB_STALE_MS", () => {
    assert.equal(discoveryJobStaleMs({ DISCOVERY_JOB_STALE_MS: "60000" }), 60_000);
  });

  it("treats 0 as expire-all-running", () => {
    assert.equal(discoveryJobStaleMs({ DISCOVERY_JOB_STALE_MS: "0" }), 0);
  });
});
