-- Office GPS geofence settings for Meister Attendance (per client)
ALTER TABLE `tenants`
  ADD COLUMN `attendance_geofence_enabled` BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN `attendance_geofence_lat` DECIMAL(10, 7) NULL,
  ADD COLUMN `attendance_geofence_lng` DECIMAL(10, 7) NULL,
  ADD COLUMN `attendance_geofence_radius_m` INT NOT NULL DEFAULT 10;
