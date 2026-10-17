-- Performance indexes for concurrent users (dashboard / lists / queues).
-- Run against the novacrm database.
-- Safe to re-run: ignore "Duplicate key name" (1061).
-- Skip any statement that fails with "Table doesn't exist" (1146) — that feature
-- was never migrated to this RDS; indexes are optional for missing tables.

-- ========== Core CRM (run these) ==========

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

-- ========== ERP / stock (only if table exists) ==========
-- Check first: SHOW TABLES LIKE 'stock_units';
-- ALTER TABLE `stock_units` ADD INDEX `stock_units_tenant_status_idx` (`tenant_id`, `status`);
-- ALTER TABLE `stock_units` ADD INDEX `stock_units_tenant_deleted_status_idx` (`tenant_id`, `deleted_at`, `status`);
-- ALTER TABLE `invoices` ADD INDEX `invoices_tenant_deleted_created_idx` (`tenant_id`, `deleted_at`, `created_at`);
-- ALTER TABLE `invoices` ADD INDEX `invoices_tenant_status_idx` (`tenant_id`, `status`);
-- ALTER TABLE `deals` ADD INDEX `deals_tenant_deleted_created_idx` (`tenant_id`, `deleted_at`, `created_at`);
-- ALTER TABLE `stock_levels` ADD INDEX `stock_levels_tenant_idx` (`tenant_id`);
