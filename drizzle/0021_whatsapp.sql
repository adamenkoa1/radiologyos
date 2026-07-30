-- WhatsApp-листування зберігається в patient_communications (channel='whatsapp').
-- external_id = idMessage від green-api, щоб дедуплікувати повторні вебхуки.
ALTER TABLE `patient_communications` ADD COLUMN `external_id` text NOT NULL DEFAULT '';
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `patient_comm_external_idx` ON `patient_communications` (`external_id`) WHERE `external_id` != '';
