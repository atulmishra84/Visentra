import jwt from "jsonwebtoken";
import { resolveJwtSecret } from "../config.js";
import { IS_PROD } from "../config.js";

const JWT_SECRET = resolveJwtSecret();
const JWT_TTL = process.env.JWT_TTL || (IS_PROD ? "8h" : "12h");

export function signToken(user) {
  return jwt.sign(
    { sub: user.id, tid: user.tenant_id, email: user.email, role: user.role, name: user.name },
    JWT_SECRET,
    { expiresIn: JWT_TTL }
  );
}
