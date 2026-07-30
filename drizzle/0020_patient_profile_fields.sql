-- Розширення картки пацієнта: повна дата народження, email і адреса
-- (ручне додавання пацієнта персоналом, як у DocTime).
ALTER TABLE `patient_profiles` ADD COLUMN `birth_date` text NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE `patient_profiles` ADD COLUMN `email` text NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE `patient_profiles` ADD COLUMN `address` text NOT NULL DEFAULT '';
