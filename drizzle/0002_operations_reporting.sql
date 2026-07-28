ALTER TABLE `bookings` ADD COLUMN `protocol_number` text NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE `bookings` ADD COLUMN `protocol_status` text NOT NULL DEFAULT 'not_started';
--> statement-breakpoint
ALTER TABLE `bookings` ADD COLUMN `protocol_updated_at` text NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE `bookings` ADD COLUMN `payment_status` text NOT NULL DEFAULT 'not_set';
--> statement-breakpoint
ALTER TABLE `bookings` ADD COLUMN `payment_amount` integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE `bookings` ADD COLUMN `payment_method` text NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE `bookings` ADD COLUMN `nszu_status` text NOT NULL DEFAULT 'not_applicable';
--> statement-breakpoint
ALTER TABLE `bookings` ADD COLUMN `nszu_reference` text NOT NULL DEFAULT '';
--> statement-breakpoint
UPDATE `bookings`
SET `payment_status` = CASE
  WHEN `patient_category` = 'military' THEN 'not_required'
  ELSE 'pending'
END;
--> statement-breakpoint
UPDATE `bookings`
SET `nszu_status` = CASE
  WHEN `referral_type` = 'eh_referral' THEN 'pending'
  ELSE 'not_applicable'
END;
--> statement-breakpoint
CREATE INDEX `bookings_report_date_idx`
ON `bookings` (`desired_date`, `status`);
