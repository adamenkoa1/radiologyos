ALTER TABLE `bookings` ADD `clinical_indication` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `patient_profiles` ADD `contrast_alert` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `patient_profiles` ADD `allergy_note` text DEFAULT '' NOT NULL;