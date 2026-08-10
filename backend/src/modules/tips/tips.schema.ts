import{z}from"zod";export const tipsSchema=z.object({body:z.any(),query:z.object({sectionKey:z.string().optional()}),params:z.object({moduleKey:z.string().min(1)})});
