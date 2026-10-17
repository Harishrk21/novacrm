-- =============================================================================
-- Prefer the full checklist (updated 16 Oct 2026):
--
--   database/rds/03_check_up_to_date.sql
--
-- Open that file in MySQL Workbench against `novacrm` and run it all.
-- It reports OK / MISSING for columns, tables, indexes, and live ticket KPIs.
-- =============================================================================

USE novacrm;

-- Quick peek only — run 03_check_up_to_date.sql for the full report.
SHOW VARIABLES LIKE 'max_connections';
SHOW GLOBAL STATUS LIKE 'Threads_connected';
SHOW GLOBAL STATUS LIKE 'Max_used_connections';

SELECT COLUMN_NAME
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'users'
  AND COLUMN_NAME = 'temp_password';
-- Empty → missing: ALTER TABLE users ADD COLUMN temp_password VARCHAR(128) NULL AFTER password_hash;

SELECT COUNT(*) AS table_count
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = DATABASE();
