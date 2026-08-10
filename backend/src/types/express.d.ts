declare global { namespace Express { interface Request { auth?: { userId: string; tenantId?: string; role: string; kind: "platform" | "tenant" }; } } }
export {};
