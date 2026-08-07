import { Router } from "express";
import { auth } from "../middleware/auth.js";
import * as dashboardsController from "../controllers/dashboards.controller.js";

const router = Router();

router.get("/:name", auth, dashboardsController.getDashboard);

export default router;
