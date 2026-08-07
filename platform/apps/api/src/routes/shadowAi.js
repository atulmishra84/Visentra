import { Router } from "express";
import { auth } from "../middleware/auth.js";
import * as shadowAiController from "../controllers/shadowAi.controller.js";

const router = Router();

router.get("/", auth, shadowAiController.shadowAi);

export default router;
