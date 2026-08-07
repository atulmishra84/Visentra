import { Router } from "express";
import { auth } from "../middleware/auth.js";
import * as graphController from "../controllers/graph.controller.js";

const router = Router();

router.get("/", auth, graphController.graph);
router.get("/seeds", auth, graphController.seeds);
router.get("/stream", auth, graphController.stream);

export default router;
