-- =============================================================================
-- Meister CRM+ERP / HMS Enterprises — FULL MySQL schema (AWS RDS MySQL 8)
-- Source of truth: backend/prisma/schema.prisma (generated via prisma migrate diff)
-- =============================================================================
-- WHAT THIS FILE DOES
--   1) Creates database `novacrm` (and optional app user)
--   2) Creates ALL tables (52) matching the current Prisma models
--   3) Adds recommended performance indexes
--
-- APPLY (fresh RDS / empty instance) — as RDS master admin:
--   mysql -h YOUR_RDS_ENDPOINT -P 3306 -u admin -p --ssl-mode=REQUIRED < database/rds/00_full_create.sql
--
-- Or from EC2:
--   mysql -h chatbotdynamic-rds....rds.amazonaws.com -P 3306 -u admin -p --ssl-mode=REQUIRED < 00_full_create.sql
--
-- AFTER SCHEMA: seed users/roles/HMS from the API box:
--   cd backend && npx prisma generate && npm run prisma:seed
--
-- SAFE TO RE-RUN on empty-ish DB: CREATE DATABASE IF NOT EXISTS + CREATE TABLE IF NOT EXISTS
-- Does NOT DROP data. Ignore "Duplicate key name" (1061) on indexes section.
--
-- WARNING: Do NOT run the CREATE USER section if the user already exists — edit passwords first.
-- =============================================================================

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;
SET sql_mode = 'STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION';
SET time_zone = '+00:00';

-- -----------------------------------------------------------------------------
-- 1) DATABASE
-- -----------------------------------------------------------------------------
CREATE DATABASE IF NOT EXISTS `novacrm`
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE `novacrm`;

-- -----------------------------------------------------------------------------
-- 2) OPTIONAL APP USER (edit password; skip if user already exists)
--    Uncomment and set a strong password, then GRANT.
-- -----------------------------------------------------------------------------
-- CREATE USER IF NOT EXISTS 'meister'@'%' IDENTIFIED BY 'CHANGE_ME_STRONG_PASSWORD';
-- GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, INDEX, REFERENCES, DROP
--   ON `novacrm`.* TO 'meister'@'%';
-- FLUSH PRIVILEGES;

-- -----------------------------------------------------------------------------
-- 3) ALL TABLES (52) — from Prisma schema
-- -----------------------------------------------------------------------------
-- CreateTable
CREATE TABLE IF NOT EXISTS `platform_admins` (
    `id` CHAR(36) NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `password_hash` VARCHAR(255) NOT NULL,
    `phone` VARCHAR(32) NULL,
    `role` ENUM('SUPER_ADMIN', 'SUPPORT', 'BILLING') NOT NULL DEFAULT 'SUPER_ADMIN',
    `status` ENUM('ACTIVE', 'INACTIVE') NOT NULL DEFAULT 'ACTIVE',
    `last_login_at` DATETIME(3) NULL,
    `mfa_secret` VARCHAR(64) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    `deleted_at` DATETIME(3) NULL,

    UNIQUE INDEX `platform_admins_email_key`(`email`),
    PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE IF NOT EXISTS `business_categories` (
    `id` CHAR(36) NOT NULL,
    `code` VARCHAR(64) NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `description` TEXT NULL,
    `icon` VARCHAR(64) NOT NULL DEFAULT 'scale',
    `color_hex` CHAR(7) NOT NULL DEFAULT '#2563EB',
    `default_currency` CHAR(3) NOT NULL DEFAULT 'INR',
    `default_timezone` VARCHAR(64) NOT NULL DEFAULT 'Asia/Kolkata',
    `default_modules` JSON NOT NULL,
    `terminology` JSON NOT NULL,
    `template_config` JSON NOT NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `sort_order` INTEGER NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    `deleted_at` DATETIME(3) NULL,

    UNIQUE INDEX `business_categories_code_key`(`code`),
    INDEX `business_categories_is_active_sort_order_idx`(`is_active`, `sort_order`),
    PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE IF NOT EXISTS `tenants` (
    `id` CHAR(36) NOT NULL,
    `code` VARCHAR(32) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `slug` VARCHAR(64) NOT NULL,
    `business_category_id` CHAR(36) NOT NULL,
    `status` ENUM('TRIAL', 'ACTIVE', 'SUSPENDED', 'CANCELLED') NOT NULL DEFAULT 'TRIAL',
    `plan` ENUM('STARTER', 'GROWTH', 'BUSINESS', 'ENTERPRISE') NOT NULL DEFAULT 'STARTER',
    `isolation_level` ENUM('SHARED', 'DEDICATED_SCHEMA') NOT NULL DEFAULT 'SHARED',
    `logo_url` VARCHAR(512) NULL,
    `website` VARCHAR(255) NULL,
    `email` VARCHAR(191) NULL,
    `phone` VARCHAR(32) NULL,
    `gstin` VARCHAR(32) NULL,
    `pan` VARCHAR(16) NULL,
    `address_line1` VARCHAR(255) NULL,
    `address_line2` VARCHAR(255) NULL,
    `city` VARCHAR(100) NULL,
    `state` VARCHAR(100) NULL,
    `postal_code` VARCHAR(20) NULL,
    `country` CHAR(2) NOT NULL DEFAULT 'IN',
    `currency` CHAR(3) NOT NULL DEFAULT 'INR',
    `timezone` VARCHAR(64) NOT NULL DEFAULT 'Asia/Kolkata',
    `fiscal_year_start_month` SMALLINT NOT NULL DEFAULT 4,
    `max_users` INTEGER NOT NULL DEFAULT 10,
    `max_storage_mb` INTEGER NOT NULL DEFAULT 5120,
    `trial_ends_at` DATETIME(3) NULL,
    `activated_at` DATETIME(3) NULL,
    `suspended_at` DATETIME(3) NULL,
    `modules_enabled` JSON NOT NULL,
    `terminology` JSON NULL,
    `branding` JSON NULL,
    `settings` JSON NULL,
    `created_by_admin_id` CHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    `deleted_at` DATETIME(3) NULL,

    UNIQUE INDEX `tenants_code_key`(`code`),
    UNIQUE INDEX `tenants_slug_key`(`slug`),
    INDEX `tenants_status_idx`(`status`),
    INDEX `tenants_business_category_id_idx`(`business_category_id`),
    PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE IF NOT EXISTS `tenant_modules` (
    `id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NOT NULL,
    `module_key` VARCHAR(64) NOT NULL,
    `module_group` ENUM('CRM', 'ERP', 'ENGAGEMENT', 'SETTINGS', 'REPORTS') NOT NULL,
    `label` VARCHAR(120) NOT NULL,
    `is_enabled` BOOLEAN NOT NULL DEFAULT true,
    `sort_order` INTEGER NOT NULL DEFAULT 0,
    `config` JSON NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

    INDEX `tenant_modules_tenant_id_module_group_is_enabled_idx`(`tenant_id`, `module_group`, `is_enabled`),
    UNIQUE INDEX `tenant_modules_tenant_id_module_key_key`(`tenant_id`, `module_key`),
    PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE IF NOT EXISTS `custom_field_definitions` (
    `id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NOT NULL,
    `entity_type` VARCHAR(64) NOT NULL,
    `field_key` VARCHAR(64) NOT NULL,
    `label` VARCHAR(120) NOT NULL,
    `field_type` ENUM('TEXT', 'NUMBER', 'DECIMAL', 'DATE', 'DATETIME', 'BOOLEAN', 'SELECT', 'MULTI_SELECT', 'PHONE', 'EMAIL', 'URL', 'TEXTAREA', 'CURRENCY') NOT NULL,
    `options_json` JSON NULL,
    `is_required` BOOLEAN NOT NULL DEFAULT false,
    `is_unique` BOOLEAN NOT NULL DEFAULT false,
    `is_searchable` BOOLEAN NOT NULL DEFAULT true,
    `is_visible` BOOLEAN NOT NULL DEFAULT true,
    `sort_order` INTEGER NOT NULL DEFAULT 0,
    `help_text` VARCHAR(255) NULL,
    `validation` JSON NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    `deleted_at` DATETIME(3) NULL,

    INDEX `custom_field_definitions_tenant_id_entity_type_is_visible_idx`(`tenant_id`, `entity_type`, `is_visible`),
    UNIQUE INDEX `custom_field_definitions_tenant_id_entity_type_field_key_key`(`tenant_id`, `entity_type`, `field_key`),
    PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE IF NOT EXISTS `feature_tips` (
    `id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NULL,
    `module_key` VARCHAR(64) NOT NULL,
    `section_key` VARCHAR(64) NOT NULL,
    `title` VARCHAR(160) NOT NULL,
    `body` TEXT NOT NULL,
    `tip_type` ENUM('TIP', 'NOTE', 'WARNING', 'BEST_PRACTICE') NOT NULL DEFAULT 'TIP',
    `sort_order` INTEGER NOT NULL DEFAULT 0,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

    INDEX `feature_tips_tenant_id_module_key_section_key_is_active_idx`(`tenant_id`, `module_key`, `section_key`, `is_active`),
    PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE IF NOT EXISTS `roles` (
    `id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NOT NULL,
    `code` VARCHAR(64) NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `description` VARCHAR(255) NULL,
    `is_system` BOOLEAN NOT NULL DEFAULT false,
    `permissions` JSON NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    `deleted_at` DATETIME(3) NULL,

    UNIQUE INDEX `roles_tenant_id_code_key`(`tenant_id`, `code`),
    PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE IF NOT EXISTS `users` (
    `id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NOT NULL,
    `role_id` CHAR(36) NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `password_hash` VARCHAR(255) NOT NULL,
    `temp_password` VARCHAR(128) NULL,
    `phone` VARCHAR(32) NULL,
    `avatar_url` VARCHAR(512) NULL,
    `status` ENUM('ACTIVE', 'INACTIVE', 'INVITED', 'LOCKED') NOT NULL DEFAULT 'INVITED',
    `timezone` VARCHAR(64) NOT NULL DEFAULT 'Asia/Kolkata',
    `locale` VARCHAR(16) NOT NULL DEFAULT 'en-IN',
    `last_login_at` DATETIME(3) NULL,
    `invited_at` DATETIME(3) NULL,
    `invited_by` CHAR(36) NULL,
    `preferences` JSON NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    `deleted_at` DATETIME(3) NULL,

    INDEX `users_tenant_id_status_idx`(`tenant_id`, `status`),
    INDEX `users_role_id_idx`(`role_id`),
    UNIQUE INDEX `users_tenant_id_email_key`(`tenant_id`, `email`),
    PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE IF NOT EXISTS `refresh_tokens` (
    `id` CHAR(36) NOT NULL,
    `user_id` CHAR(36) NULL,
    `platform_admin_id` CHAR(36) NULL,
    `token_hash` VARCHAR(128) NOT NULL,
    `user_agent` VARCHAR(255) NULL,
    `ip_address` VARCHAR(64) NULL,
    `expires_at` DATETIME(3) NOT NULL,
    `revoked_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `refresh_tokens_token_hash_key`(`token_hash`),
    INDEX `refresh_tokens_user_id_idx`(`user_id`),
    INDEX `refresh_tokens_platform_admin_id_idx`(`platform_admin_id`),
    PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE IF NOT EXISTS `pipeline_stages` (
    `id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NOT NULL,
    `name` VARCHAR(80) NOT NULL,
    `code` VARCHAR(40) NOT NULL,
    `color_hex` CHAR(7) NOT NULL DEFAULT '#2563EB',
    `probability` SMALLINT NOT NULL DEFAULT 20,
    `sort_order` INTEGER NOT NULL DEFAULT 0,
    `is_won` BOOLEAN NOT NULL DEFAULT false,
    `is_lost` BOOLEAN NOT NULL DEFAULT false,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

    INDEX `pipeline_stages_tenant_id_sort_order_idx`(`tenant_id`, `sort_order`),
    UNIQUE INDEX `pipeline_stages_tenant_id_code_key`(`tenant_id`, `code`),
    PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE IF NOT EXISTS `lead_sources` (
    `id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NOT NULL,
    `name` VARCHAR(80) NOT NULL,
    `code` VARCHAR(40) NOT NULL,
    `color_hex` CHAR(7) NOT NULL DEFAULT '#64748B',
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `lead_sources_tenant_id_code_key`(`tenant_id`, `code`),
    PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE IF NOT EXISTS `accounts` (
    `id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `account_type` VARCHAR(64) NULL,
    `industry` VARCHAR(100) NULL,
    `website` VARCHAR(255) NULL,
    `phone` VARCHAR(32) NULL,
    `email` VARCHAR(191) NULL,
    `gstin` VARCHAR(32) NULL,
    `pan` VARCHAR(16) NULL,
    `billing_address` JSON NULL,
    `shipping_address` JSON NULL,
    `city` VARCHAR(100) NULL,
    `state` VARCHAR(100) NULL,
    `country` CHAR(2) NOT NULL DEFAULT 'IN',
    `owner_user_id` CHAR(36) NULL,
    `annual_revenue` DECIMAL(15, 2) NULL,
    `employee_count` INTEGER NULL,
    `description` TEXT NULL,
    `tags` JSON NULL,
    `custom_fields` JSON NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    `deleted_at` DATETIME(3) NULL,

    INDEX `accounts_tenant_id_name_idx`(`tenant_id`, `name`),
    INDEX `accounts_tenant_id_owner_user_id_idx`(`tenant_id`, `owner_user_id`),
    INDEX `accounts_tenant_id_phone_idx`(`tenant_id`, `phone`),
    PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE IF NOT EXISTS `contacts` (
    `id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NOT NULL,
    `customer_no` INTEGER NULL,
    `customer_code` VARCHAR(32) NULL,
    `account_id` CHAR(36) NULL,
    `name` VARCHAR(120) NOT NULL,
    `email` VARCHAR(191) NULL,
    `phone` VARCHAR(32) NULL,
    `mobile` VARCHAR(32) NULL,
    `phone_normalized` VARCHAR(20) NULL,
    `title` VARCHAR(120) NULL,
    `department` VARCHAR(120) NULL,
    `street` VARCHAR(255) NULL,
    `door_no` VARCHAR(64) NULL,
    `area` VARCHAR(120) NULL,
    `pincode` VARCHAR(20) NULL,
    `location` VARCHAR(255) NULL,
    `city` VARCHAR(100) NULL,
    `state` VARCHAR(100) NULL,
    `country` CHAR(2) NOT NULL DEFAULT 'IN',
    `owner_user_id` CHAR(36) NULL,
    `tags` JSON NULL,
    `description` TEXT NULL,
    `custom_fields` JSON NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    `deleted_at` DATETIME(3) NULL,

    INDEX `contacts_tenant_id_name_idx`(`tenant_id`, `name`),
    INDEX `contacts_tenant_id_phone_normalized_idx`(`tenant_id`, `phone_normalized`),
    INDEX `contacts_tenant_id_email_idx`(`tenant_id`, `email`),
    INDEX `contacts_tenant_id_account_id_idx`(`tenant_id`, `account_id`),
    INDEX `contacts_tenant_id_deleted_at_name_idx`(`tenant_id`, `deleted_at`, `name`),
    UNIQUE INDEX `contacts_tenant_id_customer_no_key`(`tenant_id`, `customer_no`),
    UNIQUE INDEX `contacts_tenant_id_customer_code_key`(`tenant_id`, `customer_code`),
    PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE IF NOT EXISTS `leads` (
    `id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NOT NULL,
    `lead_no` INTEGER NULL,
    `name` VARCHAR(120) NOT NULL,
    `email` VARCHAR(191) NULL,
    `phone` VARCHAR(32) NULL,
    `phone_normalized` VARCHAR(20) NULL,
    `company` VARCHAR(191) NULL,
    `website` VARCHAR(255) NULL,
    `city` VARCHAR(100) NULL,
    `state` VARCHAR(100) NULL,
    `area` VARCHAR(120) NULL,
    `country` CHAR(2) NOT NULL DEFAULT 'IN',
    `source_id` CHAR(36) NULL,
    `status` ENUM('NEW', 'CONTACTED', 'QUALIFIED', 'UNQUALIFIED', 'LOST', 'CONVERTED', 'DEMO') NOT NULL DEFAULT 'NEW',
    `score` SMALLINT NOT NULL DEFAULT 0,
    `assigned_to_id` CHAR(36) NULL,
    `created_by_id` CHAR(36) NOT NULL,
    `converted_contact_id` CHAR(36) NULL,
    `converted_account_id` CHAR(36) NULL,
    `converted_deal_id` CHAR(36) NULL,
    `converted_at` DATETIME(3) NULL,
    `description` TEXT NULL,
    `tags` JSON NULL,
    `custom_fields` JSON NULL,
    `last_activity_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    `deleted_at` DATETIME(3) NULL,

    INDEX `leads_tenant_id_status_created_at_idx`(`tenant_id`, `status`, `created_at`),
    INDEX `leads_tenant_id_phone_normalized_idx`(`tenant_id`, `phone_normalized`),
    INDEX `leads_tenant_id_assigned_to_id_status_idx`(`tenant_id`, `assigned_to_id`, `status`),
    INDEX `leads_tenant_id_source_id_idx`(`tenant_id`, `source_id`),
    INDEX `leads_tenant_id_area_idx`(`tenant_id`, `area`),
    INDEX `leads_tenant_id_deleted_at_status_idx`(`tenant_id`, `deleted_at`, `status`),
    UNIQUE INDEX `leads_tenant_id_lead_no_key`(`tenant_id`, `lead_no`),
    PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE IF NOT EXISTS `deals` (
    `id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `amount` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `currency` CHAR(3) NOT NULL DEFAULT 'INR',
    `stage_id` CHAR(36) NOT NULL,
    `priority` ENUM('LOW', 'MEDIUM', 'HIGH') NOT NULL DEFAULT 'MEDIUM',
    `probability` SMALLINT NOT NULL DEFAULT 20,
    `expected_close_date` DATE NULL,
    `closed_at` DATETIME(3) NULL,
    `lost_reason` VARCHAR(255) NULL,
    `contact_id` CHAR(36) NULL,
    `account_id` CHAR(36) NULL,
    `owner_user_id` CHAR(36) NULL,
    `description` TEXT NULL,
    `custom_fields` JSON NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    `deleted_at` DATETIME(3) NULL,

    INDEX `deals_tenant_id_stage_id_idx`(`tenant_id`, `stage_id`),
    INDEX `deals_tenant_id_owner_user_id_idx`(`tenant_id`, `owner_user_id`),
    INDEX `deals_tenant_id_expected_close_date_idx`(`tenant_id`, `expected_close_date`),
    INDEX `deals_tenant_id_deleted_at_created_at_idx`(`tenant_id`, `deleted_at`, `created_at`),
    PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE IF NOT EXISTS `activities` (
    `id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NOT NULL,
    `type` ENUM('CALL', 'EMAIL', 'MEETING', 'TASK', 'NOTE', 'WHATSAPP', 'VISIT', 'DEMO') NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `description` TEXT NULL,
    `status` ENUM('PENDING', 'COMPLETED', 'CANCELLED', 'OVERDUE') NOT NULL DEFAULT 'PENDING',
    `scheduled_at` DATETIME(3) NULL,
    `completed_at` DATETIME(3) NULL,
    `duration_minutes` INTEGER NULL,
    `outcome` VARCHAR(255) NULL,
    `lead_id` CHAR(36) NULL,
    `contact_id` CHAR(36) NULL,
    `deal_id` CHAR(36) NULL,
    `account_id` CHAR(36) NULL,
    `assigned_to_id` CHAR(36) NULL,
    `custom_fields` JSON NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    `deleted_at` DATETIME(3) NULL,

    INDEX `activities_tenant_id_scheduled_at_idx`(`tenant_id`, `scheduled_at`),
    INDEX `activities_tenant_id_contact_id_idx`(`tenant_id`, `contact_id`),
    INDEX `activities_tenant_id_lead_id_idx`(`tenant_id`, `lead_id`),
    INDEX `activities_tenant_id_type_status_idx`(`tenant_id`, `type`, `status`),
    INDEX `activities_tenant_id_assigned_to_id_status_idx`(`tenant_id`, `assigned_to_id`, `status`),
    INDEX `activities_tenant_id_status_scheduled_at_idx`(`tenant_id`, `status`, `scheduled_at`),
    PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE IF NOT EXISTS `tickets` (
    `id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NOT NULL,
    `ticket_no` INTEGER NOT NULL,
    `subject` VARCHAR(255) NOT NULL,
    `description` TEXT NOT NULL,
    `priority` ENUM('LOW', 'MEDIUM', 'HIGH', 'CRITICAL') NOT NULL DEFAULT 'MEDIUM',
    `status` ENUM('OPEN', 'IN_PROGRESS', 'PENDING', 'RESOLVED', 'CLOSED') NOT NULL DEFAULT 'OPEN',
    `sla_due_at` DATETIME(3) NULL,
    `sla_breached` BOOLEAN NOT NULL DEFAULT false,
    `contact_id` CHAR(36) NULL,
    `account_id` CHAR(36) NULL,
    `assigned_to_id` CHAR(36) NULL,
    `product_id` CHAR(36) NULL,
    `asset_id` CHAR(36) NULL,
    `stamping_date` DATE NULL,
    `next_due_date` DATE NULL,
    `od_amount` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `payment_total` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `advance_amount` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `payment_status` ENUM('UNPAID', 'PARTIAL', 'PAID') NOT NULL DEFAULT 'UNPAID',
    `paid_at` DATETIME(3) NULL,
    `payment_method` ENUM('CASH', 'UPI', 'NEFT', 'RTGS', 'CHEQUE', 'CARD', 'OTHER') NULL,
    `payment_reference` VARCHAR(80) NULL,
    `payment_proof_url` VARCHAR(500) NULL,
    `service_invoice_id` CHAR(36) NULL,
    `signature_url` VARCHAR(500) NULL,
    `customer_signed_at` DATETIME(3) NULL,
    `received_by_user_id` CHAR(36) NULL,
    `delivered_by_user_id` CHAR(36) NULL,
    `custom_fields` JSON NULL,
    `resolved_at` DATETIME(3) NULL,
    `closed_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    `deleted_at` DATETIME(3) NULL,

    INDEX `tickets_tenant_id_status_priority_idx`(`tenant_id`, `status`, `priority`),
    INDEX `tickets_tenant_id_asset_id_idx`(`tenant_id`, `asset_id`),
    INDEX `tickets_tenant_id_next_due_date_idx`(`tenant_id`, `next_due_date`),
    INDEX `tickets_tenant_id_assigned_to_id_status_idx`(`tenant_id`, `assigned_to_id`, `status`),
    INDEX `tickets_tenant_id_contact_id_status_idx`(`tenant_id`, `contact_id`, `status`),
    INDEX `tickets_tenant_id_created_at_idx`(`tenant_id`, `created_at`),
    INDEX `tickets_tenant_id_sla_breached_status_idx`(`tenant_id`, `sla_breached`, `status`),
    INDEX `tickets_tenant_id_payment_status_status_idx`(`tenant_id`, `payment_status`, `status`),
    INDEX `tickets_tenant_id_deleted_at_status_idx`(`tenant_id`, `deleted_at`, `status`),
    UNIQUE INDEX `tickets_tenant_id_ticket_no_key`(`tenant_id`, `ticket_no`),
    PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE IF NOT EXISTS `customer_assets` (
    `id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NOT NULL,
    `contact_id` CHAR(36) NOT NULL,
    `machine_type` ENUM('WEIGHING', 'BILLING', 'CCM', 'CCTV', 'BIOMETRIC', 'PAPER_SHREDDER', 'PAPER_ROLL', 'OTHER') NOT NULL DEFAULT 'WEIGHING',
    `name` VARCHAR(191) NOT NULL,
    `capacity` VARCHAR(64) NULL,
    `accuracy` VARCHAR(64) NULL,
    `platform_size` VARCHAR(64) NULL,
    `model` VARCHAR(120) NULL,
    `serial_no` VARCHAR(120) NULL,
    `origin` ENUM('SOLD_BY_US', 'THIRD_PARTY') NOT NULL DEFAULT 'SOLD_BY_US',
    `service_plan` ENUM('GC', 'NGC', 'AMC', 'NON_AMC') NOT NULL DEFAULT 'NON_AMC',
    `warranty_end_date` DATE NULL,
    `amc_start_date` DATE NULL,
    `amc_end_date` DATE NULL,
    `next_service_due_date` DATE NULL,
    `reminders_enabled` BOOLEAN NOT NULL DEFAULT true,
    `last_maint_reminder_at` DATETIME(3) NULL,
    `last_amc_reminder_at` DATETIME(3) NULL,
    `last_service_reminder_at` DATETIME(3) NULL,
    `stamping_date` DATE NULL,
    `next_due_date` DATE NULL,
    `notes` TEXT NULL,
    `custom_fields` JSON NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    `deleted_at` DATETIME(3) NULL,

    INDEX `customer_assets_tenant_id_contact_id_idx`(`tenant_id`, `contact_id`),
    INDEX `customer_assets_tenant_id_origin_idx`(`tenant_id`, `origin`),
    INDEX `customer_assets_tenant_id_next_due_date_idx`(`tenant_id`, `next_due_date`),
    INDEX `customer_assets_tenant_id_next_service_due_date_idx`(`tenant_id`, `next_service_due_date`),
    INDEX `customer_assets_tenant_id_warranty_end_date_idx`(`tenant_id`, `warranty_end_date`),
    INDEX `customer_assets_tenant_id_amc_start_date_idx`(`tenant_id`, `amc_start_date`),
    INDEX `customer_assets_tenant_id_amc_end_date_idx`(`tenant_id`, `amc_end_date`),
    INDEX `customer_assets_tenant_id_serial_no_idx`(`tenant_id`, `serial_no`),
    PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE IF NOT EXISTS `spare_part_changes` (
    `id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NOT NULL,
    `contact_id` CHAR(36) NOT NULL,
    `asset_id` CHAR(36) NULL,
    `ticket_id` CHAR(36) NULL,
    `part_name` VARCHAR(191) NOT NULL,
    `part_code` VARCHAR(64) NULL,
    `change_type` ENUM('REPLACED', 'INSTALLED', 'REMOVED', 'REPAIRED', 'ADJUSTED') NOT NULL DEFAULT 'REPLACED',
    `quantity` SMALLINT NOT NULL DEFAULT 1,
    `old_serial_no` VARCHAR(120) NULL,
    `new_serial_no` VARCHAR(120) NULL,
    `changed_at` DATE NOT NULL,
    `performed_by_user_id` CHAR(36) NULL,
    `charge_amount` DECIMAL(12, 2) NULL,
    `under_warranty` BOOLEAN NOT NULL DEFAULT false,
    `notes` TEXT NULL,
    `custom_fields` JSON NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    `deleted_at` DATETIME(3) NULL,

    INDEX `spare_part_changes_tenant_id_contact_id_changed_at_idx`(`tenant_id`, `contact_id`, `changed_at`),
    INDEX `spare_part_changes_tenant_id_asset_id_idx`(`tenant_id`, `asset_id`),
    INDEX `spare_part_changes_tenant_id_changed_at_idx`(`tenant_id`, `changed_at`),
    PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE IF NOT EXISTS `spare_part_items` (
    `id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NOT NULL,
    `machine_family` ENUM('WEIGHING', 'BILLING') NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `part_code` VARCHAR(64) NULL,
    `unit` VARCHAR(32) NOT NULL DEFAULT 'NOS',
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `custom_fields` JSON NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    `deleted_at` DATETIME(3) NULL,

    INDEX `spare_part_items_tenant_id_machine_family_is_active_idx`(`tenant_id`, `machine_family`, `is_active`),
    UNIQUE INDEX `spare_part_items_tenant_id_machine_family_name_key`(`tenant_id`, `machine_family`, `name`),
    PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
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

    INDEX `spare_stock_txns_tenant_id_spare_part_id_txn_date_idx`(`tenant_id`, `spare_part_id`, `txn_date`),
    INDEX `spare_stock_txns_tenant_id_txn_type_txn_date_idx`(`tenant_id`, `txn_type`, `txn_date`),
    INDEX `spare_stock_txns_tenant_id_issued_to_user_id_idx`(`tenant_id`, `issued_to_user_id`),
    PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE IF NOT EXISTS `ticket_messages` (
    `id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NOT NULL,
    `ticket_id` CHAR(36) NOT NULL,
    `content` TEXT NOT NULL,
    `is_internal` BOOLEAN NOT NULL DEFAULT false,
    `author_user_id` CHAR(36) NULL,
    `author_name` VARCHAR(120) NOT NULL,
    `attachments` JSON NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ticket_messages_tenant_id_ticket_id_created_at_idx`(`tenant_id`, `ticket_id`, `created_at`),
    PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE IF NOT EXISTS `notes` (
    `id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NOT NULL,
    `content` TEXT NOT NULL,
    `is_pinned` BOOLEAN NOT NULL DEFAULT false,
    `entity_type` VARCHAR(64) NOT NULL,
    `entity_id` CHAR(36) NOT NULL,
    `created_by_id` CHAR(36) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    `deleted_at` DATETIME(3) NULL,

    INDEX `notes_tenant_id_entity_type_entity_id_idx`(`tenant_id`, `entity_type`, `entity_id`),
    PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE IF NOT EXISTS `notifications` (
    `id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NOT NULL,
    `user_id` CHAR(36) NOT NULL,
    `title` VARCHAR(160) NOT NULL,
    `message` VARCHAR(512) NOT NULL,
    `type` VARCHAR(64) NOT NULL,
    `entity_type` VARCHAR(64) NULL,
    `entity_id` CHAR(36) NULL,
    `is_read` BOOLEAN NOT NULL DEFAULT false,
    `read_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `notifications_tenant_id_user_id_is_read_created_at_idx`(`tenant_id`, `user_id`, `is_read`, `created_at`),
    PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE IF NOT EXISTS `product_categories` (
    `id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NOT NULL,
    `parent_id` CHAR(36) NULL,
    `name` VARCHAR(120) NOT NULL,
    `code` VARCHAR(64) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    `deleted_at` DATETIME(3) NULL,

    INDEX `product_categories_tenant_id_name_idx`(`tenant_id`, `name`),
    PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE IF NOT EXISTS `products` (
    `id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NOT NULL,
    `category_id` CHAR(36) NULL,
    `sku` VARCHAR(64) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `description` TEXT NULL,
    `product_type` ENUM('GOODS', 'SERVICE', 'BUNDLE') NOT NULL DEFAULT 'GOODS',
    `unit` VARCHAR(32) NOT NULL DEFAULT 'NOS',
    `hsn_sac` VARCHAR(16) NULL,
    `sale_price` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `purchase_price` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `mrp` DECIMAL(15, 2) NULL,
    `tax_percent` DECIMAL(5, 2) NOT NULL DEFAULT 18,
    `track_inventory` BOOLEAN NOT NULL DEFAULT true,
    `reorder_level` DECIMAL(15, 3) NOT NULL DEFAULT 0,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `image_url` VARCHAR(512) NULL,
    `attributes` JSON NULL,
    `custom_fields` JSON NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    `deleted_at` DATETIME(3) NULL,

    INDEX `products_tenant_id_name_idx`(`tenant_id`, `name`),
    INDEX `products_tenant_id_category_id_idx`(`tenant_id`, `category_id`),
    UNIQUE INDEX `products_tenant_id_sku_key`(`tenant_id`, `sku`),
    PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE IF NOT EXISTS `warehouses` (
    `id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NOT NULL,
    `code` VARCHAR(32) NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `address` JSON NULL,
    `is_default` BOOLEAN NOT NULL DEFAULT false,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    `deleted_at` DATETIME(3) NULL,

    UNIQUE INDEX `warehouses_tenant_id_code_key`(`tenant_id`, `code`),
    PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE IF NOT EXISTS `stock_levels` (
    `id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NOT NULL,
    `product_id` CHAR(36) NOT NULL,
    `warehouse_id` CHAR(36) NOT NULL,
    `quantity_on_hand` DECIMAL(15, 3) NOT NULL DEFAULT 0,
    `quantity_reserved` DECIMAL(15, 3) NOT NULL DEFAULT 0,
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `stock_levels_tenant_id_product_id_warehouse_id_key`(`tenant_id`, `product_id`, `warehouse_id`),
    PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE IF NOT EXISTS `stock_movements` (
    `id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NOT NULL,
    `product_id` CHAR(36) NOT NULL,
    `warehouse_id` CHAR(36) NOT NULL,
    `movement_type` ENUM('IN', 'OUT', 'ADJUST', 'TRANSFER', 'RETURN') NOT NULL,
    `quantity` DECIMAL(15, 3) NOT NULL,
    `reference_type` VARCHAR(64) NULL,
    `reference_id` CHAR(36) NULL,
    `notes` VARCHAR(255) NULL,
    `performed_by` CHAR(36) NULL,
    `moved_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `stock_movements_tenant_id_product_id_moved_at_idx`(`tenant_id`, `product_id`, `moved_at`),
    PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE IF NOT EXISTS `brands` (
    `id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `code` VARCHAR(32) NOT NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    `deleted_at` DATETIME(3) NULL,

    INDEX `brands_tenant_id_name_idx`(`tenant_id`, `name`),
    UNIQUE INDEX `brands_tenant_id_code_key`(`tenant_id`, `code`),
    PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE IF NOT EXISTS `stock_receipts` (
    `id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NOT NULL,
    `vendor_id` CHAR(36) NULL,
    `brand_id` CHAR(36) NULL,
    `product_id` CHAR(36) NOT NULL,
    `warehouse_id` CHAR(36) NOT NULL,
    `spec` VARCHAR(255) NULL,
    `quantity` INTEGER NOT NULL,
    `unit_amount` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `invoice_no` VARCHAR(64) NULL,
    `invoice_date` DATE NULL,
    `received_date` DATE NOT NULL,
    `notes` TEXT NULL,
    `created_by_id` CHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    `deleted_at` DATETIME(3) NULL,

    INDEX `stock_receipts_tenant_id_received_date_idx`(`tenant_id`, `received_date`),
    INDEX `stock_receipts_tenant_id_vendor_id_idx`(`tenant_id`, `vendor_id`),
    INDEX `stock_receipts_tenant_id_product_id_idx`(`tenant_id`, `product_id`),
    PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE IF NOT EXISTS `stock_units` (
    `id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NOT NULL,
    `product_id` CHAR(36) NOT NULL,
    `warehouse_id` CHAR(36) NOT NULL,
    `serial_no` VARCHAR(120) NOT NULL,
    `hms_uniq_id` VARCHAR(40) NULL,
    `receipt_id` CHAR(36) NULL,
    `brand_id` CHAR(36) NULL,
    `unit_cost` DECIMAL(15, 2) NULL,
    `stamping_date` DATE NULL,
    `notes` TEXT NULL,
    `status` ENUM('IN_STOCK', 'DEMO', 'RENTED', 'SOLD', 'RETURNED') NOT NULL DEFAULT 'IN_STOCK',
    `lead_id` CHAR(36) NULL,
    `contact_id` CHAR(36) NULL,
    `custom_fields` JSON NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    `deleted_at` DATETIME(3) NULL,

    INDEX `stock_units_tenant_id_product_id_status_idx`(`tenant_id`, `product_id`, `status`),
    INDEX `stock_units_tenant_id_warehouse_id_idx`(`tenant_id`, `warehouse_id`),
    INDEX `stock_units_tenant_id_lead_id_idx`(`tenant_id`, `lead_id`),
    INDEX `stock_units_tenant_id_receipt_id_idx`(`tenant_id`, `receipt_id`),
    INDEX `stock_units_tenant_id_brand_id_idx`(`tenant_id`, `brand_id`),
    INDEX `stock_units_tenant_id_status_idx`(`tenant_id`, `status`),
    INDEX `stock_units_tenant_id_deleted_at_status_idx`(`tenant_id`, `deleted_at`, `status`),
    UNIQUE INDEX `stock_units_tenant_id_serial_no_key`(`tenant_id`, `serial_no`),
    UNIQUE INDEX `stock_units_tenant_id_hms_uniq_id_key`(`tenant_id`, `hms_uniq_id`),
    PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE IF NOT EXISTS `vendors` (
    `id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NULL,
    `phone` VARCHAR(32) NULL,
    `gstin` VARCHAR(32) NULL,
    `address` JSON NULL,
    `payment_terms` VARCHAR(64) NULL,
    `custom_fields` JSON NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    `deleted_at` DATETIME(3) NULL,

    INDEX `vendors_tenant_id_name_idx`(`tenant_id`, `name`),
    PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE IF NOT EXISTS `purchase_orders` (
    `id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NOT NULL,
    `po_number` VARCHAR(40) NOT NULL,
    `vendor_id` CHAR(36) NOT NULL,
    `warehouse_id` CHAR(36) NULL,
    `status` ENUM('DRAFT', 'SENT', 'PARTIAL', 'RECEIVED', 'CANCELLED') NOT NULL DEFAULT 'DRAFT',
    `order_date` DATE NOT NULL,
    `expected_date` DATE NULL,
    `subtotal` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `tax_total` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `grand_total` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `notes` TEXT NULL,
    `created_by_id` CHAR(36) NULL,
    `custom_fields` JSON NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    `deleted_at` DATETIME(3) NULL,

    INDEX `purchase_orders_tenant_id_vendor_id_status_idx`(`tenant_id`, `vendor_id`, `status`),
    UNIQUE INDEX `purchase_orders_tenant_id_po_number_key`(`tenant_id`, `po_number`),
    PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE IF NOT EXISTS `purchase_order_lines` (
    `id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NOT NULL,
    `purchase_order_id` CHAR(36) NOT NULL,
    `product_id` CHAR(36) NOT NULL,
    `description` VARCHAR(255) NULL,
    `quantity` DECIMAL(15, 3) NOT NULL,
    `received_qty` DECIMAL(15, 3) NOT NULL DEFAULT 0,
    `unit_price` DECIMAL(15, 2) NOT NULL,
    `tax_percent` DECIMAL(5, 2) NOT NULL DEFAULT 0,
    `line_total` DECIMAL(15, 2) NOT NULL,

    INDEX `purchase_order_lines_tenant_id_purchase_order_id_idx`(`tenant_id`, `purchase_order_id`),
    PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE IF NOT EXISTS `sales_orders` (
    `id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NOT NULL,
    `so_number` VARCHAR(40) NOT NULL,
    `account_id` CHAR(36) NULL,
    `contact_id` CHAR(36) NULL,
    `deal_id` CHAR(36) NULL,
    `status` ENUM('DRAFT', 'CONFIRMED', 'PACKED', 'SHIPPED', 'DELIVERED', 'CANCELLED') NOT NULL DEFAULT 'DRAFT',
    `order_date` DATE NOT NULL,
    `delivery_date` DATE NULL,
    `subtotal` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `tax_total` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `discount_total` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `grand_total` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `notes` TEXT NULL,
    `custom_fields` JSON NULL,
    `created_by_id` CHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    `deleted_at` DATETIME(3) NULL,

    INDEX `sales_orders_tenant_id_account_id_status_idx`(`tenant_id`, `account_id`, `status`),
    UNIQUE INDEX `sales_orders_tenant_id_so_number_key`(`tenant_id`, `so_number`),
    PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE IF NOT EXISTS `sales_order_lines` (
    `id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NOT NULL,
    `sales_order_id` CHAR(36) NOT NULL,
    `product_id` CHAR(36) NOT NULL,
    `description` VARCHAR(255) NULL,
    `quantity` DECIMAL(15, 3) NOT NULL,
    `unit_price` DECIMAL(15, 2) NOT NULL,
    `tax_percent` DECIMAL(5, 2) NOT NULL DEFAULT 0,
    `discount_percent` DECIMAL(5, 2) NOT NULL DEFAULT 0,
    `line_total` DECIMAL(15, 2) NOT NULL,

    INDEX `sales_order_lines_tenant_id_sales_order_id_idx`(`tenant_id`, `sales_order_id`),
    PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE IF NOT EXISTS `sales_requisitions` (
    `id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NOT NULL,
    `req_number` VARCHAR(40) NOT NULL,
    `lead_id` CHAR(36) NOT NULL,
    `contact_id` CHAR(36) NULL,
    `deal_id` CHAR(36) NULL,
    `product_id` CHAR(36) NULL,
    `stock_unit_id` CHAR(36) NULL,
    `serial_no` VARCHAR(80) NULL,
    `product_name` VARCHAR(191) NULL,
    `qty` DECIMAL(15, 3) NOT NULL DEFAULT 1,
    `advance_amount` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `payment_notes` TEXT NULL,
    `status` ENUM('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'FULFILLED', 'CANCELLED') NOT NULL DEFAULT 'PENDING_APPROVAL',
    `requested_by_id` CHAR(36) NOT NULL,
    `approved_by_id` CHAR(36) NULL,
    `approved_at` DATETIME(3) NULL,
    `rejected_reason` VARCHAR(500) NULL,
    `invoice_id` CHAR(36) NULL,
    `shipped_at` DATETIME(3) NULL,
    `notes` TEXT NULL,
    `custom_fields` JSON NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    `deleted_at` DATETIME(3) NULL,

    INDEX `sales_requisitions_tenant_id_status_created_at_idx`(`tenant_id`, `status`, `created_at`),
    INDEX `sales_requisitions_tenant_id_lead_id_idx`(`tenant_id`, `lead_id`),
    INDEX `sales_requisitions_tenant_id_stock_unit_id_idx`(`tenant_id`, `stock_unit_id`),
    UNIQUE INDEX `sales_requisitions_tenant_id_req_number_key`(`tenant_id`, `req_number`),
    PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE IF NOT EXISTS `invoices` (
    `id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NOT NULL,
    `invoice_number` VARCHAR(40) NOT NULL,
    `sales_order_id` CHAR(36) NULL,
    `service_ticket_id` CHAR(36) NULL,
    `account_id` CHAR(36) NOT NULL,
    `contact_id` CHAR(36) NULL,
    `status` ENUM('DRAFT', 'SENT', 'PARTIAL', 'PAID', 'OVERDUE', 'VOID') NOT NULL DEFAULT 'DRAFT',
    `invoice_date` DATE NOT NULL,
    `due_date` DATE NULL,
    `subtotal` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `tax_total` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `discount_total` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `grand_total` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `amount_paid` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `currency` CHAR(3) NOT NULL DEFAULT 'INR',
    `notes` TEXT NULL,
    `custom_fields` JSON NULL,
    `created_by_id` CHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    `deleted_at` DATETIME(3) NULL,

    INDEX `invoices_tenant_id_account_id_status_idx`(`tenant_id`, `account_id`, `status`),
    INDEX `invoices_tenant_id_due_date_status_idx`(`tenant_id`, `due_date`, `status`),
    INDEX `invoices_tenant_id_service_ticket_id_idx`(`tenant_id`, `service_ticket_id`),
    INDEX `invoices_tenant_id_deleted_at_created_at_idx`(`tenant_id`, `deleted_at`, `created_at`),
    INDEX `invoices_tenant_id_status_idx`(`tenant_id`, `status`),
    UNIQUE INDEX `invoices_tenant_id_invoice_number_key`(`tenant_id`, `invoice_number`),
    PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE IF NOT EXISTS `invoice_lines` (
    `id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NOT NULL,
    `invoice_id` CHAR(36) NOT NULL,
    `product_id` CHAR(36) NULL,
    `description` VARCHAR(255) NOT NULL,
    `quantity` DECIMAL(15, 3) NOT NULL,
    `unit_price` DECIMAL(15, 2) NOT NULL,
    `tax_percent` DECIMAL(5, 2) NOT NULL DEFAULT 0,
    `line_total` DECIMAL(15, 2) NOT NULL,

    INDEX `invoice_lines_tenant_id_invoice_id_idx`(`tenant_id`, `invoice_id`),
    PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE IF NOT EXISTS `payments` (
    `id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NOT NULL,
    `payment_number` VARCHAR(40) NOT NULL,
    `invoice_id` CHAR(36) NULL,
    `account_id` CHAR(36) NULL,
    `vendor_id` CHAR(36) NULL,
    `direction` ENUM('INBOUND', 'OUTBOUND') NOT NULL,
    `method` ENUM('CASH', 'UPI', 'NEFT', 'RTGS', 'CHEQUE', 'CARD', 'OTHER') NOT NULL DEFAULT 'UPI',
    `amount` DECIMAL(15, 2) NOT NULL,
    `currency` CHAR(3) NOT NULL DEFAULT 'INR',
    `paid_at` DATETIME(3) NOT NULL,
    `reference_no` VARCHAR(80) NULL,
    `notes` VARCHAR(255) NULL,
    `created_by_id` CHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    `deleted_at` DATETIME(3) NULL,

    INDEX `payments_tenant_id_invoice_id_idx`(`tenant_id`, `invoice_id`),
    UNIQUE INDEX `payments_tenant_id_payment_number_key`(`tenant_id`, `payment_number`),
    PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE IF NOT EXISTS `employees` (
    `id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NOT NULL,
    `user_id` CHAR(36) NULL,
    `employee_code` VARCHAR(40) NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `email` VARCHAR(191) NULL,
    `phone` VARCHAR(32) NULL,
    `department` VARCHAR(80) NULL,
    `designation` VARCHAR(80) NULL,
    `join_date` DATE NULL,
    `status` ENUM('ACTIVE', 'ON_LEAVE', 'RESIGNED') NOT NULL DEFAULT 'ACTIVE',
    `salary` DECIMAL(15, 2) NULL,
    `custom_fields` JSON NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    `deleted_at` DATETIME(3) NULL,

    UNIQUE INDEX `employees_tenant_id_employee_code_key`(`tenant_id`, `employee_code`),
    PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE IF NOT EXISTS `integrations` (
    `id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NOT NULL,
    `provider` VARCHAR(64) NOT NULL,
    `status` ENUM('DISCONNECTED', 'CONNECTED', 'ERROR') NOT NULL DEFAULT 'DISCONNECTED',
    `config` JSON NULL,
    `secrets_enc` TEXT NULL,
    `last_synced_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `integrations_tenant_id_provider_key`(`tenant_id`, `provider`),
    PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE IF NOT EXISTS `whatsapp_conversations` (
    `id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NOT NULL,
    `provider` VARCHAR(64) NOT NULL DEFAULT 'ASKMEISTER',
    `external_id` VARCHAR(128) NULL,
    `phone` VARCHAR(32) NOT NULL,
    `phone_normalized` VARCHAR(20) NOT NULL,
    `contact_id` CHAR(36) NULL,
    `lead_id` CHAR(36) NULL,
    `contact_name` VARCHAR(120) NULL,
    `last_message` VARCHAR(512) NULL,
    `unread_count` INTEGER NOT NULL DEFAULT 0,
    `meta` JSON NULL,
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `whatsapp_conversations_tenant_id_phone_normalized_idx`(`tenant_id`, `phone_normalized`),
    PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE IF NOT EXISTS `whatsapp_messages` (
    `id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NOT NULL,
    `conversation_id` CHAR(36) NOT NULL,
    `direction` ENUM('INBOUND', 'OUTBOUND') NOT NULL,
    `body` TEXT NOT NULL,
    `status` ENUM('QUEUED', 'SENT', 'DELIVERED', 'READ', 'FAILED') NOT NULL DEFAULT 'SENT',
    `external_id` VARCHAR(128) NULL,
    `sent_by_user_id` CHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `whatsapp_messages_tenant_id_conversation_id_created_at_idx`(`tenant_id`, `conversation_id`, `created_at`),
    PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE IF NOT EXISTS `automation_rules` (
    `id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NOT NULL,
    `name` VARCHAR(160) NOT NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `trigger_module` VARCHAR(64) NOT NULL,
    `trigger_field` VARCHAR(64) NOT NULL,
    `trigger_op` VARCHAR(32) NOT NULL,
    `trigger_value` VARCHAR(255) NOT NULL,
    `action_type` VARCHAR(64) NOT NULL,
    `action_config` JSON NOT NULL,
    `run_count` INTEGER NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

    INDEX `automation_rules_tenant_id_is_active_idx`(`tenant_id`, `is_active`),
    PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE IF NOT EXISTS `audit_logs` (
    `id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NULL,
    `actor_type` ENUM('PLATFORM_ADMIN', 'USER', 'SYSTEM') NOT NULL,
    `actor_id` CHAR(36) NULL,
    `action` VARCHAR(64) NOT NULL,
    `entity_type` VARCHAR(64) NULL,
    `entity_id` CHAR(36) NULL,
    `ip_address` VARCHAR(64) NULL,
    `user_agent` VARCHAR(255) NULL,
    `before_json` JSON NULL,
    `after_json` JSON NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `audit_logs_tenant_id_created_at_idx`(`tenant_id`, `created_at`),
    INDEX `audit_logs_tenant_id_entity_type_entity_id_idx`(`tenant_id`, `entity_type`, `entity_id`),
    PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE IF NOT EXISTS `number_sequences` (
    `tenant_id` CHAR(36) NOT NULL,
    `sequence_key` VARCHAR(40) NOT NULL,
    `prefix` VARCHAR(20) NOT NULL DEFAULT '',
    `next_value` INTEGER NOT NULL DEFAULT 1,
    `padding` SMALLINT NOT NULL DEFAULT 5,
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`tenant_id`, `sequence_key`)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE IF NOT EXISTS `rental_agreements` (
    `id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NOT NULL,
    `rental_no` VARCHAR(40) NOT NULL,
    `status` ENUM('DRAFT', 'ACTIVE', 'OVERDUE', 'RETURNED', 'CANCELLED') NOT NULL DEFAULT 'DRAFT',
    `product_id` CHAR(36) NOT NULL,
    `stock_unit_id` CHAR(36) NOT NULL,
    `contact_id` CHAR(36) NULL,
    `account_id` CHAR(36) NULL,
    `lead_id` CHAR(36) NULL,
    `customer_name` VARCHAR(160) NOT NULL,
    `customer_phone` VARCHAR(32) NULL,
    `customer_email` VARCHAR(191) NULL,
    `customer_company` VARCHAR(191) NULL,
    `customer_address` VARCHAR(512) NULL,
    `city` VARCHAR(80) NULL,
    `state` VARCHAR(80) NULL,
    `start_at` DATETIME(3) NOT NULL,
    `expected_return_at` DATETIME(3) NULL,
    `returned_at` DATETIME(3) NULL,
    `daily_rate` DECIMAL(15, 2) NULL,
    `monthly_rate` DECIMAL(15, 2) NULL,
    `total_amount` DECIMAL(15, 2) NULL,
    `deposit_amount` DECIMAL(15, 2) NULL,
    `notes` TEXT NULL,
    `return_notes` TEXT NULL,
    `issued_by_id` CHAR(36) NULL,
    `returned_by_id` CHAR(36) NULL,
    `from_warehouse_id` CHAR(36) NULL,
    `custom_fields` JSON NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

    INDEX `rental_agreements_tenant_id_status_start_at_idx`(`tenant_id`, `status`, `start_at`),
    INDEX `rental_agreements_tenant_id_stock_unit_id_idx`(`tenant_id`, `stock_unit_id`),
    INDEX `rental_agreements_tenant_id_contact_id_idx`(`tenant_id`, `contact_id`),
    INDEX `rental_agreements_tenant_id_product_id_idx`(`tenant_id`, `product_id`),
    UNIQUE INDEX `rental_agreements_tenant_id_rental_no_key`(`tenant_id`, `rental_no`),
    PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE IF NOT EXISTS `team_channels` (
    `id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NOT NULL,
    `type` ENUM('CHANNEL', 'DM') NOT NULL DEFAULT 'CHANNEL',
    `name` VARCHAR(120) NOT NULL,
    `slug` VARCHAR(160) NOT NULL,
    `description` VARCHAR(255) NULL,
    `is_default` BOOLEAN NOT NULL DEFAULT false,
    `created_by_id` CHAR(36) NULL,
    `last_message_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

    INDEX `team_channels_tenant_id_type_last_message_at_idx`(`tenant_id`, `type`, `last_message_at`),
    UNIQUE INDEX `team_channels_tenant_id_slug_key`(`tenant_id`, `slug`),
    PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE IF NOT EXISTS `team_channel_members` (
    `id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NOT NULL,
    `channel_id` CHAR(36) NOT NULL,
    `user_id` CHAR(36) NOT NULL,
    `last_read_at` DATETIME(3) NULL,
    `pinned_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `team_channel_members_tenant_id_user_id_idx`(`tenant_id`, `user_id`),
    UNIQUE INDEX `team_channel_members_channel_id_user_id_key`(`channel_id`, `user_id`),
    PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE IF NOT EXISTS `team_messages` (
    `id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NOT NULL,
    `channel_id` CHAR(36) NOT NULL,
    `sender_id` CHAR(36) NOT NULL,
    `body` TEXT NOT NULL,
    `parent_id` CHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    `deleted_at` DATETIME(3) NULL,

    INDEX `team_messages_tenant_id_channel_id_created_at_idx`(`tenant_id`, `channel_id`, `created_at`),
    INDEX `team_messages_tenant_id_parent_id_idx`(`tenant_id`, `parent_id`),
    PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;


SET FOREIGN_KEY_CHECKS = 1;

-- -----------------------------------------------------------------------------
-- 4) PERFORMANCE INDEXES (ignore Duplicate key name 1061 if already applied)
-- -----------------------------------------------------------------------------
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


-- -----------------------------------------------------------------------------
-- 5) VERIFY
-- -----------------------------------------------------------------------------
SELECT COUNT(*) AS table_count
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = 'novacrm';
-- Expect 52 tables for full master

SHOW TABLES;

SELECT COLUMN_NAME
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = 'novacrm' AND TABLE_NAME = 'users' AND COLUMN_NAME = 'temp_password';
-- Expect: temp_password

SELECT COLUMN_NAME
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = 'novacrm' AND TABLE_NAME = 'tickets' AND COLUMN_NAME = 'payment_status';
-- Expect: payment_status

-- -----------------------------------------------------------------------------
-- 6) NEXT STEPS (not SQL)
-- -----------------------------------------------------------------------------
-- A) Point Render DATABASE_URL at this DB with connection_limit=3..5
-- B) cd backend && npx prisma generate && npm run prisma:seed
-- C) Set HMS logo if needed:
--    UPDATE tenants SET logo_url = 'https://novacrms.vercel.app/hms-logo.png'
--    WHERE slug = 'precision-scales-india';
