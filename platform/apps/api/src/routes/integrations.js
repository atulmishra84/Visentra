import { Router } from "express";
import { auth, requireRole } from "../middleware/auth.js";
import * as naxriController from "../controllers/naxri.controller.js";
import * as attestController from "../controllers/attest.controller.js";

const router = Router();

router.get("/naxri", auth, naxriController.getConfig);
router.put("/naxri", auth, requireRole("platform_admin", "operator"), naxriController.putConfig);
router.get("/naxri/feed", auth, naxriController.getFeed);
router.post("/naxri/sync", auth, requireRole("platform_admin", "operator"), naxriController.syncNow);
router.post("/naxri/test", auth, requireRole("platform_admin", "operator"), naxriController.testConnection);

router.get("/attest", auth, attestController.getConfig);
router.put("/attest", auth, requireRole("platform_admin", "operator"), attestController.putConfig);
router.get("/attest/feed", auth, attestController.getFeed);
router.post("/attest/sync", auth, requireRole("platform_admin", "operator"), attestController.syncNow);
router.post("/attest/test", auth, requireRole("platform_admin", "operator"), attestController.testConnection);

export default router;
