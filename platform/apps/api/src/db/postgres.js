import pg from "pg";

export const pool = new pg.Pool({ connectionString: process.env.POSTGRES_URL });

export async function waitForPostgres() {
  let postgresReady = false;
  for (let i = 0; i < 30; i++) {
    try {
      await pool.query("SELECT 1");
      postgresReady = true;
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  if (!postgresReady) {
    throw new Error("Postgres unavailable after 60s — refusing to start");
  }
}
