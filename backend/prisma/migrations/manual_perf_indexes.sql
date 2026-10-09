-- Performance indexes for 10+ concurrent users (dashboard / lists / assign queues).
-- Safe to re-run: uses IF NOT EXISTS where MySQL supports it (8.0+), else ignore duplicate errors.

-- Tickets: engineer queue, desk filters, SLA, payment
ALTER TABLE `tickets`
  ADD INDEX `tickets_tenant_assigned_status_idx` (`tenant_id`, `assigned_to_id`, `status`),
  ADD INDEX `tickets_tenant_contact_status_idx` (`tenant_id`, `contact_id`, `status`),
  ADD INDEX `tickets_tenant_created_idx` (`tenant_id`, `created_at`),
  ADD INDEX `tickets_tenant_sla_status_idx` (`tenant_id`, `sla_breached`, `status`),
  ADD INDEX `tickets_tenant_pay_status_idx` (`tenant_id`, `payment_status`, `status`),
  ADD INDEX `tickets_tenant_deleted_status_idx` (`tenant_id`, `deleted_at`, `status`);

-- Leads: sales desk mine + soft-delete filters
ALTER TABLE `leads`
  ADD INDEX `leads_tenant_assigned_status_idx` (`tenant_id`, `assigned_to_id`, `status`),
  ADD INDEX `leads_tenant_deleted_status_idx` (`tenant_id`, `deleted_at`, `status`);

-- Activities: my-tasks / follow-ups
ALTER TABLE `activities`
  ADD INDEX `activities_tenant_assigned_status_idx` (`tenant_id`, `assigned_to_id`, `status`),
  ADD INDEX `activities_tenant_status_sched_idx` (`tenant_id`, `status`, `scheduled_at`);

-- Notifications bell
ALTER TABLE `notifications`
  ADD INDEX `notifications_tenant_user_read_created_idx` (`tenant_id`, `user_id`, `is_read`, `created_at`);

-- Contacts soft-delete list
ALTER TABLE `contacts`
  ADD INDEX `contacts_tenant_deleted_name_idx` (`tenant_id`, `deleted_at`, `name`);

-- Stock units: warehouse dashboard / IN_STOCK pickers
ALTER TABLE `stock_units`
  ADD INDEX `stock_units_tenant_status_idx` (`tenant_id`, `status`),
  ADD INDEX `stock_units_tenant_deleted_status_idx` (`tenant_id`, `deleted_at`, `status`);

-- Invoices / deals: analytics + billing lists
ALTER TABLE `invoices`
  ADD INDEX `invoices_tenant_deleted_created_idx` (`tenant_id`, `deleted_at`, `created_at`),
  ADD INDEX `invoices_tenant_status_idx` (`tenant_id`, `status`);

ALTER TABLE `deals`
  ADD INDEX `deals_tenant_deleted_created_idx` (`tenant_id`, `deleted_at`, `created_at`);

ALTER TABLE `stock_levels`
  ADD INDEX `stock_levels_tenant_idx` (`tenant_id`);
