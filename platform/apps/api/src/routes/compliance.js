import { Router } from "express";
import { auth, requireRole } from "../middleware/auth.js";
import * as complianceController from "../controllers/compliance.controller.js";

const router = Router();

router.get("/catalog", auth, complianceController.getCatalog);
router.post(
  "/catalog/frameworks",
  auth,
  requireRole("platform_admin", "operator"),
  complianceController.createCatalogFramework
);
router.post(
  "/catalog/controls",
  auth,
  requireRole("platform_admin", "operator"),
  complianceController.createCatalogControl
);
router.get("/", auth, complianceController.listAssessments);
router.get("/agents/:id", auth, complianceController.getAgentAssessment);

export default router;
