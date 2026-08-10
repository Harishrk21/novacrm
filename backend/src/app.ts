import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import path from "node:path";
import { rateLimit } from "express-rate-limit";
import { env } from "./config/env.js";
import { prisma } from "./config/database.js";
import { apiRouter } from "./routes/index.js";
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
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan(env.NODE_ENV === "production" ? "combined" : "dev"));
app.use("/uploads", express.static(path.resolve(process.cwd(), "uploads")));
app.use(
  "/api",
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 1000,
    standardHeaders: "draft-8",
    legacyHeaders: false,
  }),
  apiRouter,
);
app.get("/health", async (_q, r) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return r.json({ status: "ok", database: "connected", timestamp: new Date().toISOString() });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Database unreachable";
    return r.status(503).json({ status: "degraded", database: "error", message, timestamp: new Date().toISOString() });
  }
});
app.use(notFoundHandler);
app.use(errorHandler);
