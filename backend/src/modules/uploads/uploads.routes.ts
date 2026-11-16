import { Router } from "express";
import type { Request } from "express";
import multer from "multer";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { authenticate } from "../../middleware/auth.middleware.js";
import { requireTenant } from "../../middleware/tenant.middleware.js";
import { success } from "../../common/utils/response.js";
import { AppError } from "../../common/errors.js";
import { saveUpload } from "./fileStore.js";

/**
 * Files are kept in memory, checked by their real content (not the browser-claimed type) and
 * stored via fileStore (database, so they survive deploys). Random, unguessable names — the URL
 * itself is the secret because <img> tags can't send a login token.
 */
const IMAGE_MAX = 5 * 1024 * 1024;
const DOC_MAX = 8 * 1024 * 1024;

const memory = multer.memoryStorage();
const upload = multer({ storage: memory, limits: { fileSize: IMAGE_MAX } });
const docUpload = multer({ storage: memory, limits: { fileSize: DOC_MAX } });

/** Detect the real type from the first bytes. Returns null for anything we don't accept. */
function sniff(buf: Buffer): { mime: string; ext: string; kind: "image" | "doc" } | null {
  const b = buf.subarray(0, 12);
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return { mime: "image/png", ext: ".png", kind: "image" };
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { mime: "image/jpeg", ext: ".jpg", kind: "image" };
  if (b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP") return { mime: "image/webp", ext: ".webp", kind: "image" };
  if (b.toString("ascii", 0, 4) === "GIF8") return { mime: "image/gif", ext: ".gif", kind: "image" };
  if (b.toString("ascii", 0, 4) === "%PDF") return { mime: "application/pdf", ext: ".pdf", kind: "doc" };
  // Word: legacy .doc (OLE) and .docx (zip)
  if (b[0] === 0xd0 && b[1] === 0xcf && b[2] === 0x11 && b[3] === 0xe0) return { mime: "application/msword", ext: ".doc", kind: "doc" };
  if (b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04) {
    return { mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", ext: ".docx", kind: "doc" };
  }
  return null;
}

async function store(req: Request, allowDocs: boolean) {
  if (!req.file) throw new AppError("No file uploaded", 400);
  const type = sniff(req.file.buffer);
  if (!type || (type.kind === "doc" && !allowDocs)) {
    throw new AppError(allowDocs ? "Only image, PDF, or Word files are allowed" : "Only image files are allowed", 422);
  }
  if (type.ext === ".docx" && path.extname(req.file.originalname).toLowerCase() !== ".docx") {
    throw new AppError("Only image, PDF, or Word files are allowed", 422);
  }
  const name = `${randomBytes(18).toString("base64url")}${type.ext}`;
  await saveUpload({
    name,
    buffer: req.file.buffer,
    mimeType: type.mime,
    tenantId: req.auth?.tenantId ?? null,
    userId: req.auth?.userId ?? null,
  });
  return { name, mime: type.mime };
}

export const uploadsRouter = Router();
uploadsRouter.use(authenticate);

uploadsRouter.post("/image", upload.single("file"), async (req, res) => {
  if (req.auth?.kind !== "platform" && req.auth?.kind !== "tenant") {
    throw new AppError("Authentication required", 401);
  }
  const { name } = await store(req, false);
  return success(res, { url: `/uploads/${name}`, filename: name }, "Uploaded");
});

uploadsRouter.post("/file", requireTenant, docUpload.single("file"), async (req, res) => {
  const { name, mime } = await store(req, true);
  return success(
    res,
    {
      url: `/uploads/${name}`,
      filename: name,
      originalName: req.file!.originalname,
      mimeType: mime,
      size: req.file!.size,
    },
    "Uploaded",
  );
});
