-- A printed service act snapshot must belong to the exact service_delivery document and state.
CREATE TRIGGER IF NOT EXISTS `printed_service_act_snapshot_integrity`
BEFORE INSERT ON `printed_form_snapshots`
WHEN NEW.form_type='service_act'
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM `business_documents` d
    JOIN `service_delivery_details` s ON s.document_id=d.id AND s.organization_id=d.organization_id
    WHERE d.id=NEW.document_id AND d.organization_id=NEW.organization_id
      AND d.document_type='service_delivery' AND d.state=NEW.document_state
  ) THEN RAISE(ABORT,'printed_form_document_mismatch') END;
END;