import { Router } from "express";
import { auth, requireRole } from "../middleware/auth.js";
import * as ssoController from "../controllers/sso.controller.js";

const router = Router();

router.get("/schema", auth, requireRole("platform_admin", "operator"), ssoController.schema);
router.get("/", auth, requireRole("platform_admin", "operator"), ssoController.list);
router.post("/", auth, requireRole("platform_admin"), ssoController.create);
router.put("/:id", auth, requireRole("platform_admin"), ssoController.update);
router.delete("/:id", auth, requireRole("platform_admin"), ssoController.remove);
router.post("/:id/test", auth, requireRole("platform_admin", "operator"), ssoController.test);

export default router;
