export class AppError extends Error { constructor(message: string, public statusCode = 400, public details?: unknown) { super(message); } }
export const notFound = (name = "Resource") => new AppError(`${name} not found`, 404);
