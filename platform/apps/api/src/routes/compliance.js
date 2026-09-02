import { Router } from "express";
import { auth } from "../middleware/auth.js";
import * as complianceController from "../controllers/compliance.controller.js";

const router = Router();

router.get("/catalog", auth, complianceController.getCatalog);
router.get("/", auth, complianceController.listAssessments);
router.get("/agents/:id", auth, complianceController.getAgentAssessment);

export default router;
