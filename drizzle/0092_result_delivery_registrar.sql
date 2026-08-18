CREATE TABLE `result_delivery_details` (
	`organization_id` integer NOT NULL,
	`document_id` integer PRIMARY KEY NOT NULL,
	`booking_id` integer NOT NULL,
	`patient_id` text DEFAULT '' NOT NULL,
	`service_title` text NOT NULL,
	`protocol_number` text NOT NULL,
	`protocol_version` integer NOT NULL,
	`signed_by` text NOT NULL,
	`signed_at` text NOT NULL,
	`delivered_by` text NOT NULL,
	`delivered_at` text NOT NULL,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	FOREIGN KEY (`booking_id`) REFERENCES `bookings`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`document_id`,`organization_id`) REFERENCES `business_documents`(`id`,`organization_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "result_delivery_details_check_1" CHECK(`protocol_version` > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `result_delivery_booking_unique` ON `result_delivery_details` (`organization_id`,`booking_id`);--> statement-breakpoint
CREATE INDEX `result_delivery_document_idx` ON `result_delivery_details` (`organization_id`,`document_id`);