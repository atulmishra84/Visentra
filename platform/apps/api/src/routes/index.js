import { Router } from "express";
import healthRoutes from "./health.js";
import authRoutes from "./auth.js";
import ssoRoutes from "./sso.js";
import agentsRoutes from "./agents.js";
import meshRoutes from "./mesh.js";
import graphRoutes from "./graph.js";
import searchRoutes from "./search.js";
import discoveryRoutes from "./discovery.js";
import shadowAiRoutes from "./shadowAi.js";
import dashboardsRoutes from "./dashboards.js";
import usageRoutes from "./usage.js";
import aiBomRoutes from "./aiBom.js";
import complianceRoutes from "./compliance.js";
import exportRoutes from "./export.js";
import auditRoutes from "./audit.js";
import connectorsRoutes from "./connectors.js";
import integrationsRoutes from "./integrations.js";

const router = Router();

// Mount all routes
router.use("/", healthRoutes); // /health, /ready
router.use("/api/auth", authRoutes);
router.use("/api/settings/sso", ssoRoutes);
router.use("/api/agents", agentsRoutes);
router.use("/api", meshRoutes); // /api/risk/paths, /api/mesh
router.use("/api/graph", graphRoutes);
router.use("/api/search", searchRoutes);
router.use("/api/discovery", discoveryRoutes);
router.use("/api/shadow-ai", shadowAiRoutes);
router.use("/api/dashboards", dashboardsRoutes);
router.use("/api/usage", usageRoutes);
router.use("/api/coverage", usageRoutes); // map /api/coverage explicitly to usageRoutes if not nested
router.use("/api/ai-bom", aiBomRoutes);
router.use("/api/compliance", complianceRoutes);
router.use("/api/export", exportRoutes);
router.use("/api/audit", auditRoutes);
router.use("/api/connectors", connectorsRoutes);
router.use("/api/integrations", integrationsRoutes);

export default router;
