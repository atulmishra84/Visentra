/**
 * Relationship engine worker (MVP).
 * Edge inference currently runs inside the API discovery pipeline.
 * This process applies periodic Neo4j edge decay when NEO4J_URI is set.
 */
import neo4j from "neo4j-driver";

const INTERVAL_MS = Number(process.env.RELATIONSHIP_DECAY_INTERVAL_MS || 3600_000);
const NEO4J_URI = process.env.NEO4J_URI;
const NEO4J_USER = process.env.NEO4J_USER || "neo4j";
const NEO4J_PASSWORD = process.env.NEO4J_PASSWORD || "agentradar";
const DECAY_DAYS = Number(process.env.RELATIONSHIP_DECAY_DAYS || 30);
const MIN_CONFIDENCE = Number(process.env.RELATIONSHIP_DECAY_MIN_CONFIDENCE || 0.4);

async function decayEdges(driver) {
  const session = driver.session();
  try {
    const result = await session.run(
      `MATCH ()-[r]->()
       WHERE r.lastSeen IS NOT NULL
         AND r.lastSeen < datetime() - duration({days: $days})
         AND coalesce(r.confidence, 1.0) < $minConfidence
       WITH r LIMIT 500
       DELETE r
       RETURN count(*) AS removed`,
      { days: neo4j.int(DECAY_DAYS), minConfidence: MIN_CONFIDENCE }
    );
    const removed = result.records[0]?.get("removed")?.toNumber?.() ?? result.records[0]?.get("removed") ?? 0;
    console.log(new Date().toISOString(), `Relationship decay removed ${removed} stale edge(s)`);
  } finally {
    await session.close();
  }
}

async function main() {
  if (!NEO4J_URI) {
    console.log("Visentra relationship worker idle — NEO4J_URI not set; projection handled by API pipeline.");
    setInterval(() => {}, 60 * 60 * 1000);
    return;
  }

  const driver = neo4j.driver(NEO4J_URI, neo4j.auth.basic(NEO4J_USER, NEO4J_PASSWORD));
  console.log("Relationship worker starting; decay every", INTERVAL_MS, "ms");

  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      await decayEdges(driver);
    } catch (err) {
      console.warn("Relationship decay failed:", err.message);
    }
    await new Promise((r) => setTimeout(r, INTERVAL_MS));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
