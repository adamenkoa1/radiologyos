-- Transfer printed forms are evidence under the same exact document tenant/type/state contract as
-- receipt and write-off forms.
DROP TRIGGER IF EXISTS `printed_inventory_snapshot_integrity`;
--> statement-breakpoint
CREATE TRIGGER `printed_inventory_snapshot_integrity`
BEFORE INSERT ON `printed_form_snapshots`
WHEN NEW.form_type IN ('inventory_receipt','inventory_writeoff','inventory_transfer')
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM `business_documents` d
    WHERE d.id=NEW.document_id
      AND d.organization_id=NEW.organization_id
      AND d.document_type=NEW.form_type
      AND d.state=NEW.document_state
  ) THEN RAISE(ABORT,'printed_form_document_mismatch') END;
END;