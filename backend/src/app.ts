import express from "express";
import compression from "compression";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import path from "node:path";
import { createHash } from "node:crypto";
import jwt from "jsonwebtoken";
import { ipKeyGenerator, rateLimit } from "express-rate-limit";
import { env } from "./config/env.js";
import { prisma } from "./config/database.js";
import { isRedisAvailable, redis } from "./config/redis.js";
import { apiRouter } from "./routes/index.js";
import { serveStoredUpload } from "./modules/uploads/fileStore.js";
import { errorHandler, notFoundHandler } from "./middleware/error.middleware.js";

export const app = express();
app.set("trust proxy", 1);
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
  }),
);
app.use(
  cors({
    origin: env.CLIENT_URL.split(",").map((v) => v.trim()),
    credentials: true,
  }),
);
/** Gzip JSON/API responses — big win for analytics + list payloads */
app.use(
  compression({
    threshold: 1024,
    filter: (req, res) => {
      if (req.headers["x-no-compression"]) return false;
      return compression.filter(req, res);
    },
  }),
);
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan(env.NODE_ENV === "production" ? "combined" : "dev"));
// Uploaded files: database first (survives deploys), then any older files still on disk
app.get("/uploads/:name", serveStoredUpload);
app.use("/uploads", express.static(path.resolve(process.cwd(), "uploads")));
app.use(
  "/api",
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: Number(process.env.API_RATE_LIMIT) || 1000,
    // Per signed-in session, so a whole office behind one NAT IP is not throttled together.
    keyGenerator: (req) => {
      const auth = req.headers.authorization;
      // Only a token we actually issued earns a per-session bucket — a made-up Bearer value must not
      // let a client dodge the per-IP limit (e.g. to brute-force passwords).
      if (auth?.startsWith("Bearer ")) {
        try {
          jwt.verify(auth.slice(7), env.JWT_ACCESS_SECRET);
          return `t:${createHash("sha256").update(auth.slice(7)).digest("base64url")}`;
        } catch {
          /* fall through to IP */
        }
      }
      return ipKeyGenerator(req.ip ?? "");
    },
    standardHeaders: "draft-8",
    legacyHeaders: false,
  }),
  apiRouter,
);
app.get("/health", async (_q, r) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return r.json({
      status: "ok",
      database: "connected",
      cache: redis ? (isRedisAvailable() ? "redis" : "redis-unavailable") : "memory-only",
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    // Public endpoint — never echo DB error text (hostnames / users) to the internet
    console.error("[health] database check failed", err);
    return r.status(503).json({ status: "degraded", database: "error", timestamp: new Date().toISOString() });
  }
});
app.use(notFoundHandler);
app.use(errorHandler);
