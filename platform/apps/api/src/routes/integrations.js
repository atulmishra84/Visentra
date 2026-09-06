import { Router } from "express";
import { auth, requireRole } from "../middleware/auth.js";
import * as naxriController from "../controllers/naxri.controller.js";

const router = Router();

router.get("/naxri", auth, naxriController.getConfig);
router.put("/naxri", auth, requireRole("platform_admin", "operator"), naxriController.putConfig);
router.get("/naxri/feed", auth, naxriController.getFeed);
router.post("/naxri/sync", auth, requireRole("platform_admin", "operator"), naxriController.syncNow);
router.post("/naxri/test", auth, requireRole("platform_admin", "operator"), naxriController.testConnection);

export default router;
