-- Once exact correction details exist, the draft registrar identity is frozen.
-- The only allowed update is the D1-controlled draft -> posted transition after the source is reversed.
CREATE TRIGGER IF NOT EXISTS `service_correction_document_draft_frozen`
BEFORE UPDATE ON `business_documents`
WHEN OLD.state='draft'
  AND EXISTS (
    SELECT 1 FROM `service_correction_details` c
    WHERE c.document_id=OLD.id AND c.organization_id=OLD.organization_id
  )
BEGIN
  SELECT CASE WHEN NOT (
    NEW.state='posted'
    AND NEW.organization_id=OLD.organization_id
    AND NEW.document_type=OLD.document_type
    AND NEW.number=OLD.number
    AND NEW.occurred_at=OLD.occurred_at
    AND NEW.comment=OLD.comment
    AND NEW.created_by=OLD.created_by
    AND NEW.created_at=OLD.created_at
    AND NEW.reversed_document_id IS OLD.reversed_document_id
    AND NEW.posted_by=OLD.created_by
    AND NEW.posted_at<>''
  ) THEN RAISE(ABORT,'service_correction_document_frozen') END;
END;
