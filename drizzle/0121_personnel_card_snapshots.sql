CREATE TABLE `personnel_card_snapshots` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`organization_id` integer NOT NULL,
	`personnel_id` text NOT NULL,
	`template_version` integer DEFAULT 1 NOT NULL,
	`payload_json` text NOT NULL,
	`sha256` text NOT NULL,
	`generated_by` text NOT NULL,
	`generated_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "personnel_card_snapshots_check_1" CHECK(`template_version` > 0)
);
--> statement-breakpoint
CREATE INDEX `personnel_card_snapshots_person_idx` ON `personnel_card_snapshots` (`organization_id`,`personnel_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `personnel_card_snapshots_same_render_idx` ON `personnel_card_snapshots` (`organization_id`,`personnel_id`,`template_version`,`sha256`);--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `personnel_card_snapshots_no_update`
BEFORE UPDATE ON `personnel_card_snapshots`
BEGIN SELECT RAISE(ABORT,'personnel_card_snapshot_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `personnel_card_snapshots_no_delete`
BEFORE DELETE ON `personnel_card_snapshots`
BEGIN SELECT RAISE(ABORT,'personnel_card_snapshot_immutable'); END;
