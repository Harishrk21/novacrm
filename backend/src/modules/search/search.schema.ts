import{z}from"zod";export const searchSchema=z.object({body:z.any(),query:z.object({q:z.string().min(2).max(100),limit:z.coerce.number().int().min(1).max(25).default(10)}),params:z.any()});
