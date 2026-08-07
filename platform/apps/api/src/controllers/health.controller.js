import { pool } from "../db/postgres.js";
import { neo4jDriver } from "../db/neo4j.js";
import { IS_PROD } from "../config.js";

export async function checkHealth(req, res) {
  res.json({
    status: "ok",
    service: "visentra-api",
    env: IS_PROD ? "production" : "development",
    neo4j: Boolean(neo4jDriver)
  });
}

export async function checkReady(req, res) {
  try {
    await pool.query("SELECT 1");
    if (neo4jDriver) {
      const session = neo4jDriver.session();
      try {
        await session.run("RETURN 1 AS ok");
      } finally {
        await session.close();
      }
    }
    res.json({ status: "ready", postgres: true, neo4j: Boolean(neo4jDriver) });
  } catch (err) {
    res.status(503).json({ status: "not_ready", error: IS_PROD ? "dependency check failed" : err.message });
  }
}
