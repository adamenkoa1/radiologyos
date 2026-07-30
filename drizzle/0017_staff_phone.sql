-- Вхід і реєстрація персоналу за номером телефону.
-- email лишається внутрішнім ідентифікатором акаунта (memberships, сесії,
-- аудит), а phone стає логін-ідентифікатором. Додатково, без руйнувань.
ALTER TABLE `staff_members` ADD COLUMN `phone` text NOT NULL DEFAULT '';
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `staff_members_phone_idx` ON `staff_members` (`phone`) WHERE `phone` != '';
