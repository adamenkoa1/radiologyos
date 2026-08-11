-- Repair migration shadowing from 0016/0023: 0016 created security_audit_log
-- without organization_id, so 0023 CREATE TABLE IF NOT EXISTS could not upgrade it.
ALTER TABLE `security_audit_log`
ADD COLUMN `organization_id` integer NOT NULL DEFAULT 1;
--> statement-breakpoint
DROP INDEX IF EXISTS `security_audit_created_idx`;
--> statement-breakpoint
CREATE INDEX `security_audit_created_idx`
ON `security_audit_log` (`organization_id`, `created_at`, `actor_email`);
