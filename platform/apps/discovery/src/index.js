/**
 * Discovery worker — periodically triggers discovery jobs via the API.
 * Collectors execute inside the API process for a single shared inventory plane.
 *
 * Default collectors are connector/platform oriented (no local IDE/process/MCP),
 * so inventory is not filled with host Cursor/MCP noise. Override with:
 *   DISCOVERY_COLLECTORS=cloud_stub,edr,saas_platform,...
 * Include local scanners with:
 *   DISCOVERY_LOCAL_COLLECTORS=true
 */
const API_URL = process.env.API_INTERNAL_URL || "http://localhost:8080";
const INTERVAL = Number(process.env.DISCOVERY_INTERVAL_MS || 300000);
const EMAIL = process.env.BOOTSTRAP_ADMIN_EMAIL || "admin@agentradar.local";
const PASSWORD = process.env.BOOTSTRAP_ADMIN_PASSWORD;
const IS_PROD = process.env.NODE_ENV === "production";

const CONNECTOR_COLLECTORS = [
  "cloud_stub",
  "edr",
  "saas_platform",
  "k8s_api",
  "git_sources",
  "identity_entra",
  "ci_platform"
];

const LOCAL_COLLECTORS = ["ide_filesystem", "process", "mcp"];

function resolveCollectors() {
  const fromEnv = String(process.env.DISCOVERY_COLLECTORS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (fromEnv.length) return fromEnv;
  const list = [...CONNECTOR_COLLECTORS];
  if (String(process.env.DISCOVERY_LOCAL_COLLECTORS || "").toLowerCase() === "true") {
    list.push(...LOCAL_COLLECTORS);
  }
  return list;
}

const COLLECTORS = resolveCollectors();

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function login() {
  if (!PASSWORD) {
    throw new Error("BOOTSTRAP_ADMIN_PASSWORD is required for discovery worker authentication");
  }
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
    body: JSON.stringify({ collectors: COLLECTORS })
  });
  if (!res.ok && res.status !== 202 && res.status !== 409) {
    throw new Error(`Trigger failed: ${res.status}`);
  }
  console.log(new Date().toISOString(), "Discovery job triggered", res.status, COLLECTORS.join(",") || "(none)");
}

async function main() {
  console.log(
    "Discovery worker starting; API=",
    API_URL,
    "env=",
    IS_PROD ? "production" : "development",
    "collectors=",
    COLLECTORS.join(",") || "(none)",
    "(local IDE/process/MCP disabled unless DISCOVERY_LOCAL_COLLECTORS=true)"
  );
  for (let i = 0; i < 60; i++) {
    try {
      const health = await fetch(`${API_URL}/ready`);
      if (health.ok) break;
    } catch {
      /* wait */
    }
    await sleep(2000);
  }

  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      if (!COLLECTORS.length) {
        console.log(new Date().toISOString(), "No collectors configured — waiting for connectors");
      } else {
        const token = await login();
        await trigger(token);
      }
    } catch (err) {
      console.error("Discovery worker cycle failed:", err.message);
    }
    await sleep(INTERVAL);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
