CREATE TABLE `expense_movements` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`organization_id` integer DEFAULT 1 NOT NULL,
	`inventory_movement_id` integer NOT NULL,
	`document_id` integer NOT NULL,
	`document_line_id` integer NOT NULL,
	`source_receipt_document_id` integer NOT NULL,
	`source_receipt_line_id` integer NOT NULL,
	`booking_id` integer,
	`item_id` integer NOT NULL,
	`lot_id` integer NOT NULL,
	`warehouse_id` integer NOT NULL,
	`unit_cost` integer DEFAULT 0 NOT NULL,
	`amount_delta` integer NOT NULL,
	`currency` text DEFAULT 'UAH' NOT NULL,
	`reason` text DEFAULT '' NOT NULL,
	`actor_email` text NOT NULL,
	`occurred_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	CONSTRAINT "expense_movements_unit_cost_nonnegative" CHECK("expense_movements"."unit_cost" >= 0),
	CONSTRAINT "expense_movements_amount_positive" CHECK("expense_movements"."amount_delta" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `expense_movements_inventory_movement_idx` ON `expense_movements` (`organization_id`,`inventory_movement_id`);--> statement-breakpoint
CREATE INDEX `expense_movements_org_time_idx` ON `expense_movements` (`organization_id`,`occurred_at`,`id`);--> statement-breakpoint
CREATE INDEX `expense_movements_org_item_time_idx` ON `expense_movements` (`organization_id`,`item_id`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `expense_movements_org_lot_idx` ON `expense_movements` (`organization_id`,`lot_id`,`id`);
--> statement-breakpoint

-- Expense is a valuation projection of a posted inventory writeoff movement.
-- Quantity remains owned by inventory_movements; acquisition cost remains owned by the exact
-- posted receipt line that created the lot. Historical/zero-cost lots do not get synthetic expense.
CREATE TRIGGER `expense_movements_no_update`
BEFORE UPDATE ON `expense_movements`
BEGIN SELECT RAISE(ABORT,'expense_movement_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `expense_movements_no_delete`
BEFORE DELETE ON `expense_movements`
BEGIN SELECT RAISE(ABORT,'expense_movement_immutable'); END;
--> statement-breakpoint

CREATE TRIGGER `expense_movements_integrity_insert`
BEFORE INSERT ON `expense_movements`
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM `inventory_movements` m
    JOIN `inventory_document_lines` w
      ON w.id=m.document_line_id AND w.organization_id=m.organization_id
    JOIN `business_documents` wd
      ON wd.id=m.document_id AND wd.organization_id=m.organization_id
    JOIN `inventory_document_lines` r
      ON r.id=NEW.source_receipt_line_id AND r.organization_id=NEW.organization_id
    JOIN `business_documents` rd
      ON rd.id=NEW.source_receipt_document_id AND rd.organization_id=NEW.organization_id
    WHERE m.id=NEW.inventory_movement_id AND m.organization_id=NEW.organization_id
      AND m.movement_type='writeoff' AND m.quantity_delta<0
      AND wd.id=NEW.document_id AND wd.document_type='inventory_writeoff' AND wd.state='posted'
      AND w.id=NEW.document_line_id AND w.document_id=wd.id
      AND w.item_id=NEW.item_id AND w.lot_id=NEW.lot_id AND w.warehouse_id=NEW.warehouse_id
      AND w.booking_id IS NEW.booking_id AND w.reason=NEW.reason
      AND m.item_id=w.item_id AND m.lot_id=w.lot_id AND m.warehouse_id=w.warehouse_id
      AND m.document_id=wd.id AND m.document_line_id=w.id AND m.booking_id IS w.booking_id
      AND m.quantity_delta=-w.quantity AND m.actor_email=NEW.actor_email
      AND rd.document_type='inventory_receipt' AND rd.state='posted'
      AND r.document_id=rd.id AND r.lot_id=w.lot_id AND r.item_id=w.item_id
      AND r.unit_cost=NEW.unit_cost AND r.line_amount>0 AND r.unit_cost>0
      AND NEW.currency='UAH' AND NEW.occurred_at=wd.occurred_at
  ) THEN RAISE(ABORT,'expense_movement_source_mismatch') END;

  SELECT CASE WHEN (
    SELECT COUNT(*)
    FROM `inventory_document_lines` r
    JOIN `business_documents` rd ON rd.id=r.document_id AND rd.organization_id=r.organization_id
    WHERE r.organization_id=NEW.organization_id AND r.lot_id=NEW.lot_id
      AND rd.document_type='inventory_receipt' AND rd.state='posted'
  )<>1 THEN RAISE(ABORT,'inventory_lot_valuation_ambiguous') END;

  SELECT CASE WHEN NEW.amount_delta<>(
    SELECT CASE
      WHEN COALESCE((SELECT SUM(m2.quantity_delta) FROM inventory_movements m2
                     WHERE m2.organization_id=NEW.organization_id AND m2.lot_id=NEW.lot_id),0)<=0.000001
      THEN MAX(0,r.line_amount-COALESCE((SELECT SUM(e.amount_delta) FROM expense_movements e
                                        WHERE e.organization_id=NEW.organization_id AND e.lot_id=NEW.lot_id),0))
      ELSE MIN(
        MAX(0,r.line_amount-COALESCE((SELECT SUM(e.amount_delta) FROM expense_movements e
                                     WHERE e.organization_id=NEW.organization_id AND e.lot_id=NEW.lot_id),0)),
        CAST(ROUND((-m.quantity_delta)*r.unit_cost) AS INTEGER)
      )
    END
    FROM inventory_movements m
    JOIN inventory_document_lines r ON r.id=NEW.source_receipt_line_id AND r.organization_id=NEW.organization_id
    WHERE m.id=NEW.inventory_movement_id AND m.organization_id=NEW.organization_id
  ) THEN RAISE(ABORT,'expense_movement_amount_mismatch') END;
END;
--> statement-breakpoint

CREATE TRIGGER `inventory_writeoff_expense_auto_post`
AFTER INSERT ON `inventory_movements`
WHEN NEW.movement_type='writeoff' AND NEW.quantity_delta<0
  AND NEW.document_id IS NOT NULL AND NEW.document_line_id IS NOT NULL
BEGIN
  SELECT CASE WHEN (
    SELECT COUNT(*)
    FROM `inventory_document_lines` r
    JOIN `business_documents` rd ON rd.id=r.document_id AND rd.organization_id=r.organization_id
    WHERE r.organization_id=NEW.organization_id AND r.lot_id=NEW.lot_id
      AND rd.document_type='inventory_receipt' AND rd.state='posted'
  )>1 THEN RAISE(ABORT,'inventory_lot_valuation_ambiguous') END;

  INSERT INTO `expense_movements` (
    organization_id,inventory_movement_id,document_id,document_line_id,
    source_receipt_document_id,source_receipt_line_id,booking_id,item_id,lot_id,warehouse_id,
    unit_cost,amount_delta,currency,reason,actor_email,occurred_at
  )
  SELECT
    NEW.organization_id,NEW.id,NEW.document_id,NEW.document_line_id,
    rd.id,r.id,w.booking_id,NEW.item_id,NEW.lot_id,NEW.warehouse_id,
    r.unit_cost,
    CASE
      WHEN COALESCE((SELECT SUM(m2.quantity_delta) FROM inventory_movements m2
                     WHERE m2.organization_id=NEW.organization_id AND m2.lot_id=NEW.lot_id),0)<=0.000001
      THEN MAX(0,r.line_amount-COALESCE((SELECT SUM(e.amount_delta) FROM expense_movements e
                                        WHERE e.organization_id=NEW.organization_id AND e.lot_id=NEW.lot_id),0))
      ELSE MIN(
        MAX(0,r.line_amount-COALESCE((SELECT SUM(e.amount_delta) FROM expense_movements e
                                     WHERE e.organization_id=NEW.organization_id AND e.lot_id=NEW.lot_id),0)),
        CAST(ROUND((-NEW.quantity_delta)*r.unit_cost) AS INTEGER)
      )
    END,
    'UAH',w.reason,NEW.actor_email,wd.occurred_at
  FROM `inventory_document_lines` w
  JOIN `business_documents` wd
    ON wd.id=NEW.document_id AND wd.organization_id=NEW.organization_id
  JOIN `inventory_document_lines` r
    ON r.organization_id=NEW.organization_id AND r.lot_id=NEW.lot_id
  JOIN `business_documents` rd
    ON rd.id=r.document_id AND rd.organization_id=r.organization_id
  WHERE w.id=NEW.document_line_id AND w.organization_id=NEW.organization_id
    AND w.document_id=NEW.document_id AND w.item_id=NEW.item_id AND w.lot_id=NEW.lot_id
    AND w.warehouse_id=NEW.warehouse_id AND NEW.quantity_delta=-w.quantity
    AND wd.document_type='inventory_writeoff' AND wd.state='posted'
    AND rd.document_type='inventory_receipt' AND rd.state='posted'
    AND r.unit_cost>0 AND r.line_amount>0
    AND (
      CASE
        WHEN COALESCE((SELECT SUM(m2.quantity_delta) FROM inventory_movements m2
                       WHERE m2.organization_id=NEW.organization_id AND m2.lot_id=NEW.lot_id),0)<=0.000001
        THEN MAX(0,r.line_amount-COALESCE((SELECT SUM(e.amount_delta) FROM expense_movements e
                                          WHERE e.organization_id=NEW.organization_id AND e.lot_id=NEW.lot_id),0))
        ELSE MIN(
          MAX(0,r.line_amount-COALESCE((SELECT SUM(e.amount_delta) FROM expense_movements e
                                       WHERE e.organization_id=NEW.organization_id AND e.lot_id=NEW.lot_id),0)),
          CAST(ROUND((-NEW.quantity_delta)*r.unit_cost) AS INTEGER)
        )
      END
    )>0;
END;
--> statement-breakpoint
