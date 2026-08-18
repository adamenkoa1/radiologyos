CREATE TABLE `inventory_count_lines` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`organization_id` integer NOT NULL,
	`document_id` integer NOT NULL,
	`line_no` integer NOT NULL,
	`item_id` integer NOT NULL,
	`lot_id` integer NOT NULL,
	`warehouse_id` integer NOT NULL,
	`warehouse_code` text DEFAULT '' NOT NULL,
	`warehouse_name` text DEFAULT '' NOT NULL,
	`item_name` text DEFAULT '' NOT NULL,
	`item_unit` text DEFAULT '' NOT NULL,
	`lot_number` text DEFAULT '' NOT NULL,
	`book_quantity` real NOT NULL,
	`counted_quantity` real NOT NULL,
	`reason` text DEFAULT '' NOT NULL,
	FOREIGN KEY (`item_id`) REFERENCES `inventory_items`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`lot_id`) REFERENCES `inventory_lots`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`document_id`,`organization_id`) REFERENCES `business_documents`(`id`,`organization_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "inventory_count_lines_book_nonnegative" CHECK(book_quantity >= 0),
	CONSTRAINT "inventory_count_lines_counted_nonnegative" CHECK(counted_quantity >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `inventory_count_lines_doc_line_idx` ON `inventory_count_lines` (`organization_id`,`document_id`,`line_no`);--> statement-breakpoint
CREATE UNIQUE INDEX `inventory_count_lines_bucket_unique` ON `inventory_count_lines` (`organization_id`,`document_id`,`warehouse_id`,`lot_id`);--> statement-breakpoint
CREATE INDEX `inventory_count_lines_warehouse_idx` ON `inventory_count_lines` (`organization_id`,`warehouse_id`,`item_id`,`document_id`);