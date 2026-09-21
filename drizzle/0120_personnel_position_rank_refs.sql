CREATE TABLE `personnel_positions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`organization_id` integer NOT NULL,
	`name` text NOT NULL,
	`active` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`updated_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "personnel_positions_check_1" CHECK(`active` IN (0,1))
);
--> statement-breakpoint
CREATE INDEX `personnel_positions_org_active_name_idx` ON `personnel_positions` (`organization_id`,`active`,`name`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `personnel_positions_org_name_idx` ON `personnel_positions` (`organization_id`,`name`);--> statement-breakpoint
CREATE TABLE `personnel_ranks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`organization_id` integer NOT NULL,
	`name` text NOT NULL,
	`active` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`updated_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "personnel_ranks_check_1" CHECK(`active` IN (0,1))
);
--> statement-breakpoint
CREATE INDEX `personnel_ranks_org_active_name_idx` ON `personnel_ranks` (`organization_id`,`active`,`name`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `personnel_ranks_org_name_idx` ON `personnel_ranks` (`organization_id`,`name`);--> statement-breakpoint
INSERT OR IGNORE INTO `personnel_positions` (`organization_id`, `name`) VALUES
(1, 'Начальник відділення променевої діагностики'),
(1, 'Лікар-рентгенолог'),
(1, 'Рентгенолаборант'),
(1, 'Молодша медична сестра'),
(1, 'Начальник ПРК'),
(1, 'ТВО начальника ПРК'),
(1, 'Рентгенолаборант ПРК'),
(1, 'Водій-електрик ПРК'),
(1, 'Начальник кабінету УЗД'),
(1, 'Лікар ультразвукової діагностики');
--> statement-breakpoint
INSERT OR IGNORE INTO `personnel_ranks` (`organization_id`, `name`) VALUES
(1, 'Цивільний персонал'),
(1, 'Солдат'),
(1, 'Старший солдат'),
(1, 'Молодший сержант'),
(1, 'Сержант'),
(1, 'Старший сержант'),
(1, 'Головний сержант'),
(1, 'Штаб-сержант'),
(1, 'Молодший лейтенант'),
(1, 'Лейтенант'),
(1, 'Старший лейтенант'),
(1, 'Капітан'),
(1, 'Майор'),
(1, 'Підполковник'),
(1, 'Полковник');
