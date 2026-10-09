-- Spare parts quantity stock (billing / weighing families)
-- Auto-created by ensureSpareStockTables() if missing; this SQL is for manual apply.

CREATE TABLE IF NOT EXISTS `spare_part_items` (
  `id` CHAR(36) NOT NULL,
  `tenant_id` CHAR(36) NOT NULL,
  `machine_family` ENUM('WEIGHING', 'BILLING') NOT NULL,
  `name` VARCHAR(191) NOT NULL,
  `part_code` VARCHAR(64) NULL,
  `unit` VARCHAR(32) NOT NULL DEFAULT 'NOS',
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  `custom_fields` JSON NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  `deleted_at` DATETIME(3) NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `spare_part_items_tenant_family_name` (`tenant_id`, `machine_family`, `name`),
  KEY `spare_part_items_tenant_family_active` (`tenant_id`, `machine_family`, `is_active`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `spare_stock_txns` (
  `id` CHAR(36) NOT NULL,
  `tenant_id` CHAR(36) NOT NULL,
  `spare_part_id` CHAR(36) NOT NULL,
  `txn_type` ENUM('IN', 'OUT') NOT NULL,
  `quantity` DECIMAL(15, 3) NOT NULL,
  `txn_date` DATE NOT NULL,
  `supplier_name` VARCHAR(191) NULL,
  `invoice_date` DATE NULL,
  `invoice_no` VARCHAR(80) NULL,
  `issued_to_user_id` CHAR(36) NULL,
  `ticket_id` CHAR(36) NULL,
  `notes` TEXT NULL,
  `created_by_id` CHAR(36) NOT NULL,
  `custom_fields` JSON NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  `deleted_at` DATETIME(3) NULL,
  PRIMARY KEY (`id`),
  KEY `spare_stock_txns_part_date` (`tenant_id`, `spare_part_id`, `txn_date`),
  KEY `spare_stock_txns_type_date` (`tenant_id`, `txn_type`, `txn_date`),
  KEY `spare_stock_txns_issued_to` (`tenant_id`, `issued_to_user_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
