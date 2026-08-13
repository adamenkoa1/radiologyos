CREATE TABLE IF NOT EXISTS `organization_settings` (
  `organization_id` integer NOT NULL,
  `key` text NOT NULL,
  `value` text NOT NULL DEFAULT '',
  `updated_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`organization_id`, `key`)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `organization_settings_org_idx`
ON `organization_settings` (`organization_id`, `key`);
--> statement-breakpoint
-- Preserve the current single-organization configuration as tenant 1 during
-- the incremental multi-tenant migration. Legacy app_settings remains for
-- public org-1 flows until every consumer has been moved explicitly.
INSERT INTO `organization_settings` (`organization_id`, `key`, `value`)
SELECT 1, `key`, `value` FROM `app_settings`
ON CONFLICT(`organization_id`, `key`) DO NOTHING;
