import { Router } from "express";
import multer from "multer";
import path from "node:path";
import fs from "node:fs";
import { authenticate } from "../../middleware/auth.middleware.js";
import { requireTenant } from "../../middleware/tenant.middleware.js";
import { success } from "../../common/utils/response.js";
import { AppError } from "../../common/errors.js";

const uploadDir = path.resolve(process.cwd(), "uploads");
fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-80);
    cb(null, `${Date.now()}-${safe}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!file.mimetype.startsWith("image/")) {
      cb(new Error("Only image files are allowed"));
      return;
    }
    cb(null, true);
  },
});

const docUpload = multer({
  storage,
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok =
      file.mimetype.startsWith("image/") ||
      file.mimetype === "application/pdf" ||
      file.mimetype === "application/msword" ||
      file.mimetype ===
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    if (!ok) {
      cb(new Error("Only image, PDF, or Word files are allowed"));
      return;
    }
    cb(null, true);
  },
});

export const uploadsRouter = Router();
uploadsRouter.use(authenticate, requireTenant);

uploadsRouter.post("/image", upload.single("file"), (req, res) => {
  if (!req.file) throw new AppError("No image uploaded", 400);
  const url = `/uploads/${req.file.filename}`;
  return success(res, { url, filename: req.file.filename }, "Uploaded");
});

uploadsRouter.post("/file", docUpload.single("file"), (req, res) => {
  if (!req.file) throw new AppError("No file uploaded", 400);
  const url = `/uploads/${req.file.filename}`;
  return success(
    res,
    {
      url,
      filename: req.file.filename,
      originalName: req.file.originalname,
      mimeType: req.file.mimetype,
      size: req.file.size,
    },
    "Uploaded",
  );
});
