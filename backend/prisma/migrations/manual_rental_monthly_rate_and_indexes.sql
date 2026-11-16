-- 2026-11-10 — live RDS drift fix (additive only; safe with old and new API code).
-- rental_agreements.monthly_rate is in schema.prisma but missing on RDS → every Rentals
-- query failed ("column does not exist"). Plus two indexes from schema.prisma that were never created.
-- Applied by scripts/apply-2026-11-10-db-fixes.ts (checks existence first; MySQL has no ADD COLUMN IF NOT EXISTS).

ALTER TABLE `rental_agreements` ADD COLUMN `monthly_rate` DECIMAL(15, 2) NULL;
CREATE INDEX `spare_stock_txns_tenant_id_issued_to_user_id_idx` ON `spare_stock_txns`(`tenant_id`, `issued_to_user_id`);
CREATE INDEX `tickets_tenant_id_payment_status_status_idx` ON `tickets`(`tenant_id`, `payment_status`, `status`);
