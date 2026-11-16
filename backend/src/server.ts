import "./config/timezone.js";
import http from "node:http";
import jwt from "jsonwebtoken";
import { Server } from "socket.io";
import { app } from "./app.js";
import { env } from "./config/env.js";
import { logger } from "./config/logger.js";
import { prisma } from "./config/database.js";
import { roleHasPermission } from "./common/permissions.js";
import { redis } from "./config/redis.js";
import { runServiceReminders } from "./modules/assets/reminder.service.js";
import { runAutomationPass } from "./modules/automation/automation.service.js";
import { runPoolReminders } from "./modules/tickets/poolReminder.service.js";

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: env.CLIENT_URL.split(",").map((v) => v.trim()), credentials: true },
});
app.set("io", io);
void import("./modules/notifications/notify.service.js").then(({ bindNotificationIo }) => {
  bindNotificationIo(io);
});

io.use(async (socket, next) => {
  try {
    const token = socket.handshake.auth.token as string | undefined;
    if (!token) throw new Error("missing token");
    const claims = jwt.verify(token, env.JWT_ACCESS_SECRET) as {
      kind: string;
      tenantId?: string;
      userId?: string;
      adminId?: string;
      role?: string;
      exp?: number;
    };
    if (!claims.userId && !claims.adminId) throw new Error("invalid token");
    // Removed / deactivated staff must not keep a live channel open
    if (claims.userId) {
      const user = await prisma.user.findFirst({
        where: { id: claims.userId, tenantId: claims.tenantId, status: "ACTIVE", deletedAt: null },
        select: { id: true },
      });
      if (!user) throw new Error("inactive user");
    }
    socket.data.auth = claims;
    next();
  } catch {
    next(new Error("Unauthorized"));
  }
});

io.on("connection", (socket) => {
  const auth = socket.data.auth as { kind: string; tenantId?: string; userId?: string; role?: string; exp?: number };
  if (auth.tenantId) void socket.join(`tenant:${auth.tenantId}`);
  if (auth.userId) void socket.join(`user:${auth.userId}`);
  // Inbox events (customer WhatsApp text) only reach roles allowed to read WhatsApp
  if (auth.tenantId && auth.role && roleHasPermission(auth.role, "whatsapp:view")) {
    void socket.join(`tenant:${auth.tenantId}:whatsapp`);
  }
  // A socket lives no longer than the token that opened it; the client reconnects with a fresh
  // token, which re-runs the active-user check above.
  if (auth.exp) {
    const ms = auth.exp * 1000 - Date.now();
    const timer = setTimeout(() => socket.disconnect(true), Math.max(1000, ms));
    socket.on("disconnect", () => clearTimeout(timer));
  }
});

server.listen(env.PORT, () =>
  logger.info("NovaCRM Platform API started", { port: env.PORT, environment: env.NODE_ENV }),
);

/** Hourly: AMC/maintenance WhatsApp + sales automation pass. */
const REMINDER_MS = 60 * 60 * 1000;
const hourlyJobsEnabled =
  process.env.ENABLE_HOURLY_JOBS === "1" ||
  (env.NODE_ENV === "production" && process.env.ENABLE_HOURLY_JOBS !== "0");

async function hourlyJobs() {
  await runServiceReminders().catch((err) => logger.warn("Service reminders failed", { err }));
  await runAutomationPass().catch((err) => logger.warn("Automation pass failed", { err }));
  await runPoolReminders().catch((err) => logger.warn("Pool reminders failed", { err }));
}

let reminderTimer: ReturnType<typeof setInterval> | undefined;
if (hourlyJobsEnabled) {
  setTimeout(() => {
    void hourlyJobs();
  }, 60_000);
  reminderTimer = setInterval(() => {
    void hourlyJobs();
  }, REMINDER_MS);
  reminderTimer.unref?.();
} else {
  logger.info("Hourly reminder/automation jobs disabled in development (set ENABLE_HOURLY_JOBS=1 to force)");
}

async function shutdown(signal: string) {
  logger.info("Shutting down", { signal });
  if (reminderTimer) clearInterval(reminderTimer);
  io.close();
  server.close(async () => {
    await Promise.allSettled([prisma.$disconnect(), redis ? redis.quit() : Promise.resolve()]);
    process.exit(0);
  });
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

export { io };
