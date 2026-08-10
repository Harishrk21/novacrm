-- =============================================================================
-- NovaCRM + NovaERP  |  Enterprise Multi-Tenant Schema (MySQL 8.0+ / Aiven)
-- =============================================================================
-- Architecture: Shared database + shared schema, row isolation via tenant_id
--
-- HOW TO RUN ON AIVEN:
--   MySQL Workbench:
--     1. Connect to your Aiven MySQL service (SSL required)
--     2. File → Open SQL Script → select this file
--     3. Select your Aiven database in the schema list (or uncomment USE below)
--     4. Execute the script (lightning bolt)
--
--   CLI (mysql client):
--     mysql -h HOST -P PORT -u USER -p --ssl-mode=REQUIRED DATABASE \
--       < database/novacrm_aiven_mysql_full.sql
--
--   Aiven does NOT allow CREATE/DROP DATABASE — this script assumes the
--   database already exists. Safe to re-run: CREATE TABLE IF NOT EXISTS and
--   INSERT IGNORE on seed rows.
--
-- Default platform admin after seed (hash updated by backend seed):
--   email:    admin@novacrm.com
--   password: Admin@Nova2026
--
-- IMPORTANT: Run backend `npm run prisma:seed` after this script to create
-- the demo tenant, real bcrypt password hash, and sample CRM/ERP data.
-- =============================================================================

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;
SET sql_mode = 'STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION';
-- USE your_aiven_database;  -- uncomment / set in client if needed

-- =============================================================================
-- 0) UTILITY: updated_at trigger helper note
--    Every mutable table has created_at / updated_at / deleted_at (soft delete)
-- =============================================================================

-- =============================================================================
-- 1) PLATFORM LAYER (Super Admin controls all clients)
-- =============================================================================

CREATE TABLE IF NOT EXISTS platform_admins (
  id              CHAR(36)      NOT NULL,
  name            VARCHAR(120)  NOT NULL,
  email           VARCHAR(191)  NOT NULL,
  password_hash   VARCHAR(255)  NOT NULL,
  phone           VARCHAR(32)   NULL,
  role            ENUM('SUPER_ADMIN','SUPPORT','BILLING') NOT NULL DEFAULT 'SUPER_ADMIN',
  status          ENUM('ACTIVE','INACTIVE') NOT NULL DEFAULT 'ACTIVE',
  last_login_at   DATETIME(3)   NULL,
  mfa_secret      VARCHAR(64)   NULL,
  created_at      DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at      DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  deleted_at      DATETIME(3)   NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_platform_admins_email (email)
) ENGINE=InnoDB;

-- Business categories = industry templates the admin picks when creating a client
CREATE TABLE IF NOT EXISTS business_categories (
  id                CHAR(36)      NOT NULL,
  code              VARCHAR(64)   NOT NULL,          -- e.g. WEIGHING_MACHINES
  name              VARCHAR(120)  NOT NULL,          -- Weighing Machines & Scales
  description       TEXT          NULL,
  icon              VARCHAR(64)   NOT NULL DEFAULT 'scale',
  color_hex         CHAR(7)       NOT NULL DEFAULT '#2563EB',
  default_currency  CHAR(3)       NOT NULL DEFAULT 'INR',
  default_timezone  VARCHAR(64)   NOT NULL DEFAULT 'Asia/Kolkata',
  -- JSON: which CRM/ERP modules are ON by default for this category
  default_modules   JSON          NOT NULL,
  -- JSON: terminology overrides e.g. {"lead":"Enquiry","deal":"Order","account":"Dealer"}
  terminology       JSON          NOT NULL,
  -- JSON: starter pipeline stages, lead sources, product attribute keys
  template_config   JSON          NOT NULL,
  is_active         TINYINT(1)    NOT NULL DEFAULT 1,
  sort_order        INT           NOT NULL DEFAULT 0,
  created_at        DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at        DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  deleted_at        DATETIME(3)   NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_business_categories_code (code),
  KEY idx_business_categories_active (is_active, sort_order)
) ENGINE=InnoDB;

-- Clients / Tenants — each company using NovaCRM
CREATE TABLE IF NOT EXISTS tenants (
  id                    CHAR(36)      NOT NULL,
  code                  VARCHAR(32)   NOT NULL,       -- short code e.g. ACME01
  name                  VARCHAR(191)  NOT NULL,       -- legal / display name
  slug                  VARCHAR(64)   NOT NULL,       -- subdomain / login path
  business_category_id  CHAR(36)      NOT NULL,
  status                ENUM('TRIAL','ACTIVE','SUSPENDED','CANCELLED') NOT NULL DEFAULT 'TRIAL',
  plan                  ENUM('STARTER','GROWTH','BUSINESS','ENTERPRISE') NOT NULL DEFAULT 'STARTER',
  isolation_level       ENUM('SHARED','DEDICATED_SCHEMA') NOT NULL DEFAULT 'SHARED',
  logo_url              VARCHAR(512)  NULL,
  website               VARCHAR(255)  NULL,
  email                 VARCHAR(191)  NULL,
  phone                 VARCHAR(32)   NULL,
  gstin                 VARCHAR(32)   NULL,           -- India GST
  pan                   VARCHAR(16)   NULL,
  address_line1         VARCHAR(255)  NULL,
  address_line2         VARCHAR(255)  NULL,
  city                  VARCHAR(100)  NULL,
  state                 VARCHAR(100)  NULL,
  postal_code           VARCHAR(20)   NULL,
  country               CHAR(2)       NOT NULL DEFAULT 'IN',
  currency              CHAR(3)       NOT NULL DEFAULT 'INR',
  timezone              VARCHAR(64)   NOT NULL DEFAULT 'Asia/Kolkata',
  fiscal_year_start_month TINYINT UNSIGNED NOT NULL DEFAULT 4, -- Apr = Indian FY
  max_users             INT           NOT NULL DEFAULT 10,
  max_storage_mb        INT           NOT NULL DEFAULT 5120,
  trial_ends_at         DATETIME(3)   NULL,
  activated_at          DATETIME(3)   NULL,
  suspended_at          DATETIME(3)   NULL,
  -- Live overrides of category defaults (modules + terminology)
  modules_enabled       JSON          NOT NULL,
  terminology           JSON          NULL,
  branding              JSON          NULL,           -- {primaryColor, logo, favicon}
  settings              JSON          NULL,           -- business hours, numbering series, etc.
  created_by_admin_id   CHAR(36)      NULL,
  created_at            DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at            DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  deleted_at            DATETIME(3)   NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_tenants_code (code),
  UNIQUE KEY uq_tenants_slug (slug),
  KEY idx_tenants_status (status),
  KEY idx_tenants_category (business_category_id),
  CONSTRAINT fk_tenants_category FOREIGN KEY (business_category_id) REFERENCES business_categories(id),
  CONSTRAINT fk_tenants_admin FOREIGN KEY (created_by_admin_id) REFERENCES platform_admins(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS tenant_subscriptions (
  id              CHAR(36)      NOT NULL,
  tenant_id       CHAR(36)      NOT NULL,
  plan            ENUM('STARTER','GROWTH','BUSINESS','ENTERPRISE') NOT NULL,
  billing_cycle   ENUM('MONTHLY','YEARLY') NOT NULL DEFAULT 'MONTHLY',
  amount          DECIMAL(15,2) NOT NULL DEFAULT 0,
  currency        CHAR(3)       NOT NULL DEFAULT 'INR',
  starts_at       DATE          NOT NULL,
  ends_at         DATE          NULL,
  status          ENUM('ACTIVE','PAST_DUE','CANCELLED','EXPIRED') NOT NULL DEFAULT 'ACTIVE',
  meta            JSON          NULL,
  created_at      DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at      DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_tenant_subscriptions_tenant (tenant_id, status),
  CONSTRAINT fk_tenant_subscriptions_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id)
) ENGINE=InnoDB;

-- Admin can enable/disable individual modules per tenant after creation
CREATE TABLE IF NOT EXISTS tenant_modules (
  id              CHAR(36)      NOT NULL,
  tenant_id       CHAR(36)      NOT NULL,
  module_key      VARCHAR(64)   NOT NULL,  -- crm.leads, erp.inventory, erp.invoices...
  module_group    ENUM('CRM','ERP','ENGAGEMENT','SETTINGS','REPORTS') NOT NULL,
  label           VARCHAR(120)  NOT NULL,
  is_enabled      TINYINT(1)    NOT NULL DEFAULT 1,
  sort_order      INT           NOT NULL DEFAULT 0,
  config          JSON          NULL,       -- module-specific knobs
  created_at      DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at      DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_tenant_modules (tenant_id, module_key),
  KEY idx_tenant_modules_group (tenant_id, module_group, is_enabled),
  CONSTRAINT fk_tenant_modules_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Custom fields defined by admin / tenant admin — values stored as JSON on records
CREATE TABLE IF NOT EXISTS custom_field_definitions (
  id              CHAR(36)      NOT NULL,
  tenant_id       CHAR(36)      NOT NULL,
  entity_type     VARCHAR(64)   NOT NULL,  -- lead, contact, account, deal, product, invoice...
  field_key       VARCHAR(64)   NOT NULL,  -- capacity_kg, machine_type
  label           VARCHAR(120)  NOT NULL,
  field_type      ENUM('TEXT','NUMBER','DECIMAL','DATE','DATETIME','BOOLEAN','SELECT','MULTI_SELECT','PHONE','EMAIL','URL','TEXTAREA','CURRENCY') NOT NULL,
  options_json    JSON          NULL,       -- for SELECT / MULTI_SELECT
  is_required     TINYINT(1)    NOT NULL DEFAULT 0,
  is_unique       TINYINT(1)    NOT NULL DEFAULT 0,
  is_searchable   TINYINT(1)    NOT NULL DEFAULT 1,
  is_visible      TINYINT(1)    NOT NULL DEFAULT 1,
  sort_order      INT           NOT NULL DEFAULT 0,
  help_text       VARCHAR(255)  NULL,
  validation      JSON          NULL,       -- {min,max,regex,pattern}
  created_at      DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at      DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  deleted_at      DATETIME(3)   NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_custom_field (tenant_id, entity_type, field_key),
  KEY idx_custom_field_entity (tenant_id, entity_type, is_visible),
  CONSTRAINT fk_custom_field_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- In-app tips / help copy per module (can be overridden per tenant)
CREATE TABLE IF NOT EXISTS feature_tips (
  id              CHAR(36)      NOT NULL,
  tenant_id       CHAR(36)      NULL,      -- NULL = global tip from platform
  module_key      VARCHAR(64)   NOT NULL,
  section_key     VARCHAR(64)   NOT NULL,  -- list, detail, create, kanban...
  title           VARCHAR(160)  NOT NULL,
  body            TEXT          NOT NULL,
  tip_type        ENUM('TIP','NOTE','WARNING','BEST_PRACTICE') NOT NULL DEFAULT 'TIP',
  sort_order      INT           NOT NULL DEFAULT 0,
  is_active       TINYINT(1)    NOT NULL DEFAULT 1,
  created_at      DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at      DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_feature_tips_lookup (tenant_id, module_key, section_key, is_active)
) ENGINE=InnoDB;

-- =============================================================================
-- 2) TENANT USERS & RBAC
-- =============================================================================

CREATE TABLE IF NOT EXISTS roles (
  id              CHAR(36)      NOT NULL,
  tenant_id       CHAR(36)      NOT NULL,
  code            VARCHAR(64)   NOT NULL,  -- ADMIN, MANAGER, AGENT, ACCOUNTANT, READ_ONLY
  name            VARCHAR(120)  NOT NULL,
  description     VARCHAR(255)  NULL,
  is_system       TINYINT(1)    NOT NULL DEFAULT 0,
  permissions     JSON          NOT NULL,  -- ["leads.read","leads.write","inventory.adjust"...]
  created_at      DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at      DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  deleted_at      DATETIME(3)   NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_roles (tenant_id, code),
  CONSTRAINT fk_roles_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS users (
  id              CHAR(36)      NOT NULL,
  tenant_id       CHAR(36)      NOT NULL,
  role_id         CHAR(36)      NOT NULL,
  name            VARCHAR(120)  NOT NULL,
  email           VARCHAR(191)  NOT NULL,
  password_hash   VARCHAR(255)  NOT NULL,
  phone           VARCHAR(32)   NULL,
  avatar_url      VARCHAR(512)  NULL,
  status          ENUM('ACTIVE','INACTIVE','INVITED','LOCKED') NOT NULL DEFAULT 'INVITED',
  timezone        VARCHAR(64)   NOT NULL DEFAULT 'Asia/Kolkata',
  locale          VARCHAR(16)   NOT NULL DEFAULT 'en-IN',
  last_login_at   DATETIME(3)   NULL,
  invited_at      DATETIME(3)   NULL,
  invited_by      CHAR(36)      NULL,
  preferences     JSON          NULL,       -- theme, palette, density
  created_at      DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at      DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  deleted_at      DATETIME(3)   NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_tenant_email (tenant_id, email),
  KEY idx_users_tenant_status (tenant_id, status),
  KEY idx_users_role (role_id),
  CONSTRAINT fk_users_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  CONSTRAINT fk_users_role FOREIGN KEY (role_id) REFERENCES roles(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id              CHAR(36)      NOT NULL,
  user_id         CHAR(36)      NULL,
  platform_admin_id CHAR(36)    NULL,
  token_hash      VARCHAR(128)  NOT NULL,
  user_agent      VARCHAR(255)  NULL,
  ip_address      VARCHAR(64)   NULL,
  expires_at      DATETIME(3)   NOT NULL,
  revoked_at      DATETIME(3)   NULL,
  created_at      DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_refresh_token_hash (token_hash),
  KEY idx_refresh_user (user_id),
  KEY idx_refresh_admin (platform_admin_id),
  CONSTRAINT fk_refresh_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_refresh_admin FOREIGN KEY (platform_admin_id) REFERENCES platform_admins(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS teams (
  id              CHAR(36)      NOT NULL,
  tenant_id       CHAR(36)      NOT NULL,
  name            VARCHAR(120)  NOT NULL,
  manager_user_id CHAR(36)      NULL,
  created_at      DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at      DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  deleted_at      DATETIME(3)   NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_teams (tenant_id, name),
  CONSTRAINT fk_teams_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  CONSTRAINT fk_teams_manager FOREIGN KEY (manager_user_id) REFERENCES users(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS team_members (
  tenant_id       CHAR(36)      NOT NULL,
  team_id         CHAR(36)      NOT NULL,
  user_id         CHAR(36)      NOT NULL,
  joined_at       DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (team_id, user_id),
  KEY idx_team_members_user (tenant_id, user_id),
  CONSTRAINT fk_team_members_team FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE,
  CONSTRAINT fk_team_members_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- =============================================================================
-- 3) CRM CORE
-- =============================================================================

CREATE TABLE IF NOT EXISTS pipeline_stages (
  id              CHAR(36)      NOT NULL,
  tenant_id       CHAR(36)      NOT NULL,
  name            VARCHAR(80)   NOT NULL,
  code            VARCHAR(40)   NOT NULL,
  color_hex       CHAR(7)       NOT NULL DEFAULT '#2563EB',
  probability     TINYINT UNSIGNED NOT NULL DEFAULT 20,
  sort_order      INT           NOT NULL DEFAULT 0,
  is_won          TINYINT(1)    NOT NULL DEFAULT 0,
  is_lost         TINYINT(1)    NOT NULL DEFAULT 0,
  is_active       TINYINT(1)    NOT NULL DEFAULT 1,
  created_at      DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at      DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_pipeline_stages (tenant_id, code),
  KEY idx_pipeline_stages_order (tenant_id, sort_order),
  CONSTRAINT fk_pipeline_stages_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS lead_sources (
  id              CHAR(36)      NOT NULL,
  tenant_id       CHAR(36)      NOT NULL,
  name            VARCHAR(80)   NOT NULL,
  code            VARCHAR(40)   NOT NULL,
  color_hex       CHAR(7)       NOT NULL DEFAULT '#64748B',
  is_active       TINYINT(1)    NOT NULL DEFAULT 1,
  created_at      DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at      DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_lead_sources (tenant_id, code),
  CONSTRAINT fk_lead_sources_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS accounts (
  id              CHAR(36)      NOT NULL,
  tenant_id       CHAR(36)      NOT NULL,
  name            VARCHAR(191)  NOT NULL,
  account_type    VARCHAR(64)   NULL,      -- Customer, Dealer, Distributor, Vendor
  industry        VARCHAR(100)  NULL,
  website         VARCHAR(255)  NULL,
  phone           VARCHAR(32)   NULL,
  email           VARCHAR(191)  NULL,
  gstin           VARCHAR(32)   NULL,
  pan             VARCHAR(16)   NULL,
  billing_address JSON          NULL,
  shipping_address JSON         NULL,
  city            VARCHAR(100)  NULL,
  state           VARCHAR(100)  NULL,
  country         CHAR(2)       NOT NULL DEFAULT 'IN',
  owner_user_id   CHAR(36)      NULL,
  annual_revenue  DECIMAL(15,2) NULL,
  employee_count  INT           NULL,
  description     TEXT          NULL,
  tags            JSON          NULL,
  custom_fields   JSON          NULL,      -- business-specific attributes
  created_at      DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at      DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  deleted_at      DATETIME(3)   NULL,
  PRIMARY KEY (id),
  KEY idx_accounts_tenant_name (tenant_id, name),
  KEY idx_accounts_owner (tenant_id, owner_user_id),
  KEY idx_accounts_phone (tenant_id, phone),
  CONSTRAINT fk_accounts_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  CONSTRAINT fk_accounts_owner FOREIGN KEY (owner_user_id) REFERENCES users(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS contacts (
  id              CHAR(36)      NOT NULL,
  tenant_id       CHAR(36)      NOT NULL,
  account_id      CHAR(36)      NULL,
  name            VARCHAR(120)  NOT NULL,
  email           VARCHAR(191)  NULL,
  phone           VARCHAR(32)   NULL,
  mobile          VARCHAR(32)   NULL,
  phone_normalized VARCHAR(20)  NULL,     -- digits only for fast lookup
  title           VARCHAR(120)  NULL,
  department      VARCHAR(120)  NULL,
  city            VARCHAR(100)  NULL,
  state           VARCHAR(100)  NULL,
  country         CHAR(2)       NOT NULL DEFAULT 'IN',
  owner_user_id   CHAR(36)      NULL,
  tags            JSON          NULL,
  description     TEXT          NULL,
  custom_fields   JSON          NULL,
  created_at      DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at      DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  deleted_at      DATETIME(3)   NULL,
  PRIMARY KEY (id),
  KEY idx_contacts_tenant_name (tenant_id, name),
  KEY idx_contacts_phone_norm (tenant_id, phone_normalized),
  KEY idx_contacts_email (tenant_id, email),
  KEY idx_contacts_account (tenant_id, account_id),
  CONSTRAINT fk_contacts_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  CONSTRAINT fk_contacts_account FOREIGN KEY (account_id) REFERENCES accounts(id),
  CONSTRAINT fk_contacts_owner FOREIGN KEY (owner_user_id) REFERENCES users(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS leads (
  id              CHAR(36)      NOT NULL,
  tenant_id       CHAR(36)      NOT NULL,
  name            VARCHAR(120)  NOT NULL,
  email           VARCHAR(191)  NULL,
  phone           VARCHAR(32)   NULL,
  phone_normalized VARCHAR(20)  NULL,
  company         VARCHAR(191)  NULL,
  website         VARCHAR(255)  NULL,
  city            VARCHAR(100)  NULL,
  state           VARCHAR(100)  NULL,
  country         CHAR(2)       NOT NULL DEFAULT 'IN',
  source_id       CHAR(36)      NULL,
  status          ENUM('NEW','CONTACTED','QUALIFIED','UNQUALIFIED','LOST','CONVERTED') NOT NULL DEFAULT 'NEW',
  score           TINYINT UNSIGNED NOT NULL DEFAULT 0,
  assigned_to_id  CHAR(36)      NULL,
  created_by_id   CHAR(36)      NOT NULL,
  converted_contact_id CHAR(36) NULL,
  converted_account_id CHAR(36) NULL,
  converted_deal_id    CHAR(36) NULL,
  converted_at    DATETIME(3)   NULL,
  description     TEXT          NULL,
  tags            JSON          NULL,
  custom_fields   JSON          NULL,      -- e.g. machine_capacity, industry_use
  last_activity_at DATETIME(3)  NULL,
  created_at      DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at      DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  deleted_at      DATETIME(3)   NULL,
  PRIMARY KEY (id),
  KEY idx_leads_tenant_status (tenant_id, status, created_at),
  KEY idx_leads_phone (tenant_id, phone_normalized),
  KEY idx_leads_assignee (tenant_id, assigned_to_id),
  KEY idx_leads_source (tenant_id, source_id),
  CONSTRAINT fk_leads_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  CONSTRAINT fk_leads_source FOREIGN KEY (source_id) REFERENCES lead_sources(id),
  CONSTRAINT fk_leads_assignee FOREIGN KEY (assigned_to_id) REFERENCES users(id),
  CONSTRAINT fk_leads_creator FOREIGN KEY (created_by_id) REFERENCES users(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS deals (
  id              CHAR(36)      NOT NULL,
  tenant_id       CHAR(36)      NOT NULL,
  name            VARCHAR(191)  NOT NULL,
  amount          DECIMAL(15,2) NOT NULL DEFAULT 0,
  currency        CHAR(3)       NOT NULL DEFAULT 'INR',
  stage_id        CHAR(36)      NOT NULL,
  priority        ENUM('LOW','MEDIUM','HIGH') NOT NULL DEFAULT 'MEDIUM',
  probability     TINYINT UNSIGNED NOT NULL DEFAULT 20,
  expected_close_date DATE      NULL,
  closed_at       DATETIME(3)   NULL,
  lost_reason     VARCHAR(255)  NULL,
  contact_id      CHAR(36)      NULL,
  account_id      CHAR(36)      NULL,
  owner_user_id   CHAR(36)      NULL,
  description     TEXT          NULL,
  custom_fields   JSON          NULL,
  created_at      DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at      DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  deleted_at      DATETIME(3)   NULL,
  PRIMARY KEY (id),
  KEY idx_deals_tenant_stage (tenant_id, stage_id),
  KEY idx_deals_owner (tenant_id, owner_user_id),
  KEY idx_deals_close (tenant_id, expected_close_date),
  CONSTRAINT fk_deals_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  CONSTRAINT fk_deals_stage FOREIGN KEY (stage_id) REFERENCES pipeline_stages(id),
  CONSTRAINT fk_deals_contact FOREIGN KEY (contact_id) REFERENCES contacts(id),
  CONSTRAINT fk_deals_account FOREIGN KEY (account_id) REFERENCES accounts(id),
  CONSTRAINT fk_deals_owner FOREIGN KEY (owner_user_id) REFERENCES users(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS deal_stage_history (
  id              CHAR(36)      NOT NULL,
  tenant_id       CHAR(36)      NOT NULL,
  deal_id         CHAR(36)      NOT NULL,
  from_stage_id   CHAR(36)      NULL,
  to_stage_id     CHAR(36)      NOT NULL,
  changed_by_id   CHAR(36)      NOT NULL,
  days_in_stage   INT           NULL,
  changed_at      DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_deal_history (tenant_id, deal_id, changed_at),
  CONSTRAINT fk_deal_hist_deal FOREIGN KEY (deal_id) REFERENCES deals(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS activities (
  id              CHAR(36)      NOT NULL,
  tenant_id       CHAR(36)      NOT NULL,
  type            ENUM('CALL','EMAIL','MEETING','TASK','NOTE','WHATSAPP','VISIT','DEMO') NOT NULL,
  title           VARCHAR(191)  NOT NULL,
  description     TEXT          NULL,
  status          ENUM('PENDING','COMPLETED','CANCELLED','OVERDUE') NOT NULL DEFAULT 'PENDING',
  scheduled_at    DATETIME(3)   NULL,
  completed_at    DATETIME(3)   NULL,
  duration_minutes INT          NULL,
  outcome         VARCHAR(255)  NULL,
  lead_id         CHAR(36)      NULL,
  contact_id      CHAR(36)      NULL,
  deal_id         CHAR(36)      NULL,
  account_id      CHAR(36)      NULL,
  assigned_to_id  CHAR(36)      NULL,
  custom_fields   JSON          NULL,
  created_at      DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at      DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  deleted_at      DATETIME(3)   NULL,
  PRIMARY KEY (id),
  KEY idx_activities_tenant_sched (tenant_id, scheduled_at),
  KEY idx_activities_contact (tenant_id, contact_id),
  KEY idx_activities_lead (tenant_id, lead_id),
  KEY idx_activities_type (tenant_id, type, status),
  CONSTRAINT fk_activities_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS tickets (
  id              CHAR(36)      NOT NULL,
  tenant_id       CHAR(36)      NOT NULL,
  ticket_no       INT UNSIGNED  NOT NULL,
  subject         VARCHAR(255)  NOT NULL,
  description     TEXT          NOT NULL,
  priority        ENUM('LOW','MEDIUM','HIGH','CRITICAL') NOT NULL DEFAULT 'MEDIUM',
  status          ENUM('OPEN','IN_PROGRESS','PENDING','RESOLVED','CLOSED') NOT NULL DEFAULT 'OPEN',
  sla_due_at      DATETIME(3)   NULL,
  sla_breached    TINYINT(1)    NOT NULL DEFAULT 0,
  contact_id      CHAR(36)      NULL,
  account_id      CHAR(36)      NULL,
  assigned_to_id  CHAR(36)      NULL,
  product_id      CHAR(36)      NULL,      -- FK added after products table
  custom_fields   JSON          NULL,
  resolved_at     DATETIME(3)   NULL,
  closed_at       DATETIME(3)   NULL,
  created_at      DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at      DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  deleted_at      DATETIME(3)   NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_tickets_no (tenant_id, ticket_no),
  KEY idx_tickets_status (tenant_id, status, priority),
  CONSTRAINT fk_tickets_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS ticket_messages (
  id              CHAR(36)      NOT NULL,
  tenant_id       CHAR(36)      NOT NULL,
  ticket_id       CHAR(36)      NOT NULL,
  content         MEDIUMTEXT    NOT NULL,
  is_internal     TINYINT(1)    NOT NULL DEFAULT 0,
  author_user_id  CHAR(36)      NULL,
  author_name     VARCHAR(120)  NOT NULL,
  attachments     JSON          NULL,
  created_at      DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_ticket_messages (tenant_id, ticket_id, created_at),
  CONSTRAINT fk_ticket_messages_ticket FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS notes (
  id              CHAR(36)      NOT NULL,
  tenant_id       CHAR(36)      NOT NULL,
  content         TEXT          NOT NULL,
  is_pinned       TINYINT(1)    NOT NULL DEFAULT 0,
  entity_type     VARCHAR(64)   NOT NULL,
  entity_id       CHAR(36)      NOT NULL,
  created_by_id   CHAR(36)      NOT NULL,
  created_at      DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at      DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  deleted_at      DATETIME(3)   NULL,
  PRIMARY KEY (id),
  KEY idx_notes_entity (tenant_id, entity_type, entity_id),
  CONSTRAINT fk_notes_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS notifications (
  id              CHAR(36)      NOT NULL,
  tenant_id       CHAR(36)      NOT NULL,
  user_id         CHAR(36)      NOT NULL,
  title           VARCHAR(160)  NOT NULL,
  message         VARCHAR(512)  NOT NULL,
  type            VARCHAR(64)   NOT NULL,
  entity_type     VARCHAR(64)   NULL,
  entity_id       CHAR(36)      NULL,
  is_read         TINYINT(1)    NOT NULL DEFAULT 0,
  read_at         DATETIME(3)   NULL,
  created_at      DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_notifications_user (tenant_id, user_id, is_read, created_at),
  CONSTRAINT fk_notifications_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- =============================================================================
-- 4) ERP CORE — Products, Inventory, Purchasing, Sales, Finance
-- =============================================================================

CREATE TABLE IF NOT EXISTS product_categories (
  id              CHAR(36)      NOT NULL,
  tenant_id       CHAR(36)      NOT NULL,
  parent_id       CHAR(36)      NULL,
  name            VARCHAR(120)  NOT NULL,
  code            VARCHAR(64)   NULL,
  created_at      DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at      DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  deleted_at      DATETIME(3)   NULL,
  PRIMARY KEY (id),
  KEY idx_product_categories (tenant_id, name),
  CONSTRAINT fk_product_categories_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS products (
  id              CHAR(36)      NOT NULL,
  tenant_id       CHAR(36)      NOT NULL,
  category_id     CHAR(36)      NULL,
  sku             VARCHAR(64)   NOT NULL,
  name            VARCHAR(191)  NOT NULL,
  description     TEXT          NULL,
  product_type    ENUM('GOODS','SERVICE','BUNDLE') NOT NULL DEFAULT 'GOODS',
  unit            VARCHAR(32)   NOT NULL DEFAULT 'NOS',  -- KG, NOS, SET, MTR
  hsn_sac         VARCHAR(16)   NULL,
  sale_price      DECIMAL(15,2) NOT NULL DEFAULT 0,
  purchase_price  DECIMAL(15,2) NOT NULL DEFAULT 0,
  mrp             DECIMAL(15,2) NULL,
  tax_percent     DECIMAL(5,2)  NOT NULL DEFAULT 18.00,
  track_inventory TINYINT(1)    NOT NULL DEFAULT 1,
  reorder_level   DECIMAL(15,3) NOT NULL DEFAULT 0,
  is_active       TINYINT(1)    NOT NULL DEFAULT 1,
  image_url       VARCHAR(512)  NULL,
  attributes      JSON          NULL,      -- capacity_kg, accuracy, platform_size...
  custom_fields   JSON          NULL,
  created_at      DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at      DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  deleted_at      DATETIME(3)   NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_products_sku (tenant_id, sku),
  KEY idx_products_name (tenant_id, name),
  KEY idx_products_category (tenant_id, category_id),
  CONSTRAINT fk_products_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  CONSTRAINT fk_products_category FOREIGN KEY (category_id) REFERENCES product_categories(id)
) ENGINE=InnoDB;

-- tickets.product_id FK added in OPTIONAL ALTERS section (deferred until products exists)

CREATE TABLE IF NOT EXISTS warehouses (
  id              CHAR(36)      NOT NULL,
  tenant_id       CHAR(36)      NOT NULL,
  code            VARCHAR(32)   NOT NULL,
  name            VARCHAR(120)  NOT NULL,
  address         JSON          NULL,
  is_default      TINYINT(1)    NOT NULL DEFAULT 0,
  is_active       TINYINT(1)    NOT NULL DEFAULT 1,
  created_at      DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at      DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  deleted_at      DATETIME(3)   NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_warehouses (tenant_id, code),
  CONSTRAINT fk_warehouses_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS stock_levels (
  id              CHAR(36)      NOT NULL,
  tenant_id       CHAR(36)      NOT NULL,
  product_id      CHAR(36)      NOT NULL,
  warehouse_id    CHAR(36)      NOT NULL,
  quantity_on_hand DECIMAL(15,3) NOT NULL DEFAULT 0,
  quantity_reserved DECIMAL(15,3) NOT NULL DEFAULT 0,
  quantity_available DECIMAL(15,3) AS (quantity_on_hand - quantity_reserved) STORED,
  updated_at      DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_stock_levels (tenant_id, product_id, warehouse_id),
  CONSTRAINT fk_stock_product FOREIGN KEY (product_id) REFERENCES products(id),
  CONSTRAINT fk_stock_warehouse FOREIGN KEY (warehouse_id) REFERENCES warehouses(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS stock_movements (
  id              CHAR(36)      NOT NULL,
  tenant_id       CHAR(36)      NOT NULL,
  product_id      CHAR(36)      NOT NULL,
  warehouse_id    CHAR(36)      NOT NULL,
  movement_type   ENUM('IN','OUT','ADJUST','TRANSFER','RETURN') NOT NULL,
  quantity        DECIMAL(15,3) NOT NULL,
  reference_type  VARCHAR(64)   NULL,      -- purchase_order, sales_invoice...
  reference_id    CHAR(36)      NULL,
  notes           VARCHAR(255)  NULL,
  performed_by    CHAR(36)      NULL,
  moved_at        DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  created_at      DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_stock_movements (tenant_id, product_id, moved_at),
  CONSTRAINT fk_stock_mov_product FOREIGN KEY (product_id) REFERENCES products(id),
  CONSTRAINT fk_stock_mov_warehouse FOREIGN KEY (warehouse_id) REFERENCES warehouses(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS vendors (
  id              CHAR(36)      NOT NULL,
  tenant_id       CHAR(36)      NOT NULL,
  name            VARCHAR(191)  NOT NULL,
  email           VARCHAR(191)  NULL,
  phone           VARCHAR(32)   NULL,
  gstin           VARCHAR(32)   NULL,
  address         JSON          NULL,
  payment_terms   VARCHAR(64)   NULL,
  custom_fields   JSON          NULL,
  created_at      DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at      DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  deleted_at      DATETIME(3)   NULL,
  PRIMARY KEY (id),
  KEY idx_vendors_tenant (tenant_id, name),
  CONSTRAINT fk_vendors_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS purchase_orders (
  id              CHAR(36)      NOT NULL,
  tenant_id       CHAR(36)      NOT NULL,
  po_number       VARCHAR(40)   NOT NULL,
  vendor_id       CHAR(36)      NOT NULL,
  warehouse_id    CHAR(36)      NULL,
  status          ENUM('DRAFT','SENT','PARTIAL','RECEIVED','CANCELLED') NOT NULL DEFAULT 'DRAFT',
  order_date      DATE          NOT NULL,
  expected_date   DATE          NULL,
  subtotal        DECIMAL(15,2) NOT NULL DEFAULT 0,
  tax_total       DECIMAL(15,2) NOT NULL DEFAULT 0,
  grand_total     DECIMAL(15,2) NOT NULL DEFAULT 0,
  notes           TEXT          NULL,
  created_by_id   CHAR(36)      NULL,
  custom_fields   JSON          NULL,
  created_at      DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at      DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  deleted_at      DATETIME(3)   NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_po_number (tenant_id, po_number),
  KEY idx_po_vendor (tenant_id, vendor_id, status),
  CONSTRAINT fk_po_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  CONSTRAINT fk_po_vendor FOREIGN KEY (vendor_id) REFERENCES vendors(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS purchase_order_lines (
  id              CHAR(36)      NOT NULL,
  tenant_id       CHAR(36)      NOT NULL,
  purchase_order_id CHAR(36)    NOT NULL,
  product_id      CHAR(36)      NOT NULL,
  description     VARCHAR(255)  NULL,
  quantity        DECIMAL(15,3) NOT NULL,
  received_qty    DECIMAL(15,3) NOT NULL DEFAULT 0,
  unit_price      DECIMAL(15,2) NOT NULL,
  tax_percent     DECIMAL(5,2)  NOT NULL DEFAULT 0,
  line_total      DECIMAL(15,2) NOT NULL,
  PRIMARY KEY (id),
  KEY idx_po_lines (tenant_id, purchase_order_id),
  CONSTRAINT fk_po_lines_po FOREIGN KEY (purchase_order_id) REFERENCES purchase_orders(id) ON DELETE CASCADE,
  CONSTRAINT fk_po_lines_product FOREIGN KEY (product_id) REFERENCES products(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS sales_orders (
  id              CHAR(36)      NOT NULL,
  tenant_id       CHAR(36)      NOT NULL,
  so_number       VARCHAR(40)   NOT NULL,
  account_id      CHAR(36)      NULL,
  contact_id      CHAR(36)      NULL,
  deal_id         CHAR(36)      NULL,
  status          ENUM('DRAFT','CONFIRMED','PACKED','SHIPPED','DELIVERED','CANCELLED') NOT NULL DEFAULT 'DRAFT',
  order_date      DATE          NOT NULL,
  delivery_date   DATE          NULL,
  subtotal        DECIMAL(15,2) NOT NULL DEFAULT 0,
  tax_total       DECIMAL(15,2) NOT NULL DEFAULT 0,
  discount_total  DECIMAL(15,2) NOT NULL DEFAULT 0,
  grand_total     DECIMAL(15,2) NOT NULL DEFAULT 0,
  notes           TEXT          NULL,
  custom_fields   JSON          NULL,
  created_by_id   CHAR(36)      NULL,
  created_at      DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at      DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  deleted_at      DATETIME(3)   NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_so_number (tenant_id, so_number),
  KEY idx_so_account (tenant_id, account_id, status),
  CONSTRAINT fk_so_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  CONSTRAINT fk_so_account FOREIGN KEY (account_id) REFERENCES accounts(id),
  CONSTRAINT fk_so_deal FOREIGN KEY (deal_id) REFERENCES deals(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS sales_order_lines (
  id              CHAR(36)      NOT NULL,
  tenant_id       CHAR(36)      NOT NULL,
  sales_order_id  CHAR(36)      NOT NULL,
  product_id      CHAR(36)      NOT NULL,
  description     VARCHAR(255)  NULL,
  quantity        DECIMAL(15,3) NOT NULL,
  unit_price      DECIMAL(15,2) NOT NULL,
  tax_percent     DECIMAL(5,2)  NOT NULL DEFAULT 0,
  discount_percent DECIMAL(5,2) NOT NULL DEFAULT 0,
  line_total      DECIMAL(15,2) NOT NULL,
  PRIMARY KEY (id),
  KEY idx_so_lines (tenant_id, sales_order_id),
  CONSTRAINT fk_so_lines_so FOREIGN KEY (sales_order_id) REFERENCES sales_orders(id) ON DELETE CASCADE,
  CONSTRAINT fk_so_lines_product FOREIGN KEY (product_id) REFERENCES products(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS invoices (
  id              CHAR(36)      NOT NULL,
  tenant_id       CHAR(36)      NOT NULL,
  invoice_number  VARCHAR(40)   NOT NULL,
  sales_order_id  CHAR(36)      NULL,
  account_id      CHAR(36)      NOT NULL,
  contact_id      CHAR(36)      NULL,
  status          ENUM('DRAFT','SENT','PARTIAL','PAID','OVERDUE','VOID') NOT NULL DEFAULT 'DRAFT',
  invoice_date    DATE          NOT NULL,
  due_date        DATE          NULL,
  subtotal        DECIMAL(15,2) NOT NULL DEFAULT 0,
  tax_total       DECIMAL(15,2) NOT NULL DEFAULT 0,
  discount_total  DECIMAL(15,2) NOT NULL DEFAULT 0,
  grand_total     DECIMAL(15,2) NOT NULL DEFAULT 0,
  amount_paid     DECIMAL(15,2) NOT NULL DEFAULT 0,
  balance_due     DECIMAL(15,2) AS (grand_total - amount_paid) STORED,
  currency        CHAR(3)       NOT NULL DEFAULT 'INR',
  notes           TEXT          NULL,
  custom_fields   JSON          NULL,
  created_by_id   CHAR(36)      NULL,
  created_at      DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at      DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  deleted_at      DATETIME(3)   NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_invoice_number (tenant_id, invoice_number),
  KEY idx_invoices_account (tenant_id, account_id, status),
  KEY idx_invoices_due (tenant_id, due_date, status),
  CONSTRAINT fk_invoices_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  CONSTRAINT fk_invoices_account FOREIGN KEY (account_id) REFERENCES accounts(id),
  CONSTRAINT fk_invoices_so FOREIGN KEY (sales_order_id) REFERENCES sales_orders(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS invoice_lines (
  id              CHAR(36)      NOT NULL,
  tenant_id       CHAR(36)      NOT NULL,
  invoice_id      CHAR(36)      NOT NULL,
  product_id      CHAR(36)      NULL,
  description     VARCHAR(255)  NOT NULL,
  quantity        DECIMAL(15,3) NOT NULL,
  unit_price      DECIMAL(15,2) NOT NULL,
  tax_percent     DECIMAL(5,2)  NOT NULL DEFAULT 0,
  line_total      DECIMAL(15,2) NOT NULL,
  PRIMARY KEY (id),
  KEY idx_invoice_lines (tenant_id, invoice_id),
  CONSTRAINT fk_invoice_lines_invoice FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS payments (
  id              CHAR(36)      NOT NULL,
  tenant_id       CHAR(36)      NOT NULL,
  payment_number  VARCHAR(40)   NOT NULL,
  invoice_id      CHAR(36)      NULL,
  account_id      CHAR(36)      NULL,
  vendor_id       CHAR(36)      NULL,
  direction       ENUM('INBOUND','OUTBOUND') NOT NULL,
  method          ENUM('CASH','UPI','NEFT','RTGS','CHEQUE','CARD','OTHER') NOT NULL DEFAULT 'UPI',
  amount          DECIMAL(15,2) NOT NULL,
  currency        CHAR(3)       NOT NULL DEFAULT 'INR',
  paid_at         DATETIME(3)   NOT NULL,
  reference_no    VARCHAR(80)   NULL,
  notes           VARCHAR(255)  NULL,
  created_by_id   CHAR(36)      NULL,
  created_at      DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at      DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  deleted_at      DATETIME(3)   NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_payments_number (tenant_id, payment_number),
  KEY idx_payments_invoice (tenant_id, invoice_id),
  CONSTRAINT fk_payments_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  CONSTRAINT fk_payments_invoice FOREIGN KEY (invoice_id) REFERENCES invoices(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS employees (
  id              CHAR(36)      NOT NULL,
  tenant_id       CHAR(36)      NOT NULL,
  user_id         CHAR(36)      NULL,      -- linked login if any
  employee_code   VARCHAR(40)   NOT NULL,
  name            VARCHAR(120)  NOT NULL,
  email           VARCHAR(191)  NULL,
  phone           VARCHAR(32)   NULL,
  department      VARCHAR(80)   NULL,
  designation     VARCHAR(80)   NULL,
  join_date       DATE          NULL,
  status          ENUM('ACTIVE','ON_LEAVE','RESIGNED') NOT NULL DEFAULT 'ACTIVE',
  salary          DECIMAL(15,2) NULL,
  custom_fields   JSON          NULL,
  created_at      DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at      DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  deleted_at      DATETIME(3)   NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_employees_code (tenant_id, employee_code),
  CONSTRAINT fk_employees_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  CONSTRAINT fk_employees_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB;

-- =============================================================================
-- 5) INTEGRATIONS, AUDIT, FILES, AUTOMATION
-- =============================================================================

CREATE TABLE IF NOT EXISTS integrations (
  id              CHAR(36)      NOT NULL,
  tenant_id       CHAR(36)      NOT NULL,
  provider        VARCHAR(64)   NOT NULL,  -- ASKMEISTER, EXOTEL, GMAIL, TWILIO...
  status          ENUM('DISCONNECTED','CONNECTED','ERROR') NOT NULL DEFAULT 'DISCONNECTED',
  config          JSON          NULL,      -- non-secret settings
  secrets_enc     TEXT          NULL,      -- encrypted API keys
  last_synced_at  DATETIME(3)   NULL,
  created_at      DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at      DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_integrations (tenant_id, provider),
  CONSTRAINT fk_integrations_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS whatsapp_conversations (
  id              CHAR(36)      NOT NULL,
  tenant_id       CHAR(36)      NOT NULL,
  provider        VARCHAR(64)   NOT NULL DEFAULT 'ASKMEISTER',
  external_id     VARCHAR(128)  NULL,
  phone           VARCHAR(32)   NOT NULL,
  phone_normalized VARCHAR(20)  NOT NULL,
  contact_id      CHAR(36)      NULL,
  lead_id         CHAR(36)      NULL,
  contact_name    VARCHAR(120)  NULL,
  last_message    VARCHAR(512)  NULL,
  unread_count    INT           NOT NULL DEFAULT 0,
  meta            JSON          NULL,
  updated_at      DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  created_at      DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_wa_conv_phone (tenant_id, phone_normalized),
  CONSTRAINT fk_wa_conv_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS whatsapp_messages (
  id              CHAR(36)      NOT NULL,
  tenant_id       CHAR(36)      NOT NULL,
  conversation_id CHAR(36)      NOT NULL,
  direction       ENUM('INBOUND','OUTBOUND') NOT NULL,
  body            TEXT          NOT NULL,
  status          ENUM('QUEUED','SENT','DELIVERED','READ','FAILED') NOT NULL DEFAULT 'SENT',
  external_id     VARCHAR(128)  NULL,
  sent_by_user_id CHAR(36)      NULL,
  created_at      DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_wa_msg (tenant_id, conversation_id, created_at),
  CONSTRAINT fk_wa_msg_conv FOREIGN KEY (conversation_id) REFERENCES whatsapp_conversations(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS automation_rules (
  id              CHAR(36)      NOT NULL,
  tenant_id       CHAR(36)      NOT NULL,
  name            VARCHAR(160)  NOT NULL,
  is_active       TINYINT(1)    NOT NULL DEFAULT 1,
  trigger_module  VARCHAR(64)   NOT NULL,
  trigger_field   VARCHAR(64)   NOT NULL,
  trigger_op      VARCHAR(32)   NOT NULL,
  trigger_value   VARCHAR(255)  NOT NULL,
  action_type     VARCHAR(64)   NOT NULL,
  action_config   JSON          NOT NULL,
  run_count       INT           NOT NULL DEFAULT 0,
  created_at      DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at      DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_automation (tenant_id, is_active),
  CONSTRAINT fk_automation_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS files (
  id              CHAR(36)      NOT NULL,
  tenant_id       CHAR(36)      NOT NULL,
  entity_type     VARCHAR(64)   NULL,
  entity_id       CHAR(36)      NULL,
  file_name       VARCHAR(255)  NOT NULL,
  mime_type       VARCHAR(120)  NOT NULL,
  size_bytes      BIGINT        NOT NULL,
  storage_path    VARCHAR(512)  NOT NULL,
  uploaded_by     CHAR(36)      NULL,
  created_at      DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  deleted_at      DATETIME(3)   NULL,
  PRIMARY KEY (id),
  KEY idx_files_entity (tenant_id, entity_type, entity_id),
  CONSTRAINT fk_files_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS audit_logs (
  id              CHAR(36)      NOT NULL,
  tenant_id       CHAR(36)      NULL,      -- NULL for platform-level actions
  actor_type      ENUM('PLATFORM_ADMIN','USER','SYSTEM') NOT NULL,
  actor_id        CHAR(36)      NULL,
  action          VARCHAR(64)   NOT NULL,  -- CREATE, UPDATE, DELETE, LOGIN, EXPORT...
  entity_type     VARCHAR(64)   NULL,
  entity_id       CHAR(36)      NULL,
  ip_address      VARCHAR(64)   NULL,
  user_agent      VARCHAR(255)  NULL,
  before_json     JSON          NULL,
  after_json      JSON          NULL,
  created_at      DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_audit_tenant_time (tenant_id, created_at),
  KEY idx_audit_entity (tenant_id, entity_type, entity_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS number_sequences (
  tenant_id       CHAR(36)      NOT NULL,
  sequence_key    VARCHAR(40)   NOT NULL,  -- INVOICE, SO, PO, TICKET
  prefix          VARCHAR(20)   NOT NULL DEFAULT '',
  next_value      INT UNSIGNED  NOT NULL DEFAULT 1,
  padding         TINYINT UNSIGNED NOT NULL DEFAULT 5,
  updated_at      DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (tenant_id, sequence_key),
  CONSTRAINT fk_number_sequences_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
) ENGINE=InnoDB;

SET FOREIGN_KEY_CHECKS = 1;

-- =============================================================================
-- 6) SEED: Platform admin + business categories + tips
-- Password for admin@novacrm.com = Admin@Nova2026
-- bcrypt hash generated for that password (cost 10)
-- =============================================================================

INSERT IGNORE INTO platform_admins (id, name, email, password_hash, role, status) VALUES
('padm-0001-0000-0000-000000000001', 'Nova Super Admin', 'admin@novacrm.com',
 '$2b$10$8K1p/a0dL1LXMIgoEDFrwOfMQqJqJqJqJqJqJqJqJqJqJqJqJqJqJu', -- REPLACE on first deploy via app seed
 'SUPER_ADMIN', 'ACTIVE');

-- NOTE: The placeholder hash above must be replaced by running backend seed.
-- Workbench users can still create tenants after backend seed updates the hash.

INSERT IGNORE INTO business_categories
(id, code, name, description, icon, color_hex, default_modules, terminology, template_config, sort_order)
VALUES
('bcat-weigh-0000-0000-000000000001', 'WEIGHING_MACHINES', 'Weighing Machines & Scales',
 'Dealers / manufacturers of industrial, retail, jewellery & truck scales',
 'scale', '#0EA5E9',
 JSON_OBJECT(
   'crm.leads', true, 'crm.contacts', true, 'crm.accounts', true, 'crm.deals', true,
   'crm.activities', true, 'crm.tickets', true, 'erp.products', true, 'erp.inventory', true,
   'erp.sales_orders', true, 'erp.purchase_orders', true, 'erp.invoices', true,
   'erp.payments', true, 'engagement.whatsapp', true, 'engagement.emails', true
 ),
 JSON_OBJECT('lead','Enquiry','deal','Quotation','account','Dealer','product','Machine','contact','Buyer'),
 JSON_OBJECT(
   'pipeline', JSON_ARRAY('Enquiry','Site Survey','Quotation','Negotiation','Won','Lost'),
   'lead_sources', JSON_ARRAY('Website','Dealer Referral','Exhibition','Cold Call','IndiaMART','JustDial'),
   'custom_fields', JSON_OBJECT(
     'lead', JSON_ARRAY(
       JSON_OBJECT('key','machine_type','label','Machine Type','type','SELECT','options', JSON_ARRAY('Platform','Table Top','Jewellery','Truck','Crane')),
       JSON_OBJECT('key','capacity_kg','label','Capacity (kg)','type','NUMBER'),
       JSON_OBJECT('key','accuracy','label','Accuracy','type','TEXT'),
       JSON_OBJECT('key','installation_required','label','Installation Required','type','BOOLEAN')
     ),
     'product', JSON_ARRAY(
       JSON_OBJECT('key','capacity_kg','label','Capacity (kg)','type','NUMBER'),
       JSON_OBJECT('key','platform_size','label','Platform Size','type','TEXT'),
       JSON_OBJECT('key','calibration_due_days','label','Calibration Cycle (days)','type','NUMBER')
     )
   )
 ), 1),

('bcat-retail-0000-0000-000000000002', 'RETAIL_COMMERCE', 'Retail & Commerce',
 'Shops, distributors and multi-brand retail businesses',
 'shopping-bag', '#10B981',
 JSON_OBJECT(
   'crm.leads', true, 'crm.contacts', true, 'crm.accounts', true, 'crm.deals', true,
   'erp.products', true, 'erp.inventory', true, 'erp.sales_orders', true, 'erp.invoices', true, 'erp.payments', true
 ),
 JSON_OBJECT('lead','Lead','deal','Opportunity','account','Customer','product','SKU'),
 JSON_OBJECT('pipeline', JSON_ARRAY('Prospect','Qualified','Proposal','Negotiation','Won','Lost'),
             'lead_sources', JSON_ARRAY('Walk-in','Website','Social','Campaign','Referral')),
 2),

('bcat-mfg-0000-0000-000000000003', 'MANUFACTURING', 'Manufacturing',
 'Make-to-stock / make-to-order manufacturers',
 'factory', '#F59E0B',
 JSON_OBJECT(
   'crm.leads', true, 'crm.accounts', true, 'crm.deals', true,
   'erp.products', true, 'erp.inventory', true, 'erp.purchase_orders', true,
   'erp.sales_orders', true, 'erp.invoices', true, 'erp.employees', true
 ),
 JSON_OBJECT('deal','Sales Order Pipeline','account','Buyer','product','Finished Good'),
 JSON_OBJECT('pipeline', JSON_ARRAY('RFQ','Sample','PO Received','Production','Dispatched','Closed'),
             'lead_sources', JSON_ARRAY('Trade Show','Partner','Website','Export Inquiry')),
 3),

('bcat-svc-0000-0000-000000000004', 'SERVICES', 'Professional Services',
 'Agencies, consultancies, AMC and service businesses',
 'briefcase', '#8B5CF6',
 JSON_OBJECT(
   'crm.leads', true, 'crm.contacts', true, 'crm.accounts', true, 'crm.deals', true,
   'crm.activities', true, 'crm.tickets', true, 'erp.invoices', true, 'erp.payments', true, 'erp.employees', true
 ),
 JSON_OBJECT('deal','Engagement','account','Client','ticket','Service Request'),
 JSON_OBJECT('pipeline', JSON_ARRAY('Discovery','Proposal','Negotiation','Active','Retainer','Lost'),
             'lead_sources', JSON_ARRAY('Referral','LinkedIn','Website','Partner')),
 4),

('bcat-re-0000-0000-000000000005', 'REAL_ESTATE', 'Real Estate',
 'Brokers, builders and property consultants',
 'building', '#EF4444',
 JSON_OBJECT(
   'crm.leads', true, 'crm.contacts', true, 'crm.deals', true, 'crm.activities', true, 'engagement.whatsapp', true
 ),
 JSON_OBJECT('lead','Buyer Lead','deal','Property Deal','account','Project'),
 JSON_OBJECT('pipeline', JSON_ARRAY('Inquiry','Site Visit','Negotiation','Token','Registration','Lost'),
             'lead_sources', JSON_ARRAY('99acres','MagicBricks','Walk-in','Channel Partner','Facebook')),
 5),

('bcat-auto-0000-0000-000000000006', 'AUTOMOTIVE', 'Automotive / Auto Parts',
 'Dealerships, spare parts and service workshops',
 'car', '#2563EB',
 JSON_OBJECT(
   'crm.leads', true, 'crm.contacts', true, 'crm.deals', true, 'crm.tickets', true,
   'erp.products', true, 'erp.inventory', true, 'erp.invoices', true
 ),
 JSON_OBJECT('lead','Walk-in Lead','deal','Vehicle Deal','ticket','Job Card','product','Part'),
 JSON_OBJECT('pipeline', JSON_ARRAY('Inquiry','Test Drive','Quotation','Booking','Delivered','Lost'),
             'lead_sources', JSON_ARRAY('Showroom','Website','OLX','Referral','Campaign')),
 6),

('bcat-health-0000-0000-000000000007', 'HEALTHCARE', 'Healthcare & Clinics',
 'Clinics, diagnostic centers and medical device sellers',
 'heart-pulse', '#E11D48',
 JSON_OBJECT(
   'crm.contacts', true, 'crm.accounts', true, 'crm.activities', true, 'crm.tickets', true,
   'erp.products', true, 'erp.inventory', true, 'erp.invoices', true
 ),
 JSON_OBJECT('contact','Patient / Buyer','account','Hospital','ticket','Case'),
 JSON_OBJECT('pipeline', JSON_ARRAY('Inquiry','Consultation','Quote','Order','Completed','Lost'),
             'lead_sources', JSON_ARRAY('Referral Doctor','Website','Camp','Walk-in')),
 7),

('bcat-edu-0000-0000-000000000008', 'EDUCATION', 'Education & Training',
 'Schools, coaching institutes and edtech sellers',
 'graduation-cap', '#7C3AED',
 JSON_OBJECT(
   'crm.leads', true, 'crm.contacts', true, 'crm.deals', true, 'crm.activities', true, 'erp.invoices', true
 ),
 JSON_OBJECT('lead','Admission Lead','deal','Enrollment','contact','Student / Parent'),
 JSON_OBJECT('pipeline', JSON_ARRAY('Inquiry','Counseling','Application','Fee Paid','Enrolled','Lost'),
             'lead_sources', JSON_ARRAY('Website','Seminar','Referral','Ads')),
 8);

INSERT IGNORE INTO feature_tips (id, tenant_id, module_key, section_key, title, body, tip_type, sort_order) VALUES
('tip-leads-list-000000000000001', NULL, 'crm.leads', 'list',
 'How to use Leads',
 'Capture every enquiry here first. Use filters by source/status, open the drawer for timeline, then Convert when the buyer is real — this creates Contact + Account + Deal in one step.',
 'TIP', 1),
('tip-leads-convert-0000000000002', NULL, 'crm.leads', 'convert',
 'Convert wisely',
 'Only convert qualified leads. Fill business-specific fields (e.g. machine capacity) before converting so the deal and product recommendation stay accurate.',
 'BEST_PRACTICE', 2),
('tip-deals-kanban-0000000000003', NULL, 'crm.deals', 'kanban',
 'Pipeline Kanban',
 'Drag cards between stages. Probability and forecasts update automatically. Mark Lost with a reason so reports show where deals drop off.',
 'TIP', 1),
('tip-contacts-phone-000000000004', NULL, 'crm.contacts', 'lookup',
 'Phone lookup',
 'Paste a phone number in the lookup bar during an inbound call. NovaCRM normalizes +91 formats and opens the contact 360° view instantly.',
 'TIP', 1),
('tip-inventory-000000000000005', NULL, 'erp.inventory', 'list',
 'Stock discipline',
 'Every sales invoice / purchase receipt should create a stock movement. Never adjust quantity without a reason note — auditors rely on the movement ledger.',
 'WARNING', 1),
('tip-invoices-000000000000006', NULL, 'erp.invoices', 'create',
 'Invoicing tip',
 'Generate invoices from confirmed Sales Orders to keep CRM deals, ERP stock and payments in sync. Partial payments update balance_due automatically.',
 'TIP', 1),
('tip-whatsapp-000000000000007', NULL, 'engagement.whatsapp', 'connect',
 'AskMeister WhatsApp',
 'Connect your AskMeister workspace API key. Chats auto-link to Contacts by phone and every outbound reply is logged as a WhatsApp activity.',
 'TIP', 1),
('tip-admin-client-0000000000008', NULL, 'platform.tenants', 'create',
 'Creating a client',
 'Pick the Business Category first (e.g. Weighing Machines). NovaCRM applies modules, terminology, pipeline stages and custom fields automatically — then tweak per client if needed.',
 'BEST_PRACTICE', 1),
('tip-custom-fields-000000000009', NULL, 'settings.custom_fields', 'list',
 'Custom fields',
 'Add only fields your industry truly needs. Too many fields slow adoption. Mark critical ones Required so agents cannot skip buyer details.',
 'NOTE', 1),
('tip-dashboard-000000000000010', NULL, 'crm.dashboard', 'home',
 'Reading the dashboard',
 'Use All Users + date range filters. KPI cards, funnel and gauge reflect live CRM+ERP data for your tenant only — never other clients.',
 'TIP', 1);


-- =============================================================================
-- === OPTIONAL ALTERS / UPDATES ===
-- Safe to re-run. Adds deferred FK and documents schema version.
-- =============================================================================

-- tickets → products FK (products table must exist first)
SET @fk_tickets_product = (
  SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA = DATABASE()
    AND TABLE_NAME = 'tickets'
    AND CONSTRAINT_NAME = 'fk_tickets_product'
);
SET @sql_tickets_product = IF(
  @fk_tickets_product = 0,
  'ALTER TABLE tickets ADD CONSTRAINT fk_tickets_product FOREIGN KEY (product_id) REFERENCES products(id)',
  'SELECT 1'
);
PREPARE stmt_tickets_product FROM @sql_tickets_product;
EXECUTE stmt_tickets_product;
DEALLOCATE PREPARE stmt_tickets_product;

-- Schema marker (informational — no DDL)
-- NovaCRM Aiven MySQL schema v1.0 — matches novacrm_mysql_schema.sql + Prisma models
-- Tables: platform, tenants, CRM, ERP, engagement, audit, number_sequences,
--         teams, files, tenant_subscriptions, deal_stage_history

-- =============================================================================
-- DONE
-- Next: configure backend DATABASE_URL for Aiven MySQL, run:
--   npm run prisma:generate
--   npm run prisma:seed
-- See database/AIVEN_MYSQL_SETUP.md for full steps.
-- =============================================================================
