import fs from "node:fs";
import path from "node:path";
import type { NextFunction, Request, Response } from "express";
import { prisma } from "../../config/database.js";

/**
 * Uploaded files live in MySQL (table stored_files) so they survive deploys — Render's disk is
 * wiped on every deploy/restart. If the table isn't there yet, files fall back to local disk.
 * URLs stay /uploads/<random-name> either way.
 */
const uploadDir = path.resolve(process.cwd(), "uploads");
let tableReady: boolean | null = null;

async function hasTable(): Promise<boolean> {
  if (tableReady !== null) return tableReady;
  try {
    await prisma.$queryRawUnsafe("SELECT 1 FROM stored_files LIMIT 1");
    tableReady = true;
  } catch {
    tableReady = false;
    // Re-check later (e.g. after the table is created) without a restart
    setTimeout(() => {
      tableReady = null;
    }, 60_000).unref?.();
  }
  return tableReady;
}

export async function saveUpload(opts: {
  name: string;
  buffer: Buffer;
  mimeType: string;
  tenantId?: string | null;
  userId?: string | null;
}): Promise<"db" | "disk"> {
  if (await hasTable()) {
    await prisma.$executeRaw`
      INSERT INTO stored_files (name, tenant_id, uploaded_by, mime_type, size_bytes, data)
      VALUES (${opts.name}, ${opts.tenantId ?? null}, ${opts.userId ?? null}, ${opts.mimeType},
              ${opts.buffer.length}, ${opts.buffer})`;
    return "db";
  }
  fs.mkdirSync(uploadDir, { recursive: true });
  await fs.promises.writeFile(path.join(uploadDir, opts.name), opts.buffer);
  return "disk";
}

const SAFE_NAME = /^[A-Za-z0-9_.-]{1,80}$/;

/** GET /uploads/:name — serve from the database, else hand over to the disk static handler. */
export async function serveStoredUpload(req: Request, res: Response, next: NextFunction) {
  const name = String(req.params.name ?? "");
  if (!SAFE_NAME.test(name) || !(await hasTable())) return next();
  try {
    const rows = await prisma.$queryRaw<Array<{ mime_type: string; data: Buffer }>>`
      SELECT mime_type, data FROM stored_files WHERE name = ${name} LIMIT 1`;
    const row = rows[0];
    if (!row) return next();
    res.setHeader("Content-Type", row.mime_type);
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    res.setHeader("X-Content-Type-Options", "nosniff");
    // Images / PDFs open in the browser; anything else downloads instead of rendering
    if (!/^image\/(png|jpe?g|webp|gif)$|^application\/pdf$/.test(row.mime_type)) {
      res.setHeader("Content-Disposition", `attachment; filename="${name}"`);
    }
    return res.end(Buffer.from(row.data));
  } catch {
    return next();
  }
}
