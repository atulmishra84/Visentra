import { Router } from "express";
import { auth, requireRole } from "../middleware/auth.js";
import * as aiBomController from "../controllers/aiBom.controller.js";

const router = Router();

router.get("/", auth, aiBomController.getBom);
router.get("/catalog", auth, aiBomController.getCatalog);
router.get("/agents/:id", auth, aiBomController.getAgentBom);
router.get("/enrichments/:agentId", auth, aiBomController.getEnrichmentData);
router.put("/enrichments/:agentId", auth, requireRole("platform_admin", "operator"), aiBomController.upsertEnrichmentData);
router.post("/enrichments/complete", auth, requireRole("platform_admin", "operator"), aiBomController.completeEnrichmentsBatch);
router.get("/snapshots", auth, aiBomController.listSnapshots);
router.post("/snapshots", auth, requireRole("platform_admin", "operator"), aiBomController.createSnapshot);
router.get("/snapshots/:id", auth, aiBomController.getSnapshot);
router.get("/export", auth, aiBomController.exportBom);

export default router;
