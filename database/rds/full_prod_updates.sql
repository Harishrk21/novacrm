-- =============================================================================
-- Meister CRM — full production RDS updates for database `novacrm`
-- Run on: chatbotdynamic-rds… / USE novacrm;
-- Safe to re-run: ignore Duplicate key (1061). Skip statements that fail 1146.
-- =============================================================================

USE novacrm;

-- -----------------------------------------------------------------------------
-- A) Health / connection pressure (read-only)
-- -----------------------------------------------------------------------------
SHOW VARIABLES LIKE 'max_connections';
SHOW GLOBAL STATUS LIKE 'Threads_connected';
SHOW GLOBAL STATUS LIKE 'Max_used_connections';
-- SHOW FULL PROCESSLIST;

-- -----------------------------------------------------------------------------
-- B) HMS logo (login page /login/hms)
-- Prefer full Vercel URL so logo works even before frontend code redeploy.
-- -----------------------------------------------------------------------------
SELECT id, slug, name, logo_url
FROM tenants
WHERE slug = 'precision-scales-india';

UPDATE tenants
SET logo_url = 'https://novacrms.vercel.app/hms-logo.png'
WHERE slug = 'precision-scales-india';

SELECT slug, logo_url
FROM tenants
WHERE slug = 'precision-scales-india';
-- Expect: https://novacrms.vercel.app/hms-logo.png

-- -----------------------------------------------------------------------------
-- C) Prisma drift — users.temp_password (needed by current API User model)
-- Run ALTER only if the SELECT below returns ZERO rows.
-- -----------------------------------------------------------------------------
SELECT COLUMN_NAME
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'users'
  AND COLUMN_NAME = 'temp_password';

-- If empty, uncomment and run:
-- ALTER TABLE `users`
--   ADD COLUMN `temp_password` VARCHAR(128) NULL AFTER `password_hash`;

-- -----------------------------------------------------------------------------
-- D) Core CRM performance indexes (run once; ignore 1061 Duplicate key name)
-- -----------------------------------------------------------------------------
ALTER TABLE `tickets` ADD INDEX `tickets_tenant_assigned_status_idx` (`tenant_id`, `assigned_to_id`, `status`);
ALTER TABLE `tickets` ADD INDEX `tickets_tenant_contact_status_idx` (`tenant_id`, `contact_id`, `status`);
ALTER TABLE `tickets` ADD INDEX `tickets_tenant_created_idx` (`tenant_id`, `created_at`);
ALTER TABLE `tickets` ADD INDEX `tickets_tenant_sla_status_idx` (`tenant_id`, `sla_breached`, `status`);
ALTER TABLE `tickets` ADD INDEX `tickets_tenant_deleted_status_idx` (`tenant_id`, `deleted_at`, `status`);

ALTER TABLE `leads` ADD INDEX `leads_tenant_assigned_status_idx` (`tenant_id`, `assigned_to_id`, `status`);
ALTER TABLE `leads` ADD INDEX `leads_tenant_deleted_status_idx` (`tenant_id`, `deleted_at`, `status`);

ALTER TABLE `activities` ADD INDEX `activities_tenant_assigned_status_idx` (`tenant_id`, `assigned_to_id`, `status`);
ALTER TABLE `activities` ADD INDEX `activities_tenant_status_sched_idx` (`tenant_id`, `status`, `scheduled_at`);

ALTER TABLE `notifications` ADD INDEX `notifications_tenant_user_read_created_idx` (`tenant_id`, `user_id`, `is_read`, `created_at`);

ALTER TABLE `contacts` ADD INDEX `contacts_tenant_deleted_name_idx` (`tenant_id`, `deleted_at`, `name`);

-- -----------------------------------------------------------------------------
-- E) Optional ERP indexes (ONLY if those tables exist — skip 1146 errors)
-- Check: SHOW TABLES LIKE 'stock_units'; SHOW TABLES LIKE 'invoices';
-- -----------------------------------------------------------------------------
-- ALTER TABLE `invoices` ADD INDEX `invoices_tenant_deleted_created_idx` (`tenant_id`, `deleted_at`, `created_at`);
-- ALTER TABLE `invoices` ADD INDEX `invoices_tenant_status_idx` (`tenant_id`, `status`);
-- ALTER TABLE `deals` ADD INDEX `deals_tenant_deleted_created_idx` (`tenant_id`, `deleted_at`, `created_at`);
-- ALTER TABLE `stock_levels` ADD INDEX `stock_levels_tenant_idx` (`tenant_id`);
-- ALTER TABLE `stock_units` ADD INDEX `stock_units_tenant_status_idx` (`tenant_id`, `status`);
-- ALTER TABLE `stock_units` ADD INDEX `stock_units_tenant_deleted_status_idx` (`tenant_id`, `deleted_at`, `status`);

-- -----------------------------------------------------------------------------
-- F) Verify auth / HMS tenant (read-only)
-- -----------------------------------------------------------------------------
SELECT id, slug, code, status, name, logo_url
FROM tenants
WHERE deleted_at IS NULL
ORDER BY created_at;

SELECT u.email, u.status, t.slug AS tenant_slug
FROM users u
JOIN tenants t ON t.id = u.tenant_id
WHERE u.deleted_at IS NULL
  AND t.slug = 'precision-scales-india'
ORDER BY u.email;

-- -----------------------------------------------------------------------------
-- G) Schema drift vs full master (read-only — missing tables are OK for core CRM)
-- -----------------------------------------------------------------------------
SELECT COUNT(*) AS table_count
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = DATABASE();

SELECT 'stock_units' AS missing
WHERE NOT EXISTS (
  SELECT 1 FROM information_schema.TABLES
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'stock_units'
)
UNION ALL
SELECT 'brands'
WHERE NOT EXISTS (
  SELECT 1 FROM information_schema.TABLES
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'brands'
)
UNION ALL
SELECT 'customer_assets'
WHERE NOT EXISTS (
  SELECT 1 FROM information_schema.TABLES
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'customer_assets'
)
UNION ALL
SELECT 'sales_requisitions'
WHERE NOT EXISTS (
  SELECT 1 FROM information_schema.TABLES
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sales_requisitions'
);

-- -----------------------------------------------------------------------------
-- Rental agreements: monthly_rate (monthly hire terms)
-- Safe to re-run: ignore Duplicate column (1060).
-- -----------------------------------------------------------------------------
ALTER TABLE `rental_agreements`
  ADD COLUMN `monthly_rate` DECIMAL(15, 2) NULL AFTER `daily_rate`;
