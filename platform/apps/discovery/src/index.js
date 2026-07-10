/**
 * Discovery worker — periodically triggers discovery jobs via the API.
 * Collectors execute inside the API process for a single shared inventory plane.
 */
const API_URL = process.env.API_INTERNAL_URL || "http://localhost:8080";
const INTERVAL = Number(process.env.DISCOVERY_INTERVAL_MS || 300000);
const EMAIL = process.env.BOOTSTRAP_ADMIN_EMAIL || "admin@agentradar.local";
const PASSWORD = process.env.BOOTSTRAP_ADMIN_PASSWORD;
const IS_PROD = process.env.NODE_ENV === "production";

const PROD_COLLECTORS = [
  "cloud_stub",
  "edr",
  "saas_platform",
  "k8s_api",
  "git_sources",
  "identity_entra",
  "ide_filesystem",
  "process",
  "mcp"
];
const DEV_COLLECTORS = PROD_COLLECTORS;

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
  const collectors = IS_PROD ? PROD_COLLECTORS : DEV_COLLECTORS;
  const res = await fetch(`${API_URL}/api/discovery/jobs`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({ collectors })
  });
  if (!res.ok && res.status !== 202) {
    throw new Error(`Trigger failed: ${res.status}`);
  }
  console.log(new Date().toISOString(), "Discovery job triggered", res.status, collectors.join(","));
}

async function main() {
  console.log("Discovery worker starting; API=", API_URL, "env=", IS_PROD ? "production" : "development");
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
      const token = await login();
      await trigger(token);
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
