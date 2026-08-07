import { Router } from "express";
import * as health from "../controllers/health.controller.js";

const router = Router();

router.get("/health", health.checkHealth);
router.get("/ready", health.checkReady);

export default router;
