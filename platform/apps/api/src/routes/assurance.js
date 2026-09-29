import { Router } from "express";
import { auth } from "../middleware/auth.js";
import * as assurance from "../controllers/assurance.controller.js";

const router = Router();

router.get("/catalog", auth, assurance.catalog);
router.get("/summary", auth, assurance.summary);
router.get("/agents/:agentId", auth, assurance.detail);
router.post("/agents/:agentId/assignments", auth, assurance.assign);
router.delete("/agents/:agentId/assignments/:controlId", auth, assurance.unassign);
router.post("/agents/:agentId/permissions", auth, assurance.permissions);
router.post("/agents/:agentId/events", auth, assurance.events);
router.post("/agents/:agentId/evaluate", auth, assurance.evaluate);
router.post("/agents/:agentId/baseline", auth, assurance.baseline);

export default router;
