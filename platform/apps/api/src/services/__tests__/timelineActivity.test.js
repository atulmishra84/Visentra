import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildTimelineActivity } from "../timelineActivity.js";

describe("buildTimelineActivity", () => {
  it("orders inventory, discovery, and relationships and exposes them at the top level", () => {
    const payload = buildTimelineActivity({
      agents: [
        {
          id: "a1",
          name: "ai-red-team",
          first_discovered: "2026-09-01T10:00:00.000Z",
          category: "identity",
          model: "gpt-4o",
          owner: null
        }
      ],
      events: [
        {
          id: 9,
          event_type: "job.started",
          message: "Discovery job started",
          created_at: "2026-09-17T12:00:00.000Z"
        }
      ],
      relationships: [
        {
          id: "r1",
          rel_type: "USES_MODEL",
          from_type: "Agent",
          from_name: "ai-red-team",
          to_type: "AIModelService",
          to_name: "gpt-4o",
          last_seen: "2026-09-17T12:05:00.000Z"
        }
      ]
    });

    assert.deepEqual(
      payload.items.map((item) => item.type),
      ["relationship", "discovery", "inventory"]
    );
    assert.equal(payload.items[0].description, "ai-red-team → gpt-4o");
    assert.equal(payload.items[2].title, "ai-red-team");
    assert.equal(payload.events, payload.items);
    assert.equal(payload.dashboard.items, payload.items);
  });

  it("drops rows that have no time", () => {
    const payload = buildTimelineActivity({
      agents: [{ id: "a1", name: "unread", first_discovered: null, last_seen: null }],
      events: [],
      relationships: []
    });
    assert.equal(payload.items.length, 0);
  });
});
