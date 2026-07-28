ALTER TABLE `bookings` ADD COLUMN `service_code` text NOT NULL DEFAULT 'legacy';
--> statement-breakpoint
ALTER TABLE `bookings` ADD COLUMN `equipment_id` text NOT NULL DEFAULT 'ct';
--> statement-breakpoint
ALTER TABLE `bookings` ADD COLUMN `duration_minutes` integer NOT NULL DEFAULT 30;
--> statement-breakpoint
ALTER TABLE `bookings` ADD COLUMN `phone_normalized` text NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE `bookings` ADD COLUMN `patient_category` text NOT NULL DEFAULT 'civilian';
--> statement-breakpoint
ALTER TABLE `bookings` ADD COLUMN `referral_type` text NOT NULL DEFAULT 'other';
--> statement-breakpoint
ALTER TABLE `bookings` ADD COLUMN `referral_number` text NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE `bookings` ADD COLUMN `marketing_source` text NOT NULL DEFAULT '';
--> statement-breakpoint
UPDATE `bookings`
SET `phone_normalized` = replace(replace(replace(replace(replace(`phone`, ' ', ''), '-', ''), '(', ''), ')', ''), '+', '');
--> statement-breakpoint
UPDATE `bookings` SET `service_code` = '101', `equipment_id` = 'fluoro', `duration_minutes` = 15
WHERE lower(`service`) LIKE '%флюорограф%';
--> statement-breakpoint
UPDATE `bookings` SET `service_code` = '201', `equipment_id` = 'xray', `duration_minutes` = 15
WHERE lower(`service`) LIKE '%рентгенограф%';
--> statement-breakpoint
UPDATE `bookings` SET `service_code` = '401' WHERE lower(`service`) LIKE '%головн%мозк%';
--> statement-breakpoint
UPDATE `bookings` SET `service_code` = '408' WHERE lower(`service`) LIKE '%грудн%клітк%';
--> statement-breakpoint
UPDATE `bookings` SET `service_code` = '409' WHERE lower(`service`) LIKE '%черевн%порожнин%' AND lower(`service`) NOT LIKE '%контраст%';
--> statement-breakpoint
UPDATE `bookings` SET `service_code` = '405' WHERE lower(`service`) LIKE '%хребт%';
--> statement-breakpoint
UPDATE `bookings` SET `service_code` = '501', `duration_minutes` = 45
WHERE lower(`service`) LIKE '%головн%мозк%' AND lower(`service`) LIKE '%контраст%';
--> statement-breakpoint
UPDATE `bookings` SET `service_code` = '503', `duration_minutes` = 45
WHERE lower(`service`) LIKE '%грудн%клітк%' AND lower(`service`) LIKE '%контраст%';
--> statement-breakpoint
UPDATE `bookings` SET `service_code` = '504', `duration_minutes` = 45
WHERE lower(`service`) LIKE '%черевн%порожнин%' AND lower(`service`) LIKE '%контраст%';
--> statement-breakpoint
DROP INDEX IF EXISTS `active_booking_slot`;
--> statement-breakpoint
CREATE INDEX `bookings_equipment_schedule_idx`
ON `bookings` (`equipment_id`, `desired_date`, `desired_time`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `booking_events` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `booking_id` integer NOT NULL,
  `action` text NOT NULL,
  `details` text NOT NULL DEFAULT '',
  `actor` text NOT NULL,
  `created_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `booking_events_booking_idx`
ON `booking_events` (`booking_id`, `created_at`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `booking_staff_notes` (
  `booking_id` integer PRIMARY KEY NOT NULL,
  `note` text NOT NULL DEFAULT '',
  `updated_by` text NOT NULL,
  `updated_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `request_limits` (
  `key` text PRIMARY KEY NOT NULL,
  `attempts` integer NOT NULL DEFAULT 0,
  `window_started_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `staff_members` (
  `email` text PRIMARY KEY NOT NULL,
  `display_name` text NOT NULL DEFAULT '',
  `role` text NOT NULL,
  `active` integer NOT NULL DEFAULT 1,
  `created_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
INSERT OR IGNORE INTO `staff_members` (`email`, `display_name`, `role`)
VALUES ('adamenko.artem96@gmail.com', 'Адміністратор RadiologyOS', 'admin');
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `equipment` (
  `id` text PRIMARY KEY NOT NULL,
  `name` text NOT NULL,
  `slot_minutes` integer NOT NULL,
  `work_start` text NOT NULL DEFAULT '08:00',
  `work_end` text NOT NULL DEFAULT '17:00',
  `active` integer NOT NULL DEFAULT 1
);
--> statement-breakpoint
INSERT OR IGNORE INTO `equipment` (`id`, `name`, `slot_minutes`) VALUES
  ('ct', 'Комп’ютерний томограф', 30),
  ('xray', 'Цифровий рентген', 15),
  ('fluoro', 'Флюорограф', 15);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `equipment_blocks` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `equipment_id` text NOT NULL,
  `blocked_date` text NOT NULL,
  `start_time` text NOT NULL,
  `end_time` text NOT NULL,
  `reason` text NOT NULL DEFAULT ''
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `equipment_blocks_schedule_idx`
ON `equipment_blocks` (`equipment_id`, `blocked_date`, `start_time`);
