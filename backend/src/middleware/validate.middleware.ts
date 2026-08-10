import type { NextFunction, Request, Response } from "express";
import type { ZodTypeAny } from "zod";

export const validate =
  (schema: ZodTypeAny) => (req: Request, _res: Response, next: NextFunction) => {
    const result = schema.safeParse({
      body: req.body,
      query: req.query,
      params: req.params,
    });
    if (!result.success) return next(result.error);

    const data = result.data as {
      body?: unknown;
      query?: unknown;
      params?: unknown;
    };

    if (data.body !== undefined) req.body = data.body;
    // Express 5: req.query / req.params are getters — do not Object.assign onto req
    if (data.params !== undefined) {
      Object.keys(req.params).forEach((k) => delete (req.params as Record<string, string>)[k]);
      Object.assign(req.params, data.params);
    }

    next();
  };
