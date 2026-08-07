import { Router } from "express";
import { auth } from "../middleware/auth.js";
import * as searchController from "../controllers/search.controller.js";

const router = Router();

router.get("/", auth, searchController.search);

export default router;
