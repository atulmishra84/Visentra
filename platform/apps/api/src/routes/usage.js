import { Router } from "express";
import { auth } from "../middleware/auth.js";
import * as usageController from "../controllers/usage.controller.js";

const router = Router();

router.get("/export", auth, usageController.exportCsv);
router.get("/providers", auth, usageController.providers);
router.get("/evidence", auth, usageController.evidence);
router.get("/trends", auth, usageController.trends);

// coverage is technically not under /usage but we can group it here
router.get("/coverage", auth, usageController.coverage);

export default router;
