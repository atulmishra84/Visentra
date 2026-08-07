import { pool } from "../db/postgres.js";
import { summarizeShadowFindings } from "../services/shadowAi.js";
import { publicErrorMessage } from "../utils/http.js";

export async function shadowAi(req, res) {
  try {
    const limit = Math.min(Number(req.query.limit) || 200, 500);
    // Prefer AI-ish inventory; classifier decides Shadow vs not
    const result = await pool.query(
      `SELECT * FROM agents
       WHERE tenant_id=$1
         AND (
           category IN ('ide','local','local_llm','framework','mcp','browser','autonomous','saas','container')
           OR model IS NOT NULL
           OR framework IS NOT NULL
           OR ide IS NOT NULL
           OR (category = 'cloud' AND (
             metadata->>'aiRelevant' = 'true'
             OR model = 'ai-relevant'
             OR name ILIKE '%(AI)%'
             OR name ILIKE '%ai%'
             OR name ILIKE '%openai%'
             OR name ILIKE '%copilot%'
           ))
           OR risk_indicators::text ILIKE '%shadow%'
           OR risk_indicators::text ILIKE '%unmanaged%'
           OR metadata->>'shadowAi' = 'true'
         )
       ORDER BY last_seen DESC
       LIMIT $2`,
      [req.tenantId, limit]
    );

    const summary = summarizeShadowFindings(result.rows);
    res.json({
      total: summary.total,
      byTag: summary.byTag,
      findings: summary.findings,
      items: summary.findings,
      agents: summary.findings,
      definition:
        "Shadow AI = AI agents/tools discovered without clear ownership or outside managed/sanctioned posture (visibility only)."
    });
  } catch (err) {
    console.error("shadow-ai query failed:", err);
    res.status(500).json({
      error: { message: publicErrorMessage(err, "Shadow AI query failed") },
      findings: [],
      total: 0
    });
  }
}
