import { Router } from "express";
import { auth } from "../middleware/auth.js";
import * as agentsController from "../controllers/agents.controller.js";

const router = Router();

router.get("/", auth, agentsController.list);
router.get("/:id", auth, agentsController.getById);
router.get("/:id/anatomy", auth, agentsController.anatomy);

export default router;
