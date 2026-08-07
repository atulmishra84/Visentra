import { Router } from "express";
import { loginRateLimit } from "../middleware/rateLimiter.js";
import { auth } from "../middleware/auth.js";
import * as authController from "../controllers/auth.controller.js";

const router = Router();

router.post("/login", loginRateLimit, authController.login);
router.get("/sso/status", authController.ssoStatus);
router.get("/sso/:providerId/start", loginRateLimit, authController.ssoStart);
router.post("/sso/callback", loginRateLimit, authController.ssoCallback);
router.get("/sso/entra/start", loginRateLimit, authController.entraStart);
router.post("/sso/entra/callback", loginRateLimit, authController.entraCallback);
router.get("/me", auth, authController.me);

export default router;
