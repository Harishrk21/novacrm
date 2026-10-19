-- Phase 1: link HMS tenants → Meister Attendance (separate DB)
-- Apply: mysql … < manual_attendance_link.sql
-- Or via Prisma: ALTER columns then map HMS Enterprises → Attendance slug `hms`

ALTER TABLE tenants
  ADD COLUMN attendance_enabled TINYINT(1) NOT NULL DEFAULT 0 AFTER settings,
  ADD COLUMN attendance_tenant_id CHAR(36) NULL AFTER attendance_enabled,
  ADD COLUMN attendance_slug VARCHAR(64) NULL AFTER attendance_tenant_id,
  ADD COLUMN attendance_sso_issuer VARCHAR(200) NULL AFTER attendance_slug,
  ADD COLUMN attendance_sso_secret TEXT NULL AFTER attendance_sso_issuer;

CREATE INDEX idx_tenants_attendance_slug ON tenants (attendance_slug);
