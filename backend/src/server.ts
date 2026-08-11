import http from "node:http";
import jwt from "jsonwebtoken";
import { Server } from "socket.io";
import { app } from "./app.js";
import { env } from "./config/env.js";
import { logger } from "./config/logger.js";
import { prisma } from "./config/database.js";
import { redis } from "./config/redis.js";
import { runServiceReminders } from "./modules/assets/reminder.service.js";

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: env.CLIENT_URL.split(",").map((v) => v.trim()), credentials: true },
});
app.set("io", io);

io.use((socket, next) => {
  try {
    const token = socket.handshake.auth.token as string | undefined;
    if (!token) throw new Error("missing token");
    const claims = jwt.verify(token, env.JWT_ACCESS_SECRET) as {
      kind: string;
      tenantId?: string;
      userId?: string;
      adminId?: string;
    };
    if (!claims.userId && !claims.adminId) throw new Error("invalid token");
    socket.data.auth = claims;
    next();
  } catch {
    next(new Error("Unauthorized"));
  }
});

io.on("connection", (socket) => {
  const auth = socket.data.auth as { kind: string; tenantId?: string; userId?: string };
  if (auth.tenantId) void socket.join(`tenant:${auth.tenantId}`);
  if (auth.userId) void socket.join(`user:${auth.userId}`);
});

server.listen(env.PORT, () =>
  logger.info("NovaCRM API started", { port: env.PORT, environment: env.NODE_ENV }),
);

/** Hourly: WhatsApp reminders ~1 week before maintenance due / AMC end. */
const REMINDER_MS = 60 * 60 * 1000;
setTimeout(() => {
  void runServiceReminders().catch((err) => logger.warn("Service reminders failed", { err }));
}, 20_000);
const reminderTimer = setInterval(() => {
  void runServiceReminders().catch((err) => logger.warn("Service reminders failed", { err }));
}, REMINDER_MS);
reminderTimer.unref?.();

async function shutdown(signal: string) {
  logger.info("Shutting down", { signal });
  clearInterval(reminderTimer);
  io.close();
  server.close(async () => {
    await Promise.allSettled([prisma.$disconnect(), redis ? redis.quit() : Promise.resolve()]);
    process.exit(0);
  });
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

export { io };
