npm warn Unknown env config "devdir". This will stop working in the next major version of npm.
-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "PlatformAdminRole" AS ENUM ('SUPER_ADMIN', 'SUPPORT', 'BILLING');

-- CreateEnum
CREATE TYPE "PlatformAdminStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "TenantStatus" AS ENUM ('TRIAL', 'ACTIVE', 'SUSPENDED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TenantPlan" AS ENUM ('STARTER', 'GROWTH', 'BUSINESS', 'ENTERPRISE');

-- CreateEnum
CREATE TYPE "IsolationLevel" AS ENUM ('SHARED', 'DEDICATED_SCHEMA');

-- CreateEnum
CREATE TYPE "ModuleGroup" AS ENUM ('CRM', 'ERP', 'ENGAGEMENT', 'SETTINGS', 'REPORTS');

-- CreateEnum
CREATE TYPE "CustomFieldType" AS ENUM ('TEXT', 'NUMBER', 'DECIMAL', 'DATE', 'DATETIME', 'BOOLEAN', 'SELECT', 'MULTI_SELECT', 'PHONE', 'EMAIL', 'URL', 'TEXTAREA', 'CURRENCY');

-- CreateEnum
CREATE TYPE "TipType" AS ENUM ('TIP', 'NOTE', 'WARNING', 'BEST_PRACTICE');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'INVITED', 'LOCKED');

-- CreateEnum
CREATE TYPE "LeadStatus" AS ENUM ('NEW', 'CONTACTED', 'QUALIFIED', 'UNQUALIFIED', 'LOST', 'CONVERTED');

-- CreateEnum
CREATE TYPE "DealPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateEnum
CREATE TYPE "ActivityType" AS ENUM ('CALL', 'EMAIL', 'MEETING', 'TASK', 'NOTE', 'WHATSAPP', 'VISIT', 'DEMO');

-- CreateEnum
CREATE TYPE "ActivityStatus" AS ENUM ('PENDING', 'COMPLETED', 'CANCELLED', 'OVERDUE');

-- CreateEnum
CREATE TYPE "TicketPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "TicketStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'PENDING', 'RESOLVED', 'CLOSED');

-- CreateEnum
CREATE TYPE "ProductType" AS ENUM ('GOODS', 'SERVICE', 'BUNDLE');

-- CreateEnum
CREATE TYPE "StockMovementType" AS ENUM ('IN', 'OUT', 'ADJUST', 'TRANSFER', 'RETURN');

-- CreateEnum
CREATE TYPE "PurchaseOrderStatus" AS ENUM ('DRAFT', 'SENT', 'PARTIAL', 'RECEIVED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SalesOrderStatus" AS ENUM ('DRAFT', 'CONFIRMED', 'PACKED', 'SHIPPED', 'DELIVERED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('DRAFT', 'SENT', 'PARTIAL', 'PAID', 'OVERDUE', 'VOID');

-- CreateEnum
CREATE TYPE "PaymentDirection" AS ENUM ('INBOUND', 'OUTBOUND');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'UPI', 'NEFT', 'RTGS', 'CHEQUE', 'CARD', 'OTHER');

-- CreateEnum
CREATE TYPE "EmployeeStatus" AS ENUM ('ACTIVE', 'ON_LEAVE', 'RESIGNED');

-- CreateEnum
CREATE TYPE "IntegrationStatus" AS ENUM ('DISCONNECTED', 'CONNECTED', 'ERROR');

-- CreateEnum
CREATE TYPE "MessageDirection" AS ENUM ('INBOUND', 'OUTBOUND');

-- CreateEnum
CREATE TYPE "WhatsappMessageStatus" AS ENUM ('QUEUED', 'SENT', 'DELIVERED', 'READ', 'FAILED');

-- CreateEnum
CREATE TYPE "AuditActorType" AS ENUM ('PLATFORM_ADMIN', 'USER', 'SYSTEM');

-- CreateTable
CREATE TABLE "platform_admins" (
    "id" CHAR(36) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "email" VARCHAR(191) NOT NULL,
    "password_hash" VARCHAR(255) NOT NULL,
    "phone" VARCHAR(32),
    "role" "PlatformAdminRole" NOT NULL DEFAULT 'SUPER_ADMIN',
    "status" "PlatformAdminStatus" NOT NULL DEFAULT 'ACTIVE',
    "last_login_at" TIMESTAMPTZ(3),
    "mfa_secret" VARCHAR(64),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "platform_admins_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "business_categories" (
    "id" CHAR(36) NOT NULL,
    "code" VARCHAR(64) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "description" TEXT,
    "icon" VARCHAR(64) NOT NULL DEFAULT 'scale',
    "color_hex" CHAR(7) NOT NULL DEFAULT '#2563EB',
    "default_currency" CHAR(3) NOT NULL DEFAULT 'INR',
    "default_timezone" VARCHAR(64) NOT NULL DEFAULT 'Asia/Kolkata',
    "default_modules" JSONB NOT NULL,
    "terminology" JSONB NOT NULL,
    "template_config" JSONB NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "business_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenants" (
    "id" CHAR(36) NOT NULL,
    "code" VARCHAR(32) NOT NULL,
    "name" VARCHAR(191) NOT NULL,
    "slug" VARCHAR(64) NOT NULL,
    "business_category_id" CHAR(36) NOT NULL,
    "status" "TenantStatus" NOT NULL DEFAULT 'TRIAL',
    "plan" "TenantPlan" NOT NULL DEFAULT 'STARTER',
    "isolation_level" "IsolationLevel" NOT NULL DEFAULT 'SHARED',
    "logo_url" VARCHAR(512),
    "website" VARCHAR(255),
    "email" VARCHAR(191),
    "phone" VARCHAR(32),
    "gstin" VARCHAR(32),
    "pan" VARCHAR(16),
    "address_line1" VARCHAR(255),
    "address_line2" VARCHAR(255),
    "city" VARCHAR(100),
    "state" VARCHAR(100),
    "postal_code" VARCHAR(20),
    "country" CHAR(2) NOT NULL DEFAULT 'IN',
    "currency" CHAR(3) NOT NULL DEFAULT 'INR',
    "timezone" VARCHAR(64) NOT NULL DEFAULT 'Asia/Kolkata',
    "fiscal_year_start_month" SMALLINT NOT NULL DEFAULT 4,
    "max_users" INTEGER NOT NULL DEFAULT 10,
    "max_storage_mb" INTEGER NOT NULL DEFAULT 5120,
    "trial_ends_at" TIMESTAMPTZ(3),
    "activated_at" TIMESTAMPTZ(3),
    "suspended_at" TIMESTAMPTZ(3),
    "modules_enabled" JSONB NOT NULL,
    "terminology" JSONB,
    "branding" JSONB,
    "settings" JSONB,
    "created_by_admin_id" CHAR(36),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_modules" (
    "id" CHAR(36) NOT NULL,
    "tenant_id" CHAR(36) NOT NULL,
    "module_key" VARCHAR(64) NOT NULL,
    "module_group" "ModuleGroup" NOT NULL,
    "label" VARCHAR(120) NOT NULL,
    "is_enabled" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "config" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "tenant_modules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "custom_field_definitions" (
    "id" CHAR(36) NOT NULL,
    "tenant_id" CHAR(36) NOT NULL,
    "entity_type" VARCHAR(64) NOT NULL,
    "field_key" VARCHAR(64) NOT NULL,
    "label" VARCHAR(120) NOT NULL,
    "field_type" "CustomFieldType" NOT NULL,
    "options_json" JSONB,
    "is_required" BOOLEAN NOT NULL DEFAULT false,
    "is_unique" BOOLEAN NOT NULL DEFAULT false,
    "is_searchable" BOOLEAN NOT NULL DEFAULT true,
    "is_visible" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "help_text" VARCHAR(255),
    "validation" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "custom_field_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "feature_tips" (
    "id" CHAR(36) NOT NULL,
    "tenant_id" CHAR(36),
    "module_key" VARCHAR(64) NOT NULL,
    "section_key" VARCHAR(64) NOT NULL,
    "title" VARCHAR(160) NOT NULL,
    "body" TEXT NOT NULL,
    "tip_type" "TipType" NOT NULL DEFAULT 'TIP',
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "feature_tips_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" CHAR(36) NOT NULL,
    "tenant_id" CHAR(36) NOT NULL,
    "code" VARCHAR(64) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "description" VARCHAR(255),
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "permissions" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" CHAR(36) NOT NULL,
    "tenant_id" CHAR(36) NOT NULL,
    "role_id" CHAR(36) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "email" VARCHAR(191) NOT NULL,
    "password_hash" VARCHAR(255) NOT NULL,
    "phone" VARCHAR(32),
    "avatar_url" VARCHAR(512),
    "status" "UserStatus" NOT NULL DEFAULT 'INVITED',
    "timezone" VARCHAR(64) NOT NULL DEFAULT 'Asia/Kolkata',
    "locale" VARCHAR(16) NOT NULL DEFAULT 'en-IN',
    "last_login_at" TIMESTAMPTZ(3),
    "invited_at" TIMESTAMPTZ(3),
    "invited_by" CHAR(36),
    "preferences" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" CHAR(36) NOT NULL,
    "user_id" CHAR(36),
    "platform_admin_id" CHAR(36),
    "token_hash" VARCHAR(128) NOT NULL,
    "user_agent" VARCHAR(255),
    "ip_address" VARCHAR(64),
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "revoked_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pipeline_stages" (
    "id" CHAR(36) NOT NULL,
    "tenant_id" CHAR(36) NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "code" VARCHAR(40) NOT NULL,
    "color_hex" CHAR(7) NOT NULL DEFAULT '#2563EB',
    "probability" SMALLINT NOT NULL DEFAULT 20,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_won" BOOLEAN NOT NULL DEFAULT false,
    "is_lost" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "pipeline_stages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_sources" (
    "id" CHAR(36) NOT NULL,
    "tenant_id" CHAR(36) NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "code" VARCHAR(40) NOT NULL,
    "color_hex" CHAR(7) NOT NULL DEFAULT '#64748B',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "lead_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounts" (
    "id" CHAR(36) NOT NULL,
    "tenant_id" CHAR(36) NOT NULL,
    "name" VARCHAR(191) NOT NULL,
    "account_type" VARCHAR(64),
    "industry" VARCHAR(100),
    "website" VARCHAR(255),
    "phone" VARCHAR(32),
    "email" VARCHAR(191),
    "gstin" VARCHAR(32),
    "pan" VARCHAR(16),
    "billing_address" JSONB,
    "shipping_address" JSONB,
    "city" VARCHAR(100),
    "state" VARCHAR(100),
    "country" CHAR(2) NOT NULL DEFAULT 'IN',
    "owner_user_id" CHAR(36),
    "annual_revenue" DECIMAL(15,2),
    "employee_count" INTEGER,
    "description" TEXT,
    "tags" JSONB,
    "custom_fields" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contacts" (
    "id" CHAR(36) NOT NULL,
    "tenant_id" CHAR(36) NOT NULL,
    "account_id" CHAR(36),
    "name" VARCHAR(120) NOT NULL,
    "email" VARCHAR(191),
    "phone" VARCHAR(32),
    "mobile" VARCHAR(32),
    "phone_normalized" VARCHAR(20),
    "title" VARCHAR(120),
    "department" VARCHAR(120),
    "city" VARCHAR(100),
    "state" VARCHAR(100),
    "country" CHAR(2) NOT NULL DEFAULT 'IN',
    "owner_user_id" CHAR(36),
    "tags" JSONB,
    "description" TEXT,
    "custom_fields" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leads" (
    "id" CHAR(36) NOT NULL,
    "tenant_id" CHAR(36) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "email" VARCHAR(191),
    "phone" VARCHAR(32),
    "phone_normalized" VARCHAR(20),
    "company" VARCHAR(191),
    "website" VARCHAR(255),
    "city" VARCHAR(100),
    "state" VARCHAR(100),
    "country" CHAR(2) NOT NULL DEFAULT 'IN',
    "source_id" CHAR(36),
    "status" "LeadStatus" NOT NULL DEFAULT 'NEW',
    "score" SMALLINT NOT NULL DEFAULT 0,
    "assigned_to_id" CHAR(36),
    "created_by_id" CHAR(36) NOT NULL,
    "converted_contact_id" CHAR(36),
    "converted_account_id" CHAR(36),
    "converted_deal_id" CHAR(36),
    "converted_at" TIMESTAMPTZ(3),
    "description" TEXT,
    "tags" JSONB,
    "custom_fields" JSONB,
    "last_activity_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "leads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deals" (
    "id" CHAR(36) NOT NULL,
    "tenant_id" CHAR(36) NOT NULL,
    "name" VARCHAR(191) NOT NULL,
    "amount" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "currency" CHAR(3) NOT NULL DEFAULT 'INR',
    "stage_id" CHAR(36) NOT NULL,
    "priority" "DealPriority" NOT NULL DEFAULT 'MEDIUM',
    "probability" SMALLINT NOT NULL DEFAULT 20,
    "expected_close_date" DATE,
    "closed_at" TIMESTAMPTZ(3),
    "lost_reason" VARCHAR(255),
    "contact_id" CHAR(36),
    "account_id" CHAR(36),
    "owner_user_id" CHAR(36),
    "description" TEXT,
    "custom_fields" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "deals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activities" (
    "id" CHAR(36) NOT NULL,
    "tenant_id" CHAR(36) NOT NULL,
    "type" "ActivityType" NOT NULL,
    "title" VARCHAR(191) NOT NULL,
    "description" TEXT,
    "status" "ActivityStatus" NOT NULL DEFAULT 'PENDING',
    "scheduled_at" TIMESTAMPTZ(3),
    "completed_at" TIMESTAMPTZ(3),
    "duration_minutes" INTEGER,
    "outcome" VARCHAR(255),
    "lead_id" CHAR(36),
    "contact_id" CHAR(36),
    "deal_id" CHAR(36),
    "account_id" CHAR(36),
    "assigned_to_id" CHAR(36),
    "custom_fields" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "activities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tickets" (
    "id" CHAR(36) NOT NULL,
    "tenant_id" CHAR(36) NOT NULL,
    "ticket_no" INTEGER NOT NULL,
    "subject" VARCHAR(255) NOT NULL,
    "description" TEXT NOT NULL,
    "priority" "TicketPriority" NOT NULL DEFAULT 'MEDIUM',
    "status" "TicketStatus" NOT NULL DEFAULT 'OPEN',
    "sla_due_at" TIMESTAMPTZ(3),
    "sla_breached" BOOLEAN NOT NULL DEFAULT false,
    "contact_id" CHAR(36),
    "account_id" CHAR(36),
    "assigned_to_id" CHAR(36),
    "product_id" CHAR(36),
    "custom_fields" JSONB,
    "resolved_at" TIMESTAMPTZ(3),
    "closed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "tickets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticket_messages" (
    "id" CHAR(36) NOT NULL,
    "tenant_id" CHAR(36) NOT NULL,
    "ticket_id" CHAR(36) NOT NULL,
    "content" TEXT NOT NULL,
    "is_internal" BOOLEAN NOT NULL DEFAULT false,
    "author_user_id" CHAR(36),
    "author_name" VARCHAR(120) NOT NULL,
    "attachments" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ticket_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notes" (
    "id" CHAR(36) NOT NULL,
    "tenant_id" CHAR(36) NOT NULL,
    "content" TEXT NOT NULL,
    "is_pinned" BOOLEAN NOT NULL DEFAULT false,
    "entity_type" VARCHAR(64) NOT NULL,
    "entity_id" CHAR(36) NOT NULL,
    "created_by_id" CHAR(36) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" CHAR(36) NOT NULL,
    "tenant_id" CHAR(36) NOT NULL,
    "user_id" CHAR(36) NOT NULL,
    "title" VARCHAR(160) NOT NULL,
    "message" VARCHAR(512) NOT NULL,
    "type" VARCHAR(64) NOT NULL,
    "entity_type" VARCHAR(64),
    "entity_id" CHAR(36),
    "is_read" BOOLEAN NOT NULL DEFAULT false,
    "read_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_categories" (
    "id" CHAR(36) NOT NULL,
    "tenant_id" CHAR(36) NOT NULL,
    "parent_id" CHAR(36),
    "name" VARCHAR(120) NOT NULL,
    "code" VARCHAR(64),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "product_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" CHAR(36) NOT NULL,
    "tenant_id" CHAR(36) NOT NULL,
    "category_id" CHAR(36),
    "sku" VARCHAR(64) NOT NULL,
    "name" VARCHAR(191) NOT NULL,
    "description" TEXT,
    "product_type" "ProductType" NOT NULL DEFAULT 'GOODS',
    "unit" VARCHAR(32) NOT NULL DEFAULT 'NOS',
    "hsn_sac" VARCHAR(16),
    "sale_price" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "purchase_price" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "mrp" DECIMAL(15,2),
    "tax_percent" DECIMAL(5,2) NOT NULL DEFAULT 18,
    "track_inventory" BOOLEAN NOT NULL DEFAULT true,
    "reorder_level" DECIMAL(15,3) NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "image_url" VARCHAR(512),
    "attributes" JSONB,
    "custom_fields" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "warehouses" (
    "id" CHAR(36) NOT NULL,
    "tenant_id" CHAR(36) NOT NULL,
    "code" VARCHAR(32) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "address" JSONB,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "warehouses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_levels" (
    "id" CHAR(36) NOT NULL,
    "tenant_id" CHAR(36) NOT NULL,
    "product_id" CHAR(36) NOT NULL,
    "warehouse_id" CHAR(36) NOT NULL,
    "quantity_on_hand" DECIMAL(15,3) NOT NULL DEFAULT 0,
    "quantity_reserved" DECIMAL(15,3) NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "stock_levels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_movements" (
    "id" CHAR(36) NOT NULL,
    "tenant_id" CHAR(36) NOT NULL,
    "product_id" CHAR(36) NOT NULL,
    "warehouse_id" CHAR(36) NOT NULL,
    "movement_type" "StockMovementType" NOT NULL,
    "quantity" DECIMAL(15,3) NOT NULL,
    "reference_type" VARCHAR(64),
    "reference_id" CHAR(36),
    "notes" VARCHAR(255),
    "performed_by" CHAR(36),
    "moved_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendors" (
    "id" CHAR(36) NOT NULL,
    "tenant_id" CHAR(36) NOT NULL,
    "name" VARCHAR(191) NOT NULL,
    "email" VARCHAR(191),
    "phone" VARCHAR(32),
    "gstin" VARCHAR(32),
    "address" JSONB,
    "payment_terms" VARCHAR(64),
    "custom_fields" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "vendors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_orders" (
    "id" CHAR(36) NOT NULL,
    "tenant_id" CHAR(36) NOT NULL,
    "po_number" VARCHAR(40) NOT NULL,
    "vendor_id" CHAR(36) NOT NULL,
    "warehouse_id" CHAR(36),
    "status" "PurchaseOrderStatus" NOT NULL DEFAULT 'DRAFT',
    "order_date" DATE NOT NULL,
    "expected_date" DATE,
    "subtotal" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "tax_total" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "grand_total" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "notes" TEXT,
    "created_by_id" CHAR(36),
    "custom_fields" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "purchase_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_order_lines" (
    "id" CHAR(36) NOT NULL,
    "tenant_id" CHAR(36) NOT NULL,
    "purchase_order_id" CHAR(36) NOT NULL,
    "product_id" CHAR(36) NOT NULL,
    "description" VARCHAR(255),
    "quantity" DECIMAL(15,3) NOT NULL,
    "received_qty" DECIMAL(15,3) NOT NULL DEFAULT 0,
    "unit_price" DECIMAL(15,2) NOT NULL,
    "tax_percent" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "line_total" DECIMAL(15,2) NOT NULL,

    CONSTRAINT "purchase_order_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_orders" (
    "id" CHAR(36) NOT NULL,
    "tenant_id" CHAR(36) NOT NULL,
    "so_number" VARCHAR(40) NOT NULL,
    "account_id" CHAR(36),
    "contact_id" CHAR(36),
    "deal_id" CHAR(36),
    "status" "SalesOrderStatus" NOT NULL DEFAULT 'DRAFT',
    "order_date" DATE NOT NULL,
    "delivery_date" DATE,
    "subtotal" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "tax_total" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "discount_total" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "grand_total" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "notes" TEXT,
    "custom_fields" JSONB,
    "created_by_id" CHAR(36),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "sales_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_order_lines" (
    "id" CHAR(36) NOT NULL,
    "tenant_id" CHAR(36) NOT NULL,
    "sales_order_id" CHAR(36) NOT NULL,
    "product_id" CHAR(36) NOT NULL,
    "description" VARCHAR(255),
    "quantity" DECIMAL(15,3) NOT NULL,
    "unit_price" DECIMAL(15,2) NOT NULL,
    "tax_percent" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "discount_percent" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "line_total" DECIMAL(15,2) NOT NULL,

    CONSTRAINT "sales_order_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoices" (
    "id" CHAR(36) NOT NULL,
    "tenant_id" CHAR(36) NOT NULL,
    "invoice_number" VARCHAR(40) NOT NULL,
    "sales_order_id" CHAR(36),
    "account_id" CHAR(36) NOT NULL,
    "contact_id" CHAR(36),
    "status" "InvoiceStatus" NOT NULL DEFAULT 'DRAFT',
    "invoice_date" DATE NOT NULL,
    "due_date" DATE,
    "subtotal" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "tax_total" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "discount_total" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "grand_total" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "amount_paid" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "currency" CHAR(3) NOT NULL DEFAULT 'INR',
    "notes" TEXT,
    "custom_fields" JSONB,
    "created_by_id" CHAR(36),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_lines" (
    "id" CHAR(36) NOT NULL,
    "tenant_id" CHAR(36) NOT NULL,
    "invoice_id" CHAR(36) NOT NULL,
    "product_id" CHAR(36),
    "description" VARCHAR(255) NOT NULL,
    "quantity" DECIMAL(15,3) NOT NULL,
    "unit_price" DECIMAL(15,2) NOT NULL,
    "tax_percent" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "line_total" DECIMAL(15,2) NOT NULL,

    CONSTRAINT "invoice_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" CHAR(36) NOT NULL,
    "tenant_id" CHAR(36) NOT NULL,
    "payment_number" VARCHAR(40) NOT NULL,
    "invoice_id" CHAR(36),
    "account_id" CHAR(36),
    "vendor_id" CHAR(36),
    "direction" "PaymentDirection" NOT NULL,
    "method" "PaymentMethod" NOT NULL DEFAULT 'UPI',
    "amount" DECIMAL(15,2) NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'INR',
    "paid_at" TIMESTAMPTZ(3) NOT NULL,
    "reference_no" VARCHAR(80),
    "notes" VARCHAR(255),
    "created_by_id" CHAR(36),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employees" (
    "id" CHAR(36) NOT NULL,
    "tenant_id" CHAR(36) NOT NULL,
    "user_id" CHAR(36),
    "employee_code" VARCHAR(40) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "email" VARCHAR(191),
    "phone" VARCHAR(32),
    "department" VARCHAR(80),
    "designation" VARCHAR(80),
    "join_date" DATE,
    "status" "EmployeeStatus" NOT NULL DEFAULT 'ACTIVE',
    "salary" DECIMAL(15,2),
    "custom_fields" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "employees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integrations" (
    "id" CHAR(36) NOT NULL,
    "tenant_id" CHAR(36) NOT NULL,
    "provider" VARCHAR(64) NOT NULL,
    "status" "IntegrationStatus" NOT NULL DEFAULT 'DISCONNECTED',
    "config" JSONB,
    "secrets_enc" TEXT,
    "last_synced_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "integrations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whatsapp_conversations" (
    "id" CHAR(36) NOT NULL,
    "tenant_id" CHAR(36) NOT NULL,
    "provider" VARCHAR(64) NOT NULL DEFAULT 'ASKMEISTER',
    "external_id" VARCHAR(128),
    "phone" VARCHAR(32) NOT NULL,
    "phone_normalized" VARCHAR(20) NOT NULL,
    "contact_id" CHAR(36),
    "lead_id" CHAR(36),
    "contact_name" VARCHAR(120),
    "last_message" VARCHAR(512),
    "unread_count" INTEGER NOT NULL DEFAULT 0,
    "meta" JSONB,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "whatsapp_conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whatsapp_messages" (
    "id" CHAR(36) NOT NULL,
    "tenant_id" CHAR(36) NOT NULL,
    "conversation_id" CHAR(36) NOT NULL,
    "direction" "MessageDirection" NOT NULL,
    "body" TEXT NOT NULL,
    "status" "WhatsappMessageStatus" NOT NULL DEFAULT 'SENT',
    "external_id" VARCHAR(128),
    "sent_by_user_id" CHAR(36),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "whatsapp_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "automation_rules" (
    "id" CHAR(36) NOT NULL,
    "tenant_id" CHAR(36) NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "trigger_module" VARCHAR(64) NOT NULL,
    "trigger_field" VARCHAR(64) NOT NULL,
    "trigger_op" VARCHAR(32) NOT NULL,
    "trigger_value" VARCHAR(255) NOT NULL,
    "action_type" VARCHAR(64) NOT NULL,
    "action_config" JSONB NOT NULL,
    "run_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "automation_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" CHAR(36) NOT NULL,
    "tenant_id" CHAR(36),
    "actor_type" "AuditActorType" NOT NULL,
    "actor_id" CHAR(36),
    "action" VARCHAR(64) NOT NULL,
    "entity_type" VARCHAR(64),
    "entity_id" CHAR(36),
    "ip_address" VARCHAR(64),
    "user_agent" VARCHAR(255),
    "before_json" JSONB,
    "after_json" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "number_sequences" (
    "tenant_id" CHAR(36) NOT NULL,
    "sequence_key" VARCHAR(40) NOT NULL,
    "prefix" VARCHAR(20) NOT NULL DEFAULT '',
    "next_value" INTEGER NOT NULL DEFAULT 1,
    "padding" SMALLINT NOT NULL DEFAULT 5,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "number_sequences_pkey" PRIMARY KEY ("tenant_id","sequence_key")
);

-- CreateIndex
CREATE UNIQUE INDEX "platform_admins_email_key" ON "platform_admins"("email");

-- CreateIndex
CREATE UNIQUE INDEX "business_categories_code_key" ON "business_categories"("code");

-- CreateIndex
CREATE INDEX "business_categories_is_active_sort_order_idx" ON "business_categories"("is_active", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "tenants_code_key" ON "tenants"("code");

-- CreateIndex
CREATE UNIQUE INDEX "tenants_slug_key" ON "tenants"("slug");

-- CreateIndex
CREATE INDEX "tenants_status_idx" ON "tenants"("status");

-- CreateIndex
CREATE INDEX "tenants_business_category_id_idx" ON "tenants"("business_category_id");

-- CreateIndex
CREATE INDEX "tenant_modules_tenant_id_module_group_is_enabled_idx" ON "tenant_modules"("tenant_id", "module_group", "is_enabled");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_modules_tenant_id_module_key_key" ON "tenant_modules"("tenant_id", "module_key");

-- CreateIndex
CREATE INDEX "custom_field_definitions_tenant_id_entity_type_is_visible_idx" ON "custom_field_definitions"("tenant_id", "entity_type", "is_visible");

-- CreateIndex
CREATE UNIQUE INDEX "custom_field_definitions_tenant_id_entity_type_field_key_key" ON "custom_field_definitions"("tenant_id", "entity_type", "field_key");

-- CreateIndex
CREATE INDEX "feature_tips_tenant_id_module_key_section_key_is_active_idx" ON "feature_tips"("tenant_id", "module_key", "section_key", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "roles_tenant_id_code_key" ON "roles"("tenant_id", "code");

-- CreateIndex
CREATE INDEX "users_tenant_id_status_idx" ON "users"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "users_role_id_idx" ON "users"("role_id");

-- CreateIndex
CREATE UNIQUE INDEX "users_tenant_id_email_key" ON "users"("tenant_id", "email");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_token_hash_key" ON "refresh_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "refresh_tokens_user_id_idx" ON "refresh_tokens"("user_id");

-- CreateIndex
CREATE INDEX "refresh_tokens_platform_admin_id_idx" ON "refresh_tokens"("platform_admin_id");

-- CreateIndex
CREATE INDEX "pipeline_stages_tenant_id_sort_order_idx" ON "pipeline_stages"("tenant_id", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "pipeline_stages_tenant_id_code_key" ON "pipeline_stages"("tenant_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "lead_sources_tenant_id_code_key" ON "lead_sources"("tenant_id", "code");

-- CreateIndex
CREATE INDEX "accounts_tenant_id_name_idx" ON "accounts"("tenant_id", "name");

-- CreateIndex
CREATE INDEX "accounts_tenant_id_owner_user_id_idx" ON "accounts"("tenant_id", "owner_user_id");

-- CreateIndex
CREATE INDEX "accounts_tenant_id_phone_idx" ON "accounts"("tenant_id", "phone");

-- CreateIndex
CREATE INDEX "contacts_tenant_id_name_idx" ON "contacts"("tenant_id", "name");

-- CreateIndex
CREATE INDEX "contacts_tenant_id_phone_normalized_idx" ON "contacts"("tenant_id", "phone_normalized");

-- CreateIndex
CREATE INDEX "contacts_tenant_id_email_idx" ON "contacts"("tenant_id", "email");

-- CreateIndex
CREATE INDEX "contacts_tenant_id_account_id_idx" ON "contacts"("tenant_id", "account_id");

-- CreateIndex
CREATE INDEX "leads_tenant_id_status_created_at_idx" ON "leads"("tenant_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "leads_tenant_id_phone_normalized_idx" ON "leads"("tenant_id", "phone_normalized");

-- CreateIndex
CREATE INDEX "leads_tenant_id_assigned_to_id_idx" ON "leads"("tenant_id", "assigned_to_id");

-- CreateIndex
CREATE INDEX "leads_tenant_id_source_id_idx" ON "leads"("tenant_id", "source_id");

-- CreateIndex
CREATE INDEX "deals_tenant_id_stage_id_idx" ON "deals"("tenant_id", "stage_id");

-- CreateIndex
CREATE INDEX "deals_tenant_id_owner_user_id_idx" ON "deals"("tenant_id", "owner_user_id");

-- CreateIndex
CREATE INDEX "deals_tenant_id_expected_close_date_idx" ON "deals"("tenant_id", "expected_close_date");

-- CreateIndex
CREATE INDEX "activities_tenant_id_scheduled_at_idx" ON "activities"("tenant_id", "scheduled_at");

-- CreateIndex
CREATE INDEX "activities_tenant_id_contact_id_idx" ON "activities"("tenant_id", "contact_id");

-- CreateIndex
CREATE INDEX "activities_tenant_id_lead_id_idx" ON "activities"("tenant_id", "lead_id");

-- CreateIndex
CREATE INDEX "activities_tenant_id_type_status_idx" ON "activities"("tenant_id", "type", "status");

-- CreateIndex
CREATE INDEX "tickets_tenant_id_status_priority_idx" ON "tickets"("tenant_id", "status", "priority");

-- CreateIndex
CREATE UNIQUE INDEX "tickets_tenant_id_ticket_no_key" ON "tickets"("tenant_id", "ticket_no");

-- CreateIndex
CREATE INDEX "ticket_messages_tenant_id_ticket_id_created_at_idx" ON "ticket_messages"("tenant_id", "ticket_id", "created_at");

-- CreateIndex
CREATE INDEX "notes_tenant_id_entity_type_entity_id_idx" ON "notes"("tenant_id", "entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "notifications_tenant_id_user_id_is_read_created_at_idx" ON "notifications"("tenant_id", "user_id", "is_read", "created_at");

-- CreateIndex
CREATE INDEX "product_categories_tenant_id_name_idx" ON "product_categories"("tenant_id", "name");

-- CreateIndex
CREATE INDEX "products_tenant_id_name_idx" ON "products"("tenant_id", "name");

-- CreateIndex
CREATE INDEX "products_tenant_id_category_id_idx" ON "products"("tenant_id", "category_id");

-- CreateIndex
CREATE UNIQUE INDEX "products_tenant_id_sku_key" ON "products"("tenant_id", "sku");

-- CreateIndex
CREATE UNIQUE INDEX "warehouses_tenant_id_code_key" ON "warehouses"("tenant_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "stock_levels_tenant_id_product_id_warehouse_id_key" ON "stock_levels"("tenant_id", "product_id", "warehouse_id");

-- CreateIndex
CREATE INDEX "stock_movements_tenant_id_product_id_moved_at_idx" ON "stock_movements"("tenant_id", "product_id", "moved_at");

-- CreateIndex
CREATE INDEX "vendors_tenant_id_name_idx" ON "vendors"("tenant_id", "name");

-- CreateIndex
CREATE INDEX "purchase_orders_tenant_id_vendor_id_status_idx" ON "purchase_orders"("tenant_id", "vendor_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_orders_tenant_id_po_number_key" ON "purchase_orders"("tenant_id", "po_number");

-- CreateIndex
CREATE INDEX "purchase_order_lines_tenant_id_purchase_order_id_idx" ON "purchase_order_lines"("tenant_id", "purchase_order_id");

-- CreateIndex
CREATE INDEX "sales_orders_tenant_id_account_id_status_idx" ON "sales_orders"("tenant_id", "account_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "sales_orders_tenant_id_so_number_key" ON "sales_orders"("tenant_id", "so_number");

-- CreateIndex
CREATE INDEX "sales_order_lines_tenant_id_sales_order_id_idx" ON "sales_order_lines"("tenant_id", "sales_order_id");

-- CreateIndex
CREATE INDEX "invoices_tenant_id_account_id_status_idx" ON "invoices"("tenant_id", "account_id", "status");

-- CreateIndex
CREATE INDEX "invoices_tenant_id_due_date_status_idx" ON "invoices"("tenant_id", "due_date", "status");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_tenant_id_invoice_number_key" ON "invoices"("tenant_id", "invoice_number");

-- CreateIndex
CREATE INDEX "invoice_lines_tenant_id_invoice_id_idx" ON "invoice_lines"("tenant_id", "invoice_id");

-- CreateIndex
CREATE INDEX "payments_tenant_id_invoice_id_idx" ON "payments"("tenant_id", "invoice_id");

-- CreateIndex
CREATE UNIQUE INDEX "payments_tenant_id_payment_number_key" ON "payments"("tenant_id", "payment_number");

-- CreateIndex
CREATE UNIQUE INDEX "employees_tenant_id_employee_code_key" ON "employees"("tenant_id", "employee_code");

-- CreateIndex
CREATE UNIQUE INDEX "integrations_tenant_id_provider_key" ON "integrations"("tenant_id", "provider");

-- CreateIndex
CREATE INDEX "whatsapp_conversations_tenant_id_phone_normalized_idx" ON "whatsapp_conversations"("tenant_id", "phone_normalized");

-- CreateIndex
CREATE INDEX "whatsapp_messages_tenant_id_conversation_id_created_at_idx" ON "whatsapp_messages"("tenant_id", "conversation_id", "created_at");

-- CreateIndex
CREATE INDEX "automation_rules_tenant_id_is_active_idx" ON "automation_rules"("tenant_id", "is_active");

-- CreateIndex
CREATE INDEX "audit_logs_tenant_id_created_at_idx" ON "audit_logs"("tenant_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_tenant_id_entity_type_entity_id_idx" ON "audit_logs"("tenant_id", "entity_type", "entity_id");

