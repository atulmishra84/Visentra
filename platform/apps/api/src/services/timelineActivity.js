function text(value) {
  const raw = String(value ?? "").trim();
  return raw || null;
}

function inventoryItem(agent) {
  const detail = [agent.category, agent.model || agent.framework, agent.owner].map(text).filter(Boolean);
  return {
    id: `agent:${agent.id}`,
    timestamp: agent.first_discovered || agent.last_seen || null,
    title: text(agent.name) || "Agent",
    description: detail.length ? `Entered inventory · ${detail.join(" · ")}` : "Entered inventory",
    type: "inventory"
  };
}

function discoveryItem(event) {
  const kind = text(event.event_type) || "discovery";
  return {
    id: `event:${event.id}`,
    timestamp: event.created_at || null,
    title: kind.replace(/[._]/g, " "),
    description: text(event.message) || "Discovery activity",
    type: "discovery"
  };
}

function relationshipItem(rel) {
  const fromName = text(rel.from_name) || text(rel.from_type) || "agent";
  const toName = text(rel.to_name) || text(rel.to_type) || "asset";
  return {
    id: `rel:${rel.id}`,
    timestamp: rel.last_seen || rel.created_at || null,
    title: text(rel.rel_type) || "relationship",
    description: `${fromName} → ${toName}`,
    type: "relationship"
  };
}

export function buildTimelineActivity({ agents = [], events = [], relationships = [] } = {}) {
  const items = [
    ...agents.map(inventoryItem),
    ...events.map(discoveryItem),
    ...relationships.map(relationshipItem)
  ]
    .filter((item) => item.timestamp)
    .sort((left, right) => new Date(right.timestamp).getTime() - new Date(left.timestamp).getTime())
    .slice(0, 200);

  return {
    items,
    events: items,
    timeline: items,
    dashboard: { items, events: items, timeline: items }
  };
}
