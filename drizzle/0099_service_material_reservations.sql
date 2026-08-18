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
--> statement-breakpoint

-- Requirements are versioned master data. A material rule is immutable once created; changing
-- item/warehouse/quantity means deactivating the old row and creating a new one. This guarantees
-- that historical reservation movements never depend on mutable requirement content.
CREATE TRIGGER `service_material_requirement_integrity_insert`
BEFORE INSERT ON `service_material_requirements`
BEGIN
  SELECT CASE WHEN trim(NEW.created_by)='' OR trim(NEW.updated_by)=''
    THEN RAISE(ABORT,'service_material_requirement_actor_required') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM `inventory_items` i
    WHERE i.id=NEW.item_id AND i.organization_id=NEW.organization_id
  ) THEN RAISE(ABORT,'service_material_requirement_item_tenant_mismatch') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM `warehouses` w
    WHERE w.id=NEW.warehouse_id AND w.organization_id=NEW.organization_id
  ) THEN RAISE(ABORT,'service_material_requirement_warehouse_tenant_mismatch') END;
  SELECT CASE WHEN NEW.active=1 AND NOT EXISTS (
    SELECT 1 FROM `inventory_items` i
    JOIN `warehouses` w ON w.id=NEW.warehouse_id AND w.organization_id=NEW.organization_id
    WHERE i.id=NEW.item_id AND i.organization_id=NEW.organization_id
      AND i.active=1 AND w.active=1
  ) THEN RAISE(ABORT,'service_material_requirement_reference_inactive') END;
END;
--> statement-breakpoint

CREATE TRIGGER `service_material_requirement_identity_immutable`
BEFORE UPDATE OF `organization_id`,`service_code`,`item_id`,`warehouse_id`,`quantity`,`created_by`,`created_at`
ON `service_material_requirements`
WHEN NEW.organization_id IS NOT OLD.organization_id
  OR NEW.service_code IS NOT OLD.service_code
  OR NEW.item_id IS NOT OLD.item_id
  OR NEW.warehouse_id IS NOT OLD.warehouse_id
  OR NEW.quantity IS NOT OLD.quantity
  OR NEW.created_by IS NOT OLD.created_by
  OR NEW.created_at IS NOT OLD.created_at
BEGIN SELECT RAISE(ABORT,'service_material_requirement_immutable'); END;
--> statement-breakpoint

CREATE TRIGGER `service_material_requirement_activation_integrity`
BEFORE UPDATE OF `active` ON `service_material_requirements`
WHEN OLD.active=0 AND NEW.active=1
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM `inventory_items` i
    JOIN `warehouses` w ON w.id=NEW.warehouse_id AND w.organization_id=NEW.organization_id
    WHERE i.id=NEW.item_id AND i.organization_id=NEW.organization_id
      AND i.active=1 AND w.active=1
  ) THEN RAISE(ABORT,'service_material_requirement_reference_inactive') END;
END;
--> statement-breakpoint

CREATE TRIGGER `service_material_requirement_no_delete`
BEFORE DELETE ON `service_material_requirements`
BEGIN SELECT RAISE(ABORT,'service_material_requirement_delete_forbidden'); END;
--> statement-breakpoint

-- Reservation movements are immutable planning facts. They reserve item quantity in a warehouse,
-- not a specific lot. Lot selection remains exclusively the physical write-off / valuation concern.
CREATE TRIGGER `inventory_reservation_integrity_insert`
BEFORE INSERT ON `inventory_reservation_movements`
BEGIN
  SELECT CASE WHEN NEW.actor_email<>'system:schedule'
    THEN RAISE(ABORT,'inventory_reservation_actor_invalid') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM `appointment_details` a
    JOIN `business_documents` d
      ON d.id=a.document_id AND d.organization_id=a.organization_id
    JOIN `bookings` b
      ON b.id=a.booking_id AND b.organization_id=a.organization_id
    WHERE a.organization_id=NEW.organization_id
      AND a.document_id=NEW.appointment_document_id
      AND a.booking_id=NEW.booking_id
      AND a.service_code=NEW.service_code
      AND d.document_type='appointment'
      AND b.id=NEW.booking_id
  ) THEN RAISE(ABORT,'inventory_reservation_appointment_mismatch') END;

  SELECT CASE WHEN NEW.movement_type='reserve' AND NOT EXISTS (
    SELECT 1
    FROM `service_material_requirements` r
    JOIN `appointment_details` a
      ON a.document_id=NEW.appointment_document_id
     AND a.organization_id=NEW.organization_id
     AND a.booking_id=NEW.booking_id
    JOIN `business_documents` d
      ON d.id=a.document_id AND d.organization_id=a.organization_id
    JOIN `bookings` b
      ON b.id=a.booking_id AND b.organization_id=a.organization_id
    WHERE r.id=NEW.requirement_id AND r.organization_id=NEW.organization_id
      AND r.active=1 AND r.service_code=NEW.service_code
      AND r.item_id=NEW.item_id AND r.warehouse_id=NEW.warehouse_id
      AND ABS(r.quantity-NEW.quantity_delta)<0.000001
      AND a.service_code=r.service_code
      AND d.document_type='appointment' AND d.state='posted'
      AND b.status NOT IN ('cancelled','completed')
  ) THEN RAISE(ABORT,'inventory_reservation_source_invalid') END;

  SELECT CASE WHEN NEW.movement_type='release' AND NOT EXISTS (
    SELECT 1
    FROM `inventory_reservation_movements` reserve
    JOIN `appointment_details` a
      ON a.document_id=reserve.appointment_document_id
     AND a.organization_id=reserve.organization_id
     AND a.booking_id=reserve.booking_id
    JOIN `business_documents` d
      ON d.id=a.document_id AND d.organization_id=a.organization_id
    JOIN `bookings` b
      ON b.id=a.booking_id AND b.organization_id=a.organization_id
    WHERE reserve.organization_id=NEW.organization_id
      AND reserve.appointment_document_id=NEW.appointment_document_id
      AND reserve.booking_id=NEW.booking_id
      AND reserve.requirement_id=NEW.requirement_id
      AND reserve.service_code=NEW.service_code
      AND reserve.item_id=NEW.item_id
      AND reserve.warehouse_id=NEW.warehouse_id
      AND reserve.movement_type='reserve'
      AND ABS(reserve.quantity_delta+NEW.quantity_delta)<0.000001
      AND (d.state='reversed' OR b.status IN ('cancelled','completed'))
      AND NOT EXISTS (
        SELECT 1 FROM `inventory_reservation_movements` x
        WHERE x.organization_id=reserve.organization_id
          AND x.appointment_document_id=reserve.appointment_document_id
          AND x.requirement_id=reserve.requirement_id
          AND x.movement_type='release'
      )
  ) THEN RAISE(ABORT,'inventory_reservation_release_invalid') END;
END;
--> statement-breakpoint

-- A new reservation cannot oversubscribe the item's physical on-hand quantity in this warehouse.
CREATE TRIGGER `inventory_reservation_available_stock`
BEFORE INSERT ON `inventory_reservation_movements`
WHEN NEW.movement_type='reserve'
BEGIN
  SELECT CASE WHEN (
    COALESCE((
      SELECT SUM(m.quantity_delta) FROM `inventory_movements` m
      WHERE m.organization_id=NEW.organization_id
        AND m.warehouse_id=NEW.warehouse_id
        AND m.item_id=NEW.item_id
    ),0)
    - COALESCE((
      SELECT SUM(r.quantity_delta) FROM `inventory_reservation_movements` r
      WHERE r.organization_id=NEW.organization_id
        AND r.warehouse_id=NEW.warehouse_id
        AND r.item_id=NEW.item_id
    ),0)
    - NEW.quantity_delta
  ) < -0.000001 THEN RAISE(ABORT,'inventory_reservation_insufficient_stock') END;
END;
--> statement-breakpoint

CREATE TRIGGER `inventory_reservation_no_update`
BEFORE UPDATE ON `inventory_reservation_movements`
BEGIN SELECT RAISE(ABORT,'inventory_reservation_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `inventory_reservation_no_delete`
BEFORE DELETE ON `inventory_reservation_movements`
BEGIN SELECT RAISE(ABORT,'inventory_reservation_immutable'); END;
--> statement-breakpoint

-- Physical stock cannot be consumed or transferred away below the active reservation floor.
CREATE TRIGGER `inventory_reserved_stock_floor`
BEFORE INSERT ON `inventory_movements`
WHEN NEW.quantity_delta<0 AND NEW.warehouse_id IS NOT NULL
  AND COALESCE((
    SELECT SUM(r.quantity_delta) FROM `inventory_reservation_movements` r
    WHERE r.organization_id=NEW.organization_id
      AND r.warehouse_id=NEW.warehouse_id
      AND r.item_id=NEW.item_id
  ),0) > 0.000001
BEGIN
  SELECT CASE WHEN (
    COALESCE((
      SELECT SUM(m.quantity_delta) FROM `inventory_movements` m
      WHERE m.organization_id=NEW.organization_id
        AND m.warehouse_id=NEW.warehouse_id
        AND m.item_id=NEW.item_id
    ),0)
    + NEW.quantity_delta
    - COALESCE((
      SELECT SUM(r.quantity_delta) FROM `inventory_reservation_movements` r
      WHERE r.organization_id=NEW.organization_id
        AND r.warehouse_id=NEW.warehouse_id
        AND r.item_id=NEW.item_id
    ),0)
  ) < -0.000001 THEN RAISE(ABORT,'inventory_reserved_stock_violation') END;
END;
--> statement-breakpoint

-- Appointment creation reserves all active requirements for its exact service. Existing historical
-- appointments are intentionally untouched: there is no top-level INSERT ... SELECT backfill here.
CREATE TRIGGER `appointment_material_reservations_create`
AFTER INSERT ON `appointment_details`
BEGIN
  INSERT INTO `inventory_reservation_movements`
    (`organization_id`,`appointment_document_id`,`booking_id`,`requirement_id`,`service_code`,
     `item_id`,`warehouse_id`,`movement_type`,`quantity_delta`,`actor_email`,`occurred_at`)
  SELECT NEW.organization_id,NEW.document_id,NEW.booking_id,r.id,NEW.service_code,
         r.item_id,r.warehouse_id,'reserve',r.quantity,'system:schedule',CURRENT_TIMESTAMP
  FROM `service_material_requirements` r
  WHERE r.organization_id=NEW.organization_id
    AND r.service_code=NEW.service_code
    AND r.active=1
  ORDER BY r.id;
END;
--> statement-breakpoint

-- Reschedule/cancellation reverses the exact Appointment; release only reservations belonging to
-- that version. A replacement Appointment, if created by 0095, receives its own fresh reservation.
CREATE TRIGGER `appointment_material_reservations_release`
AFTER UPDATE OF `state` ON `business_documents`
WHEN OLD.document_type='appointment' AND OLD.state='posted' AND NEW.state='reversed'
BEGIN
  INSERT INTO `inventory_reservation_movements`
    (`organization_id`,`appointment_document_id`,`booking_id`,`requirement_id`,`service_code`,
     `item_id`,`warehouse_id`,`movement_type`,`quantity_delta`,`actor_email`,`occurred_at`)
  SELECT reserve.organization_id,reserve.appointment_document_id,reserve.booking_id,reserve.requirement_id,
         reserve.service_code,reserve.item_id,reserve.warehouse_id,'release',-reserve.quantity_delta,
         'system:schedule',CURRENT_TIMESTAMP
  FROM `inventory_reservation_movements` reserve
  WHERE reserve.organization_id=NEW.organization_id
    AND reserve.appointment_document_id=NEW.id
    AND reserve.movement_type='reserve'
    AND NOT EXISTS (
      SELECT 1 FROM `inventory_reservation_movements` x
      WHERE x.organization_id=reserve.organization_id
        AND x.appointment_document_id=reserve.appointment_document_id
        AND x.requirement_id=reserve.requirement_id
        AND x.movement_type='release'
    );
END;
--> statement-breakpoint

-- Completion ends the planning reservation. Actual material consumption/write-off remains a
-- separate next-stage registrar and is deliberately not synthesized by this migration.
CREATE TRIGGER `booking_material_reservations_release_on_completion`
AFTER UPDATE OF `status` ON `bookings`
WHEN OLD.status<>'completed' AND NEW.status='completed'
BEGIN
  INSERT INTO `inventory_reservation_movements`
    (`organization_id`,`appointment_document_id`,`booking_id`,`requirement_id`,`service_code`,
     `item_id`,`warehouse_id`,`movement_type`,`quantity_delta`,`actor_email`,`occurred_at`)
  SELECT reserve.organization_id,reserve.appointment_document_id,reserve.booking_id,reserve.requirement_id,
         reserve.service_code,reserve.item_id,reserve.warehouse_id,'release',-reserve.quantity_delta,
         'system:schedule',CURRENT_TIMESTAMP
  FROM `inventory_reservation_movements` reserve
  JOIN `business_documents` d
    ON d.id=reserve.appointment_document_id AND d.organization_id=reserve.organization_id
  WHERE reserve.organization_id=NEW.organization_id
    AND reserve.booking_id=NEW.id
    AND reserve.movement_type='reserve'
    AND d.document_type='appointment' AND d.state='posted'
    AND NOT EXISTS (
      SELECT 1 FROM `inventory_reservation_movements` x
      WHERE x.organization_id=reserve.organization_id
        AND x.appointment_document_id=reserve.appointment_document_id
        AND x.requirement_id=reserve.requirement_id
        AND x.movement_type='release'
    );
END;
--> statement-breakpoint
