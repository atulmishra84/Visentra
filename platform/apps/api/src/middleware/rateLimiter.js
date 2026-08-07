import { createRateLimiter, IS_PROD } from "../config.js";

export const loginRateLimit = createRateLimiter({ windowMs: 60_000, max: IS_PROD ? 10 : 60 });
