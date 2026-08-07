import { Router } from "express";
import { auth, requireRole } from "../middleware/auth.js";
import * as discoveryController from "../controllers/discovery.controller.js";

const router = Router();

router.get("/changes", auth, discoveryController.changes);
router.get("/jobs", auth, discoveryController.jobs);
router.post("/jobs", auth, requireRole("platform_admin", "operator"), discoveryController.createJob);
router.get("/events", auth, discoveryController.events);

export default router;
