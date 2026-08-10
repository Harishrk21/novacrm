import type { Request } from 'express'

/** Express 5 params can be string | string[] — normalize to string */
export function paramId(req: Request, key = 'id'): string {
  const value = req.params[key]
  return Array.isArray(value) ? value[0]! : String(value)
}
