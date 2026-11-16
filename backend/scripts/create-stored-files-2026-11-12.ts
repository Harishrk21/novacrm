/**
 * 2026-11-12 — uploads survive deploys: files are kept in MySQL (Render's disk is wiped on every
 * deploy/restart, which had already lost the live product images). Additive table only.
 *
 *   npx tsx --env-file=.env scripts/create-stored-files-2026-11-12.ts
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
await prisma.$executeRawUnsafe(`
  CREATE TABLE IF NOT EXISTS stored_files (
    name        VARCHAR(80)  NOT NULL,
    tenant_id   CHAR(36)     NULL,
    uploaded_by CHAR(36)     NULL,
    mime_type   VARCHAR(120) NOT NULL,
    size_bytes  INT          NOT NULL,
    data        MEDIUMBLOB   NOT NULL,
    created_at  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (name),
    KEY idx_stored_files_tenant (tenant_id, created_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
`);
const rows = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>("SELECT COUNT(*) AS n FROM stored_files");
console.log("stored_files ready — rows:", Number(rows[0]?.n ?? 0));
await prisma.$disconnect();
