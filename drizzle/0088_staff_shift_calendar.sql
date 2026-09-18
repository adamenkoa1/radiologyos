CREATE TABLE IF NOT EXISTS `staff_shift_assignments` (
	`organization_id` integer NOT NULL,
	`staff_email` text NOT NULL,
	`preset_code` text NOT NULL,
	`team_index` integer NOT NULL,
	`anchor_date` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_by` text NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	PRIMARY KEY(`organization_id`, `staff_email`),
	FOREIGN KEY (`organization_id`, `staff_email`) REFERENCES `memberships`(`organization_id`, `member_email`) ON DELETE CASCADE,
	CHECK (`team_index` >= 1),
	CHECK (length(`anchor_date`) = 10)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `staff_shift_assignments_org_idx` ON `staff_shift_assignments` (`organization_id`, `preset_code`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `staff_shift_overrides` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`organization_id` integer NOT NULL,
	`staff_email` text NOT NULL,
	`shift_date` text NOT NULL,
	`kind` text NOT NULL,
	`label` text DEFAULT '' NOT NULL,
	`start_time` text DEFAULT '' NOT NULL,
	`end_time` text DEFAULT '' NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_by` text NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`organization_id`, `staff_email`) REFERENCES `staff_shift_assignments`(`organization_id`, `staff_email`) ON DELETE CASCADE,
	UNIQUE(`organization_id`, `staff_email`, `shift_date`),
	CHECK (`kind` IN ('day','evening','night','duty','work','off','recovery','leave','sick','custom')),
	CHECK (length(`shift_date`) = 10)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `staff_shift_overrides_org_date_idx` ON `staff_shift_overrides` (`organization_id`, `shift_date`, `staff_email`);