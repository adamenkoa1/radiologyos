CREATE TABLE `inventory_reservation_movements` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`organization_id` integer NOT NULL,
	`appointment_document_id` integer NOT NULL,
	`booking_id` integer NOT NULL,
	`requirement_id` integer NOT NULL,
	`service_code` text NOT NULL,
	`item_id` integer NOT NULL,
	`warehouse_id` integer NOT NULL,
	`movement_type` text NOT NULL,
	`quantity_delta` real NOT NULL,
	`actor_email` text NOT NULL,
	`occurred_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`booking_id`) REFERENCES `bookings`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`requirement_id`) REFERENCES `service_material_requirements`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`item_id`) REFERENCES `inventory_items`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`warehouse_id`) REFERENCES `warehouses`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`appointment_document_id`,`organization_id`) REFERENCES `business_documents`(`id`,`organization_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "inventory_reservation_movements_check_1" CHECK(`movement_type` IN ('reserve','release')),
	CONSTRAINT "inventory_reservation_movements_check_2" CHECK((`movement_type`='reserve' AND `quantity_delta` > 0) OR (`movement_type`='release' AND `quantity_delta` < 0))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `inventory_reservation_exact_movement_unique` ON `inventory_reservation_movements` (`organization_id`,`appointment_document_id`,`requirement_id`,`movement_type`);--> statement-breakpoint
CREATE INDEX `inventory_reservation_balance_idx` ON `inventory_reservation_movements` (`organization_id`,`warehouse_id`,`item_id`,`id`);--> statement-breakpoint
CREATE INDEX `inventory_reservation_booking_idx` ON `inventory_reservation_movements` (`organization_id`,`booking_id`,`id`);--> statement-breakpoint
CREATE TABLE `service_material_requirements` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`organization_id` integer NOT NULL,
	`service_code` text NOT NULL,
	`item_id` integer NOT NULL,
	`warehouse_id` integer NOT NULL,
	`quantity` real NOT NULL,
	`active` integer DEFAULT 1 NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`updated_by` text NOT NULL,
	`updated_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`item_id`) REFERENCES `inventory_items`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`warehouse_id`) REFERENCES `warehouses`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "service_material_requirements_check_1" CHECK(length(trim(`service_code`)) > 0),
	CONSTRAINT "service_material_requirements_check_2" CHECK(`quantity` > 0),
	CONSTRAINT "service_material_requirements_check_3" CHECK(`active` IN (0,1))
);
--> statement-breakpoint
CREATE INDEX `service_material_requirements_service_idx` ON `service_material_requirements` (`organization_id`,`service_code`,`active`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `service_material_requirements_active_unique` ON `service_material_requirements` (`organization_id`,`service_code`,`item_id`,`warehouse_id`) WHERE `active` = 1;