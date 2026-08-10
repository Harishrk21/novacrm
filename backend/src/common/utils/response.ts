import type { Response } from "express";
export const success = (res: Response, data: unknown, message = "Success", status = 200) => res.status(status).json({ success: true, message, data });
export const error = (res: Response, message: string, status = 400, details?: unknown) => res.status(status).json({ success: false, message, ...(details ? { details } : {}) });
