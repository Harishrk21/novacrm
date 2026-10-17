-- =============================================================================
-- Meister CRM / HMS — DB up-to-date check (as of 16 Oct 2026)
-- Database: novacrm  |  Host: chatbotdynamic-rds… (prod)
--
-- HOW TO USE (MySQL Workbench or CLI):
--   1) Connect to RDS → USE novacrm;
--   2) Run this whole file (read-only except you may run section FIX later).
--   3) Read the RESULT column: OK = good, MISSING = needs attention.
--
-- NOTE: App features after last GitHub push (closed date, service report JSON,
-- month collected) need NO new columns if tickets.* payment/date cols exist.
-- =============================================================================

USE novacrm;

-- -----------------------------------------------------------------------------
-- 0) Connection pressure (login 503 / Prisma P2037)
-- -----------------------------------------------------------------------------
SHOW VARIABLES LIKE 'max_connections';
SHOW GLOBAL STATUS LIKE 'Threads_connected';
SHOW GLOBAL STATUS LIKE 'Max_used_connections';

-- =============================================================================
-- 1) MASTER CHECKLIST — one row per requirement (OK / MISSING)
-- =============================================================================
SELECT check_item, result, detail
FROM (
  -- ---- Auth / users ----
  SELECT 10 AS sort_order,
         'users.temp_password' AS check_item,
         IF(EXISTS(
           SELECT 1 FROM information_schema.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'temp_password'
         ), 'OK', 'MISSING') AS result,
         'Required by current User model / invite temp password' AS detail
  UNION ALL
  -- ---- Tickets: dates + payment (closed list, reports, admin month KPI) ----
  SELECT 20, 'tickets.created_at',
         IF(EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='tickets' AND COLUMN_NAME='created_at'), 'OK', 'MISSING'),
         'Service creation date'
  UNION ALL
  SELECT 21, 'tickets.closed_at',
         IF(EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='tickets' AND COLUMN_NAME='closed_at'), 'OK', 'MISSING'),
         'Closed date on closed tickets'
  UNION ALL
  SELECT 22, 'tickets.resolved_at',
         IF(EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='tickets' AND COLUMN_NAME='resolved_at'), 'OK', 'MISSING'),
         'Resolved timestamp'
  UNION ALL
  SELECT 23, 'tickets.paid_at',
         IF(EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='tickets' AND COLUMN_NAME='paid_at'), 'OK', 'MISSING'),
         'Admin service collected this month'
  UNION ALL
  SELECT 24, 'tickets.payment_status',
         IF(EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='tickets' AND COLUMN_NAME='payment_status'), 'OK', 'MISSING'),
         'UNPAID / PARTIAL / PAID'
  UNION ALL
  SELECT 25, 'tickets.payment_total',
         IF(EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='tickets' AND COLUMN_NAME='payment_total'), 'OK', 'MISSING'),
         'Service amount'
  UNION ALL
  SELECT 26, 'tickets.advance_amount',
         IF(EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='tickets' AND COLUMN_NAME='advance_amount'), 'OK', 'MISSING'),
         'Partial collections'
  UNION ALL
  SELECT 27, 'tickets.custom_fields',
         IF(EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='tickets' AND COLUMN_NAME='custom_fields'), 'OK', 'MISSING'),
         'Stores serviceReport JSON (download)'
  UNION ALL
  SELECT 28, 'tickets.payment_method',
         IF(EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='tickets' AND COLUMN_NAME='payment_method'), 'OK', 'MISSING'),
         'Cash / UPI / NEFT…'
  UNION ALL
  SELECT 29, 'tickets.service_invoice_id',
         IF(EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='tickets' AND COLUMN_NAME='service_invoice_id'), 'OK', 'MISSING'),
         'Linked service proforma'
  UNION ALL
  -- ---- Leads (sales creation date) ----
  SELECT 30, 'leads.created_at',
         IF(EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='leads' AND COLUMN_NAME='created_at'), 'OK', 'MISSING'),
         'Sales / enquiry creation date'
  UNION ALL
  SELECT 31, 'leads.custom_fields',
         IF(EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='leads' AND COLUMN_NAME='custom_fields'), 'OK', 'MISSING'),
         'Sale payment + service handoff JSON'
  UNION ALL
  -- ---- Core tables ----
  SELECT 40, 'table:tickets',
         IF(EXISTS(SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='tickets'), 'OK', 'MISSING'),
         'Service tickets'
  UNION ALL
  SELECT 41, 'table:leads',
         IF(EXISTS(SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='leads'), 'OK', 'MISSING'),
         'Sales / enquiries'
  UNION ALL
  SELECT 42, 'table:contacts',
         IF(EXISTS(SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='contacts'), 'OK', 'MISSING'),
         'Customers'
  UNION ALL
  SELECT 43, 'table:customer_assets',
         IF(EXISTS(SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='customer_assets'), 'OK', 'MISSING'),
         'Machines'
  UNION ALL
  SELECT 44, 'table:notifications',
         IF(EXISTS(SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='notifications'), 'OK', 'MISSING'),
         'In-app notifications'
  UNION ALL
  SELECT 45, 'table:products',
         IF(EXISTS(SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='products'), 'OK', 'MISSING'),
         'Catalogue'
  UNION ALL
  SELECT 46, 'table:warehouses',
         IF(EXISTS(SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='warehouses'), 'OK', 'MISSING'),
         'Stock warehouses'
  UNION ALL
  SELECT 47, 'table:stock_units',
         IF(EXISTS(SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='stock_units'), 'OK', 'MISSING'),
         'Serial stock (HMS unique ID)'
  UNION ALL
  SELECT 48, 'table:stock_receipts',
         IF(EXISTS(SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='stock_receipts'), 'OK', 'MISSING'),
         'Add stock receipts'
  UNION ALL
  SELECT 49, 'table:brands',
         IF(EXISTS(SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='brands'), 'OK', 'MISSING'),
         'Product brands'
  UNION ALL
  SELECT 50, 'table:sales_requisitions',
         IF(EXISTS(SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='sales_requisitions'), 'OK', 'MISSING'),
         'Release & ship / requisitions'
  UNION ALL
  SELECT 51, 'table:invoices',
         IF(EXISTS(SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='invoices'), 'OK', 'MISSING'),
         'Proformas / invoices'
  UNION ALL
  SELECT 52, 'table:spare_part_changes',
         IF(EXISTS(SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='spare_part_changes'), 'OK', 'MISSING'),
         'Spares on tickets'
  UNION ALL
  SELECT 53, 'table:rental_agreements',
         IF(EXISTS(SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='rental_agreements'), 'OK', 'MISSING'),
         'Rentals'
  UNION ALL
  SELECT 53.1, 'col:rental_agreements.monthly_rate',
         IF(EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='rental_agreements' AND COLUMN_NAME='monthly_rate'), 'OK', 'MISSING'),
         'Rental monthly hire rate'
  UNION ALL
  SELECT 54, 'table:team_channels',
         IF(EXISTS(SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='team_channels'), 'OK', 'MISSING'),
         'Team chat'
  UNION ALL
  -- ---- Performance indexes (match by column set — name may differ Prisma vs manual) ----
  -- OK if any index on the table has these columns as a left prefix (ORDER BY SEQ_IN_INDEX).
  SELECT 60, 'idx:tickets(tenant_id,assigned_to_id,status)',
         IF(EXISTS(
           SELECT 1 FROM (
             SELECT INDEX_NAME, GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS cols
             FROM information_schema.STATISTICS
             WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='tickets'
             GROUP BY INDEX_NAME
           ) x WHERE x.cols = 'tenant_id,assigned_to_id,status'
              OR x.cols LIKE 'tenant_id,assigned_to_id,status,%'
         ), 'OK', 'MISSING'),
         'Ticket queue / assign lists'
  UNION ALL
  SELECT 61, 'idx:tickets(tenant_id,contact_id,status)',
         IF(EXISTS(
           SELECT 1 FROM (
             SELECT INDEX_NAME, GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS cols
             FROM information_schema.STATISTICS
             WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='tickets'
             GROUP BY INDEX_NAME
           ) x WHERE x.cols = 'tenant_id,contact_id,status'
              OR x.cols LIKE 'tenant_id,contact_id,status,%'
         ), 'OK', 'MISSING'),
         'Tickets by customer'
  UNION ALL
  SELECT 62, 'idx:tickets(tenant_id,created_at)',
         IF(EXISTS(
           SELECT 1 FROM (
             SELECT INDEX_NAME, GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS cols
             FROM information_schema.STATISTICS
             WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='tickets'
             GROUP BY INDEX_NAME
           ) x WHERE x.cols = 'tenant_id,created_at'
              OR x.cols LIKE 'tenant_id,created_at,%'
         ), 'OK', 'MISSING'),
         'Ticket created-date sort'
  UNION ALL
  SELECT 63, 'idx:tickets(tenant_id,sla_breached,status)',
         IF(EXISTS(
           SELECT 1 FROM (
             SELECT INDEX_NAME, GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS cols
             FROM information_schema.STATISTICS
             WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='tickets'
             GROUP BY INDEX_NAME
           ) x WHERE x.cols = 'tenant_id,sla_breached,status'
              OR x.cols LIKE 'tenant_id,sla_breached,status,%'
         ), 'OK', 'MISSING'),
         'SLA breach filters'
  UNION ALL
  SELECT 64, 'idx:tickets(tenant_id,deleted_at,status)',
         IF(EXISTS(
           SELECT 1 FROM (
             SELECT INDEX_NAME, GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS cols
             FROM information_schema.STATISTICS
             WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='tickets'
             GROUP BY INDEX_NAME
           ) x WHERE x.cols = 'tenant_id,deleted_at,status'
              OR x.cols LIKE 'tenant_id,deleted_at,status,%'
         ), 'OK', 'MISSING'),
         'Ticket status filters'
  UNION ALL
  SELECT 65, 'idx:leads(tenant_id,assigned_to_id,status)',
         IF(EXISTS(
           SELECT 1 FROM (
             SELECT INDEX_NAME, GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS cols
             FROM information_schema.STATISTICS
             WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='leads'
             GROUP BY INDEX_NAME
           ) x WHERE x.cols = 'tenant_id,assigned_to_id,status'
              OR x.cols LIKE 'tenant_id,assigned_to_id,status,%'
         ), 'OK', 'MISSING'),
         'Leads by assignee'
  UNION ALL
  SELECT 66, 'idx:leads(tenant_id,deleted_at,status)',
         IF(EXISTS(
           SELECT 1 FROM (
             SELECT INDEX_NAME, GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS cols
             FROM information_schema.STATISTICS
             WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='leads'
             GROUP BY INDEX_NAME
           ) x WHERE x.cols = 'tenant_id,deleted_at,status'
              OR x.cols LIKE 'tenant_id,deleted_at,status,%'
         ), 'OK', 'MISSING'),
         'Sales list filters'
  UNION ALL
  SELECT 67, 'idx:activities(tenant_id,assigned_to_id,status)',
         IF(EXISTS(
           SELECT 1 FROM (
             SELECT INDEX_NAME, GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS cols
             FROM information_schema.STATISTICS
             WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='activities'
             GROUP BY INDEX_NAME
           ) x WHERE x.cols = 'tenant_id,assigned_to_id,status'
              OR x.cols LIKE 'tenant_id,assigned_to_id,status,%'
         ), 'OK', 'MISSING'),
         'Activities by assignee'
  UNION ALL
  SELECT 68, 'idx:activities(tenant_id,status,scheduled_at)',
         IF(EXISTS(
           SELECT 1 FROM (
             SELECT INDEX_NAME, GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS cols
             FROM information_schema.STATISTICS
             WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='activities'
             GROUP BY INDEX_NAME
           ) x WHERE x.cols = 'tenant_id,status,scheduled_at'
              OR x.cols LIKE 'tenant_id,status,scheduled_at,%'
         ), 'OK', 'MISSING'),
         'Scheduled activities'
  UNION ALL
  SELECT 69, 'idx:notifications(tenant_id,user_id,is_read,created_at)',
         IF(EXISTS(
           SELECT 1 FROM (
             SELECT INDEX_NAME, GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS cols
             FROM information_schema.STATISTICS
             WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='notifications'
             GROUP BY INDEX_NAME
           ) x WHERE x.cols = 'tenant_id,user_id,is_read,created_at'
              OR x.cols LIKE 'tenant_id,user_id,is_read,created_at,%'
         ), 'OK', 'MISSING'),
         'Notification panel'
  UNION ALL
  SELECT 70, 'idx:contacts(tenant_id,deleted_at,name)',
         IF(EXISTS(
           SELECT 1 FROM (
             SELECT INDEX_NAME, GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS cols
             FROM information_schema.STATISTICS
             WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='contacts'
             GROUP BY INDEX_NAME
           ) x WHERE x.cols = 'tenant_id,deleted_at,name'
              OR x.cols LIKE 'tenant_id,deleted_at,name,%'
         ), 'OK', 'MISSING'),
         'Customer search / lists'
) AS checklist
ORDER BY sort_order;

-- Summary counts
SELECT
  SUM(result = 'OK') AS ok_count,
  SUM(result = 'MISSING') AS missing_count,
  CASE
    WHEN SUM(result = 'MISSING') = 0 THEN 'ALL CHECKS PASSED'
    ELSE CONCAT(SUM(result = 'MISSING'), ' item(s) MISSING — see rows above')
  END AS verdict
FROM (
  SELECT IF(EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='users' AND COLUMN_NAME='temp_password'), 'OK', 'MISSING') AS result
  UNION ALL SELECT IF(EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='tickets' AND COLUMN_NAME='closed_at'), 'OK', 'MISSING')
  UNION ALL SELECT IF(EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='tickets' AND COLUMN_NAME='paid_at'), 'OK', 'MISSING')
  UNION ALL SELECT IF(EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='tickets' AND COLUMN_NAME='payment_status'), 'OK', 'MISSING')
  UNION ALL SELECT IF(EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='tickets' AND COLUMN_NAME='payment_total'), 'OK', 'MISSING')
  UNION ALL SELECT IF(EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='tickets' AND COLUMN_NAME='custom_fields'), 'OK', 'MISSING')
  UNION ALL SELECT IF(EXISTS(SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='stock_units'), 'OK', 'MISSING')
  UNION ALL SELECT IF(EXISTS(SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='sales_requisitions'), 'OK', 'MISSING')
  UNION ALL SELECT IF(EXISTS(SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='customer_assets'), 'OK', 'MISSING')
  UNION ALL SELECT IF(EXISTS(
    SELECT 1 FROM (
      SELECT INDEX_NAME, GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS cols
      FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='tickets'
      GROUP BY INDEX_NAME
    ) x WHERE x.cols = 'tenant_id,created_at' OR x.cols LIKE 'tenant_id,created_at,%'
  ), 'OK', 'MISSING')
) AS critical;

-- =============================================================================
-- 2) Full table inventory vs repo master (52 tables in 00_full_create.sql)
-- =============================================================================
SELECT COUNT(*) AS table_count_now,
       52 AS expected_full_master,
       CASE WHEN COUNT(*) >= 52 THEN 'FULL SCHEMA PRESENT'
            ELSE CONCAT('Only ', COUNT(*), ' tables — some ERP tables may be missing')
       END AS note
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = DATABASE();

SELECT expected_table AS missing_table
FROM (
  SELECT 'platform_admins' AS expected_table UNION ALL SELECT 'business_categories'
  UNION ALL SELECT 'tenants' UNION ALL SELECT 'tenant_modules'
  UNION ALL SELECT 'custom_field_definitions' UNION ALL SELECT 'feature_tips'
  UNION ALL SELECT 'roles' UNION ALL SELECT 'users' UNION ALL SELECT 'refresh_tokens'
  UNION ALL SELECT 'pipeline_stages' UNION ALL SELECT 'lead_sources'
  UNION ALL SELECT 'accounts' UNION ALL SELECT 'contacts' UNION ALL SELECT 'leads'
  UNION ALL SELECT 'deals' UNION ALL SELECT 'activities' UNION ALL SELECT 'tickets'
  UNION ALL SELECT 'customer_assets' UNION ALL SELECT 'spare_part_changes'
  UNION ALL SELECT 'spare_part_items' UNION ALL SELECT 'spare_stock_txns'
  UNION ALL SELECT 'ticket_messages' UNION ALL SELECT 'notes' UNION ALL SELECT 'notifications'
  UNION ALL SELECT 'product_categories' UNION ALL SELECT 'products' UNION ALL SELECT 'warehouses'
  UNION ALL SELECT 'stock_levels' UNION ALL SELECT 'stock_movements' UNION ALL SELECT 'brands'
  UNION ALL SELECT 'stock_receipts' UNION ALL SELECT 'stock_units' UNION ALL SELECT 'vendors'
  UNION ALL SELECT 'purchase_orders' UNION ALL SELECT 'purchase_order_lines'
  UNION ALL SELECT 'sales_orders' UNION ALL SELECT 'sales_order_lines'
  UNION ALL SELECT 'sales_requisitions' UNION ALL SELECT 'invoices' UNION ALL SELECT 'invoice_lines'
  UNION ALL SELECT 'payments' UNION ALL SELECT 'employees' UNION ALL SELECT 'integrations'
  UNION ALL SELECT 'whatsapp_conversations' UNION ALL SELECT 'whatsapp_messages'
  UNION ALL SELECT 'automation_rules' UNION ALL SELECT 'audit_logs' UNION ALL SELECT 'number_sequences'
  UNION ALL SELECT 'rental_agreements' UNION ALL SELECT 'team_channels'
  UNION ALL SELECT 'team_channel_members' UNION ALL SELECT 'team_messages'
) AS expected
WHERE NOT EXISTS (
  SELECT 1 FROM information_schema.TABLES t
  WHERE t.TABLE_SCHEMA = DATABASE() AND t.TABLE_NAME = expected.expected_table
)
ORDER BY expected_table;
-- Empty result = all 52 tables present.

-- =============================================================================
-- 3) Tickets column detail (payment / close / report support)
-- =============================================================================
SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'tickets'
  AND COLUMN_NAME IN (
    'created_at', 'closed_at', 'resolved_at', 'paid_at',
    'payment_status', 'payment_total', 'advance_amount', 'od_amount',
    'payment_method', 'payment_reference', 'payment_proof_url',
    'service_invoice_id', 'custom_fields', 'stamping_date', 'next_due_date',
    'status', 'assigned_to_id', 'contact_id', 'asset_id'
  )
ORDER BY ORDINAL_POSITION;

-- =============================================================================
-- 4) Live data sanity — ONLY run if section 1 shows tickets.payment_status = OK
-- If you see Error 1054 Unknown column 'payment_status':
--   you are NOT on the same DB as production app.
--   Run this first:
--     SELECT DATABASE() AS db_now, @@hostname AS host_now;
--     SHOW COLUMNS FROM tickets LIKE 'payment%';
--   Expect: payment_status, payment_total, paid_at on database `novacrm`
--   Host should match: chatbotdynamic-rds….us-east-1.rds.amazonaws.com
-- =============================================================================
SELECT DATABASE() AS db_now, @@hostname AS host_now, @@port AS port_now;

SELECT id, slug, code, status, name, logo_url
FROM tenants
WHERE deleted_at IS NULL
ORDER BY created_at;

-- Safe: only aggregates columns that exist (skips payment KPI if column missing)
SET @has_pay := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tickets' AND COLUMN_NAME = 'payment_status'
);
SET @sql_ticket_kpi := IF(
  @has_pay > 0,
  'SELECT
     COUNT(*) AS tickets_total,
     SUM(status = ''CLOSED'') AS closed_count,
     SUM(status = ''CLOSED'' AND closed_at IS NOT NULL) AS closed_with_date,
     SUM(payment_status = ''PAID'') AS paid_count,
     SUM(payment_status = ''PAID'' AND paid_at IS NOT NULL) AS paid_with_paid_at,
     ROUND(SUM(CASE
       WHEN payment_status = ''PAID''
         AND COALESCE(paid_at, closed_at, resolved_at) >= DATE_FORMAT(CURDATE(), ''%Y-%m-01'')
         AND COALESCE(paid_at, closed_at, resolved_at) < DATE_FORMAT(DATE_ADD(CURDATE(), INTERVAL 1 MONTH), ''%Y-%m-01'')
       THEN payment_total ELSE 0 END), 2) AS service_collected_this_calendar_month
   FROM tickets WHERE deleted_at IS NULL',
  'SELECT
     ''SKIPPED — tickets.payment_status missing on this database'' AS warning,
     DATABASE() AS db_now,
     @@hostname AS host_now'
);
PREPARE stmt_ticket_kpi FROM @sql_ticket_kpi;
EXECUTE stmt_ticket_kpi;
DEALLOCATE PREPARE stmt_ticket_kpi;

SET @sql_sr := IF(
  @has_pay > 0,
  'SELECT COUNT(*) AS closed_with_service_report_json
   FROM tickets
   WHERE deleted_at IS NULL
     AND status = ''CLOSED''
     AND custom_fields IS NOT NULL
     AND JSON_CONTAINS_PATH(custom_fields, ''one'', ''$.serviceReport'')',
  'SELECT 0 AS closed_with_service_report_json, ''skipped'' AS note'
);
PREPARE stmt_sr FROM @sql_sr;
EXECUTE stmt_sr;
DEALLOCATE PREPARE stmt_sr;

SELECT
  COUNT(*) AS leads_total,
  SUM(created_at IS NOT NULL) AS leads_with_created_at
FROM leads
WHERE deleted_at IS NULL;

-- =============================================================================
-- 5) FIX (only if section 1 showed MISSING) — safe to re-run; ignore 1061
-- Uncomment the blocks you need, then run.
-- =============================================================================

-- -- 5a) users.temp_password
-- ALTER TABLE `users`
--   ADD COLUMN `temp_password` VARCHAR(128) NULL AFTER `password_hash`;

-- -- 5a2) tickets payment columns (ONLY if SHOW COLUMNS proves they are missing
-- --      on THIS connection — do NOT run on prod app DB; already present there)
-- ALTER TABLE `tickets`
--   ADD COLUMN `payment_total` DECIMAL(15,2) NOT NULL DEFAULT 0 AFTER `od_amount`,
--   ADD COLUMN `advance_amount` DECIMAL(15,2) NOT NULL DEFAULT 0 AFTER `payment_total`,
--   ADD COLUMN `payment_status` ENUM('UNPAID','PARTIAL','PAID') NOT NULL DEFAULT 'UNPAID' AFTER `advance_amount`,
--   ADD COLUMN `paid_at` DATETIME(3) NULL AFTER `payment_status`,
--   ADD COLUMN `payment_method` ENUM('CASH','UPI','NEFT','RTGS','CHEQUE','CARD','OTHER') NULL AFTER `paid_at`,
--   ADD COLUMN `payment_reference` VARCHAR(80) NULL AFTER `payment_method`,
--   ADD COLUMN `payment_proof_url` VARCHAR(500) NULL AFTER `payment_reference`,
--   ADD COLUMN `service_invoice_id` CHAR(36) NULL AFTER `payment_proof_url`;

-- -- 5b) Core performance indexes
-- ALTER TABLE `tickets` ADD INDEX `tickets_tenant_assigned_status_idx` (`tenant_id`, `assigned_to_id`, `status`);
-- ALTER TABLE `tickets` ADD INDEX `tickets_tenant_contact_status_idx` (`tenant_id`, `contact_id`, `status`);
-- ALTER TABLE `tickets` ADD INDEX `tickets_tenant_created_idx` (`tenant_id`, `created_at`);
-- ALTER TABLE `tickets` ADD INDEX `tickets_tenant_sla_status_idx` (`tenant_id`, `sla_breached`, `status`);
-- ALTER TABLE `tickets` ADD INDEX `tickets_tenant_deleted_status_idx` (`tenant_id`, `deleted_at`, `status`);
-- ALTER TABLE `leads` ADD INDEX `leads_tenant_assigned_status_idx` (`tenant_id`, `assigned_to_id`, `status`);
-- ALTER TABLE `leads` ADD INDEX `leads_tenant_deleted_status_idx` (`tenant_id`, `deleted_at`, `status`);
-- ALTER TABLE `activities` ADD INDEX `activities_tenant_assigned_status_idx` (`tenant_id`, `assigned_to_id`, `status`);
-- ALTER TABLE `activities` ADD INDEX `activities_tenant_status_sched_idx` (`tenant_id`, `status`, `scheduled_at`);
-- ALTER TABLE `notifications` ADD INDEX `notifications_tenant_user_read_created_idx` (`tenant_id`, `user_id`, `is_read`, `created_at`);
-- ALTER TABLE `contacts` ADD INDEX `contacts_tenant_deleted_name_idx` (`tenant_id`, `deleted_at`, `name`);

-- -- 5c) Missing whole tables → do NOT invent ALTERs here.
-- --     Apply CREATE TABLE IF NOT EXISTS from:
-- --       database/rds/00_full_create.sql
-- --     (or 02_schema.sql) for only the missing table names from section 2.

-- =============================================================================
-- Done. Prefer section 1 RESULT = all OK before relying on new app deploy.
-- App code still must be pushed (GitHub → Vercel + Render) separately.
-- =============================================================================
