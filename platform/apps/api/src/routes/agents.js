import { Router } from "express";
import { auth, requireRole } from "../middleware/auth.js";
import * as agentsController from "../controllers/agents.controller.js";

const router = Router();

router.get("/", auth, agentsController.list);
router.post("/purge", auth, requireRole("platform_admin", "operator"), agentsController.purgeInventory);
router.get("/export", auth, agentsController.exportAgents);
router.get("/:id", auth, agentsController.getById);
router.get("/:id/anatomy", auth, agentsController.anatomy);

export default router;
