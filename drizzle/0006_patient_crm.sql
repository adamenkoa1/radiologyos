CREATE TABLE IF NOT EXISTS `patient_profiles` (
  `phone_normalized` text PRIMARY KEY NOT NULL,
  `display_name` text NOT NULL DEFAULT '',
  `birth_year` integer NOT NULL DEFAULT 0,
  `tags` text NOT NULL DEFAULT '',
  `notes` text NOT NULL DEFAULT '',
  `do_not_contact` integer NOT NULL DEFAULT 0,
  `updated_by` text NOT NULL,
  `updated_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `patient_communications` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `phone_normalized` text NOT NULL,
  `channel` text NOT NULL DEFAULT 'call',
  `direction` text NOT NULL DEFAULT 'outbound',
  `summary` text NOT NULL DEFAULT '',
  `actor` text NOT NULL,
  `created_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `patient_communications_phone_idx`
ON `patient_communications` (`phone_normalized`, `created_at`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `bookings_patient_idx`
ON `bookings` (`phone_normalized`, `desired_date`);
