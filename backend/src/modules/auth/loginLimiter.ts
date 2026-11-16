import type { Request } from "express";
import { ipKeyGenerator, rateLimit } from "express-rate-limit";

/**
 * Password-guessing brakes for the login endpoints (independent of any Authorization header,
 * so a fake "Bearer" value cannot buy a fresh bucket).
 *  - same email from one IP: 10 tries / 15 min
 *  - one IP across all emails: 40 tries / 15 min
 */
const msg = { success: false, message: "Too many sign-in attempts. Wait 15 minutes and try again." };
const ip = (req: Request) => ipKeyGenerator(req.ip ?? "");

export const loginPerAccountLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  keyGenerator: (req) => `${ip(req)}|${String((req.body as { email?: unknown })?.email ?? "").trim().toLowerCase()}`,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: msg,
});

export const loginPerIpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 40,
  keyGenerator: ip,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: msg,
});
