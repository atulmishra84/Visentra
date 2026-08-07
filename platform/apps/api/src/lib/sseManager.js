/** @type {Map<string, Set<import('express').Response>>} */
export const sseClients = new Map();

export function broadcast(tenantId, event) {
  const set = sseClients.get(tenantId);
  if (!set) return;
  const payload = `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
  for (const res of set) {
    try {
      res.write(payload);
    } catch {
      /* ignore */
    }
  }
}
