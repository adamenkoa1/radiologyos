CREATE TABLE IF NOT EXISTS `organization_integration_settings` (
  `organization_id` integer NOT NULL,
  `key` text NOT NULL,
  `value` text NOT NULL DEFAULT '',
  `updated_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_by` text,
  PRIMARY KEY (`organization_id`, `key`),
  FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `organization_integration_settings_org_idx`
ON `organization_integration_settings` (`organization_id`, `key`);
--> statement-breakpoint
-- Only known integration/reminder keys have unambiguous legacy ownership.
-- Copy those values to organization 1; do not infer ownership for unrelated
-- app_settings rows and do not delete legacy data during the compatibility phase.
INSERT OR IGNORE INTO `organization_integration_settings`
  (`organization_id`, `key`, `value`)
SELECT 1, `key`, `value`
FROM `app_settings`
WHERE `key` IN (
  'telegram_bot_token',
  'telegram_bot_username',
  'telegram_chat_id',
  'telegram_webhook_secret',
  'whatsapp_id_instance',
  'whatsapp_api_token_instance',
  'whatsapp_enabled',
  'whatsapp_webhook_token',
  'sms_gateway_url',
  'sms_gateway_auth',
  'email_gateway_url',
  'email_gateway_auth',
  'email_gateway_from',
  'pay_link',
  'external_ics_url',
  'patient_reminders_enabled',
  'patient_reminder_lead_hours'
);