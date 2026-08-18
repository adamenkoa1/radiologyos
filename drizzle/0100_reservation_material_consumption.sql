ALTER TABLE `inventory_document_lines` ADD `reservation_movement_id` integer;
--> statement-breakpoint
CREATE INDEX `inventory_lines_reservation_idx` ON `inventory_document_lines` (`organization_id`,`reservation_movement_id`,`document_id`,`line_no`) WHERE `reservation_movement_id` IS NOT NULL;
--> statement-breakpoint

-- A reservation link is an execution trace, not another stock ledger. It may exist only on a
-- draft inventory write-off line for the same completed booking/item/warehouse as the exact
-- released reservation. One reservation may be split across lots, but active draft + posted
-- allocations must never exceed the originally reserved quantity.
CREATE TRIGGER `inventory_consumption_link_insert`
BEFORE INSERT ON `inventory_document_lines`
WHEN NEW.reservation_movement_id IS NOT NULL
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM `business_documents` d
    JOIN `inventory_reservation_movements` r
      ON r.id=NEW.reservation_movement_id AND r.organization_id=NEW.organization_id
    JOIN `bookings` b
      ON b.id=r.booking_id AND b.organization_id=r.organization_id
    JOIN `inventory_lots` lot
      ON lot.id=NEW.lot_id AND lot.organization_id=NEW.organization_id AND lot.item_id=NEW.item_id
    WHERE d.id=NEW.document_id AND d.organization_id=NEW.organization_id
      AND d.document_type='inventory_writeoff' AND d.state='draft'
      AND r.movement_type='reserve'
      AND r.booking_id=NEW.booking_id
      AND r.item_id=NEW.item_id
      AND r.warehouse_id=NEW.warehouse_id
      AND b.status='completed' AND b.service_code=r.service_code
      AND EXISTS (
        SELECT 1 FROM `inventory_reservation_movements` rel
        WHERE rel.organization_id=r.organization_id
          AND rel.appointment_document_id=r.appointment_document_id
          AND rel.requirement_id=r.requirement_id
          AND rel.movement_type='release'
          AND ABS(rel.quantity_delta+r.quantity_delta)<0.000001
      )
  ) THEN RAISE(ABORT,'inventory_consumption_reservation_invalid') END;

  SELECT CASE WHEN (
    COALESCE((
      SELECT SUM(l.quantity)
      FROM `inventory_document_lines` l
      JOIN `business_documents` d
        ON d.id=l.document_id AND d.organization_id=l.organization_id
      WHERE l.organization_id=NEW.organization_id
        AND l.reservation_movement_id=NEW.reservation_movement_id
        AND d.document_type='inventory_writeoff'
        AND d.state IN ('draft','posted')
    ),0) + NEW.quantity
  ) > (
    SELECT r.quantity_delta FROM `inventory_reservation_movements` r
    WHERE r.id=NEW.reservation_movement_id AND r.organization_id=NEW.organization_id
      AND r.movement_type='reserve'
  ) + 0.000001 THEN RAISE(ABORT,'inventory_consumption_overallocated') END;
END;
--> statement-breakpoint

CREATE TRIGGER `inventory_consumption_link_identity_immutable`
BEFORE UPDATE OF `reservation_movement_id` ON `inventory_document_lines`
WHEN NEW.reservation_movement_id IS NOT OLD.reservation_movement_id
BEGIN SELECT RAISE(ABORT,'inventory_consumption_reservation_link_immutable'); END;
--> statement-breakpoint

CREATE TRIGGER `inventory_consumption_link_update`
BEFORE UPDATE OF `quantity`,`item_id`,`lot_id`,`warehouse_id`,`booking_id` ON `inventory_document_lines`
WHEN NEW.reservation_movement_id IS NOT NULL
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM `business_documents` d
    JOIN `inventory_reservation_movements` r
      ON r.id=NEW.reservation_movement_id AND r.organization_id=NEW.organization_id
    JOIN `bookings` b
      ON b.id=r.booking_id AND b.organization_id=r.organization_id
    JOIN `inventory_lots` lot
      ON lot.id=NEW.lot_id AND lot.organization_id=NEW.organization_id AND lot.item_id=NEW.item_id
    WHERE d.id=NEW.document_id AND d.organization_id=NEW.organization_id
      AND d.document_type='inventory_writeoff' AND d.state='draft'
      AND r.movement_type='reserve'
      AND r.booking_id=NEW.booking_id
      AND r.item_id=NEW.item_id
      AND r.warehouse_id=NEW.warehouse_id
      AND b.status='completed' AND b.service_code=r.service_code
      AND EXISTS (
        SELECT 1 FROM `inventory_reservation_movements` rel
        WHERE rel.organization_id=r.organization_id
          AND rel.appointment_document_id=r.appointment_document_id
          AND rel.requirement_id=r.requirement_id
          AND rel.movement_type='release'
          AND ABS(rel.quantity_delta+r.quantity_delta)<0.000001
      )
  ) THEN RAISE(ABORT,'inventory_consumption_reservation_invalid') END;

  SELECT CASE WHEN (
    COALESCE((
      SELECT SUM(l.quantity)
      FROM `inventory_document_lines` l
      JOIN `business_documents` d
        ON d.id=l.document_id AND d.organization_id=l.organization_id
      WHERE l.organization_id=NEW.organization_id
        AND l.reservation_movement_id=NEW.reservation_movement_id
        AND l.id<>OLD.id
        AND d.document_type='inventory_writeoff'
        AND d.state IN ('draft','posted')
    ),0) + NEW.quantity
  ) > (
    SELECT r.quantity_delta FROM `inventory_reservation_movements` r
    WHERE r.id=NEW.reservation_movement_id AND r.organization_id=NEW.organization_id
      AND r.movement_type='reserve'
  ) + 0.000001 THEN RAISE(ABORT,'inventory_consumption_overallocated') END;
END;
--> statement-breakpoint

-- No historical inventory line is linked heuristically. Existing unlinked write-offs remain valid.
