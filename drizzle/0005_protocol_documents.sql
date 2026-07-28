CREATE TABLE IF NOT EXISTS `protocols` (
  `booking_id` integer PRIMARY KEY NOT NULL,
  `template_key` text NOT NULL DEFAULT 'generic',
  `method` text NOT NULL DEFAULT '',
  `sections_json` text NOT NULL DEFAULT '{}',
  `findings` text NOT NULL DEFAULT '',
  `conclusion` text NOT NULL DEFAULT '',
  `recommendations` text NOT NULL DEFAULT '',
  `number` text NOT NULL DEFAULT '',
  `status` text NOT NULL DEFAULT 'draft',
  `version` integer NOT NULL DEFAULT 1,
  `author_email` text NOT NULL DEFAULT '',
  `updated_by` text NOT NULL,
  `created_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `protocols_status_idx`
ON `protocols` (`status`, `updated_at`);
--> statement-breakpoint
INSERT OR IGNORE INTO `protocols`
  (`booking_id`, `template_key`, `number`, `status`, `author_email`, `updated_by`, `created_at`, `updated_at`)
SELECT
  `id`,
  'generic',
  `protocol_number`,
  CASE `protocol_status`
    WHEN 'issued' THEN 'issued'
    WHEN 'ready' THEN 'ready'
    WHEN 'in_progress' THEN 'draft'
    ELSE 'draft'
  END,
  `assigned_radiologist_email`,
  `assigned_radiologist_email`,
  CASE WHEN `protocol_updated_at` != '' THEN `protocol_updated_at` ELSE CURRENT_TIMESTAMP END,
  CASE WHEN `protocol_updated_at` != '' THEN `protocol_updated_at` ELSE CURRENT_TIMESTAMP END
FROM `bookings`
WHERE `protocol_status` IN ('in_progress', 'ready', 'issued');
