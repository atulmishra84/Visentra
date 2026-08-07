import { Router } from "express";
import { auth, requireRole } from "../middleware/auth.js";
import * as connectorsController from "../controllers/connectors.controller.js";

const router = Router();

router.get("/schema", auth, connectorsController.schema);
router.get("/", auth, connectorsController.list);
router.post("/", auth, requireRole("platform_admin", "operator"), connectorsController.create);
router.get("/:id", auth, connectorsController.getById);
router.put("/:id", auth, requireRole("platform_admin", "operator"), connectorsController.update);
router.delete("/:id", auth, requireRole("platform_admin", "operator"), connectorsController.remove);
router.post("/:id/test", auth, requireRole("platform_admin", "operator"), connectorsController.test);

export default router;
