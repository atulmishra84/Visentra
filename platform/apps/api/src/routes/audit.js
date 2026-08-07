import { Router } from "express";
import { auth, requireRole } from "../middleware/auth.js";
import * as auditController from "../controllers/audit.controller.js";

const router = Router();

router.get("/", auth, requireRole("platform_admin", "operator"), auditController.getAuditEvents);

export default router;
