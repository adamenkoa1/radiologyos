-- Журнал дій (аудит): хто, що і коли зробив у системі. Пишеться з
-- lib/audit.ts (audit/logSecurityEvent) для чутливих подій — вхід/вихід,
-- зміни налаштувань і графіка, зміни статусу записів, керування персоналом.
-- Читає лише адміністратор (/api/staff/audit). Таблиця вже описана у
-- db/schema.ts (securityAuditLog), але не мала міграції.
CREATE TABLE IF NOT EXISTS `security_audit_log` (
  `organization_id` integer NOT NULL DEFAULT 1,
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `actor_email` text NOT NULL,
  `action` text NOT NULL,
  `resource` text NOT NULL,
  `target_id` text NOT NULL DEFAULT '',
  `details_json` text NOT NULL DEFAULT '{}',
  `created_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `security_audit_created_idx`
ON `security_audit_log` (`organization_id`, `created_at`, `actor_email`);
