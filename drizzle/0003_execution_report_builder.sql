ALTER TABLE `bookings` ADD COLUMN `assigned_radiologist_email` text NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE `bookings` ADD COLUMN `assigned_radiographer_email` text NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE `bookings` ADD COLUMN `performed_at` text NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE `bookings` ADD COLUMN `anatomical_regions_count` integer NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE `bookings` ADD COLUMN `protocol_ready_at` text NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE `bookings` ADD COLUMN `protocol_issued_at` text NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE `bookings` ADD COLUMN `paid_amount` integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE `bookings` ADD COLUMN `medlink_reference` text NOT NULL DEFAULT '';
--> statement-breakpoint
UPDATE `bookings`
SET `paid_amount` = CASE
  WHEN `payment_status` = 'paid' THEN `payment_amount`
  ELSE 0
END;
--> statement-breakpoint
UPDATE `bookings`
SET `protocol_ready_at` = `protocol_updated_at`
WHERE `protocol_status` IN ('ready', 'issued') AND `protocol_updated_at` != '';
--> statement-breakpoint
UPDATE `bookings`
SET `protocol_issued_at` = `protocol_updated_at`
WHERE `protocol_status` = 'issued' AND `protocol_updated_at` != '';
--> statement-breakpoint
CREATE INDEX `bookings_performed_report_idx`
ON `bookings` (`performed_at`, `equipment_id`);
--> statement-breakpoint
CREATE INDEX `bookings_staff_report_idx`
ON `bookings` (`assigned_radiologist_email`, `assigned_radiographer_email`);
--> statement-breakpoint
CREATE TABLE `report_exports` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `requested_by` text NOT NULL,
  `report_type` text NOT NULL,
  `filters_json` text NOT NULL DEFAULT '{}',
  `columns_json` text NOT NULL DEFAULT '[]',
  `format` text NOT NULL DEFAULT 'xlsx',
  `row_count` integer NOT NULL DEFAULT 0,
  `contains_personal_data` integer NOT NULL DEFAULT 0,
  `created_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE INDEX `report_exports_created_idx`
ON `report_exports` (`created_at`, `requested_by`);
