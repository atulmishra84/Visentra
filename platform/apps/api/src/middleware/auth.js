import jwt from "jsonwebtoken";
import { resolveJwtSecret } from "../config.js";

const JWT_SECRET = resolveJwtSecret();

export function auth(req, res, next) {
  const header = req.headers.authorization || "";
  const bearer = header.startsWith("Bearer ") ? header.slice(7) : null;
  // EventSource cannot set Authorization headers. Allow ?token= only for the graph SSE route.
  const isGraphStream = req.originalUrl.startsWith("/api/graph/stream") || req.path === "/stream";
  const queryToken = typeof req.query.token === "string" && isGraphStream ? req.query.token : null;
  const raw = bearer || queryToken;
  console.log("Auth debug:", { path: req.path, originalUrl: req.originalUrl, queryToken, bearer: !!bearer, raw: !!raw, queryTokenVal: req.query.token });
  if (!raw) return res.status(401).json({ error: { message: "Unauthorized" } });
  
  try {
    req.user = jwt.verify(String(raw), JWT_SECRET);
    req.tenantId = req.user.tid;
    next();
  } catch {
    return res.status(401).json({ error: { message: "Invalid token" } });
  }
}

export function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user.role) && req.user.role !== "platform_admin") {
      return res.status(403).json({ error: { message: "Forbidden" } });
    }
    next();
  };
}
