CREATE TABLE IF NOT EXISTS `mwl_bridge_tokens` (
  `organization_id` integer PRIMARY KEY NOT NULL,
  `token_hash` text NOT NULL UNIQUE,
  `active` integer NOT NULL DEFAULT 1,
  `created_by` text NOT NULL DEFAULT '',
  `created_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `rotated_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `last_used_at` text NOT NULL DEFAULT ''
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `mwl_bridge_tokens_hash_idx`
ON `mwl_bridge_tokens` (`token_hash`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `mwl_patient_ids` (
  `organization_id` integer NOT NULL,
  `phone_normalized` text NOT NULL,
  `patient_id` text NOT NULL,
  `created_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`organization_id`, `phone_normalized`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `mwl_patient_ids_org_patient_idx`
ON `mwl_patient_ids` (`organization_id`, `patient_id`);
