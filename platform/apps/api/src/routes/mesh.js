import { Router } from "express";
import { auth } from "../middleware/auth.js";
import * as meshController from "../controllers/mesh.controller.js";

const router = Router();

router.get("/risk/paths", auth, meshController.riskPaths);
router.get("/mesh", auth, meshController.mesh);

export default router;
