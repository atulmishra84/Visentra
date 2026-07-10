/**
 * Discovery worker — periodically triggers discovery jobs via the API.
 * Collectors execute inside the API process for a single shared inventory plane.
 */
const API_URL = process.env.API_INTERNAL_URL || "http://localhost:8080";
const INTERVAL = Number(process.env.DISCOVERY_INTERVAL_MS || 300000);
const EMAIL = process.env.BOOTSTRAP_ADMIN_EMAIL || "admin@agentradar.local";
const PASSWORD = process.env.BOOTSTRAP_ADMIN_PASSWORD || "AgentRadar!dev";

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function login() {
  const res = await fetch(`${API_URL}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD })
  });
  if (!res.ok) throw new Error(`Login failed: ${res.status}`);
  const body = await res.json();
  return body.token;
}

async function trigger(token) {
  const res = await fetch(`${API_URL}/api/discovery/jobs`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({
      collectors: ["cloud_stub", "edr", "ide_filesystem", "process", "mcp", "k8s_stub"]
    })
  });
  if (!res.ok && res.status !== 202) {
    throw new Error(`Trigger failed: ${res.status}`);
  }
  console.log(new Date().toISOString(), "Discovery job triggered", res.status);
}

async function main() {
  console.log("Discovery worker starting; API=", API_URL);
  for (let i = 0; i < 60; i++) {
    try {
      const health = await fetch(`${API_URL}/health`);
      if (health.ok) break;
    } catch {
      /* wait */
    }
    await sleep(2000);
  }

  if (process.env.RUN_ON_START !== "false") {
    try {
      const token = await login();
      await trigger(token);
    } catch (err) {
      console.warn("Initial discovery trigger failed:", err.message);
    }
  }

  setInterval(async () => {
    try {
      const token = await login();
      await trigger(token);
    } catch (err) {
      console.error("Scheduled discovery failed:", err.message);
    }
  }, INTERVAL);
}

main();
