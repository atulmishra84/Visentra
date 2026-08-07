import { pool, waitForPostgres } from "./db/postgres.js";
import { neo4jDriver, initNeo4jConstraints } from "./db/neo4j.js";
import { purgeDemoInventory, purgeNonAiInventory } from "./lib/inventoryPurge.js";
import { migrate } from "./migrate.js";
import { migrateConnectorEncryption } from "./utils/crypto.js";
import { IS_PROD, assertProductionConfig } from "./config.js";
import app from "./app.js";

assertProductionConfig();

const PORT = Number(process.env.PORT || 8080);

async function boot() {
  await waitForPostgres();

  const tenantId = await migrate(pool);
  await migrateConnectorEncryption(pool);
  await initNeo4jConstraints();

  // Always purge legacy demo/stub inventory. Live connectors are the only seed.
  await purgeDemoInventory(pool, neo4jDriver, tenantId);
  await purgeNonAiInventory(pool, neo4jDriver, tenantId);
  console.log("Boot complete. Inventory starts from connectors/discovery only (no demo seed).");

  app.listen(PORT, () => {
    console.log(`Visentra API listening on :${PORT} (${IS_PROD ? "production" : "development"})`);
  });
}

boot().catch((err) => {
  console.error("Fatal boot error:", err);
  process.exit(1);
});
