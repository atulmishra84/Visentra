import { Router } from "express";
import { auth } from "../middleware/auth.js";
import * as agentsController from "../controllers/agents.controller.js";

const router = Router();

router.get("/agents", auth, agentsController.exportAgents);

export default router;
