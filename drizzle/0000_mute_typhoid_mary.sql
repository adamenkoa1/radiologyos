CREATE TABLE `bookings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`phone` text NOT NULL,
	`service` text NOT NULL,
	`desired_date` text NOT NULL,
	`desired_time` text NOT NULL,
	`referral` text DEFAULT 'Уточню у адміністратора' NOT NULL,
	`comment` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'new' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `bookings_code_unique` ON `bookings` (`code`);