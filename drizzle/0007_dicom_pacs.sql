CREATE TABLE IF NOT EXISTS `imaging_studies` (
  `booking_id` integer PRIMARY KEY NOT NULL,
  `accession_number` text NOT NULL DEFAULT '',
  `study_instance_uid` text NOT NULL DEFAULT '',
  `modality` text NOT NULL DEFAULT '',
  `series_count` integer NOT NULL DEFAULT 0,
  `instances_count` integer NOT NULL DEFAULT 0,
  `study_status` text NOT NULL DEFAULT 'not_linked',
  `study_datetime` text NOT NULL DEFAULT '',
  `source` text NOT NULL DEFAULT 'manual',
  `updated_by` text NOT NULL,
  `updated_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `imaging_studies_status_idx`
ON `imaging_studies` (`study_status`, `updated_at`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `pacs_settings` (
  `id` integer PRIMARY KEY NOT NULL,
  `dicomweb_base_url` text NOT NULL DEFAULT '',
  `viewer_base_url` text NOT NULL DEFAULT '',
  `ae_title` text NOT NULL DEFAULT '',
  `enabled` integer NOT NULL DEFAULT 0,
  `notes` text NOT NULL DEFAULT '',
  `updated_by` text NOT NULL DEFAULT '',
  `updated_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
INSERT OR IGNORE INTO `pacs_settings` (`id`) VALUES (1);
