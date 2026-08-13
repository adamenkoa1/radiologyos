-- Protocol documents and their immutable revisions must follow the booking tenant.
-- Historical rows may have inherited the legacy DEFAULT 1 even when their booking
-- belongs to another organization, so repair ownership before adding scoped reads.
UPDATE `protocols`
SET `organization_id` = COALESCE(
  (SELECT b.`organization_id` FROM `bookings` b WHERE b.`id` = `protocols`.`booking_id`),
  `organization_id`
);
--> statement-breakpoint
ALTER TABLE `protocol_revisions` ADD COLUMN `organization_id` integer NOT NULL DEFAULT 1;
--> statement-breakpoint
UPDATE `protocol_revisions`
SET `organization_id` = COALESCE(
  (SELECT b.`organization_id` FROM `bookings` b WHERE b.`id` = `protocol_revisions`.`booking_id`),
  `organization_id`
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `protocol_revisions_org_booking_idx`
ON `protocol_revisions` (`organization_id`, `booking_id`, `version`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `protocols_org_number_idx`
ON `protocols` (`organization_id`, `number`);
--> statement-breakpoint
-- Repair legacy protocol event attribution. New writes explicitly carry the tenant.
UPDATE `booking_events`
SET `organization_id` = COALESCE(
  (SELECT b.`organization_id` FROM `bookings` b WHERE b.`id` = `booking_events`.`booking_id`),
  `organization_id`
)
WHERE `action` = 'protocol_document_saved';
