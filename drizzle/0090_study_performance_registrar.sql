-- Physical BAS-like study-performance registrar.
--
-- This staged migration deliberately keeps all operational/economic register movements owned by
-- service_delivery. A posted study_performance document is created only as immutable documentary
-- evidence that the already-posted service-delivery snapshot represents a performed study.
-- Historical service-delivery documents are not backfilled.

CREATE TRIGGER `study_performance_integrity_insert`
BEFORE INSERT ON `business_documents`
WHEN NEW.document_type='study_performance'
BEGIN
  SELECT CASE WHEN NEW.basis_document_id IS NULL
    THEN RAISE(ABORT,'study_performance_basis_required') END;

  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM `business_documents` src
    WHERE src.id=NEW.basis_document_id
      AND src.organization_id=NEW.organization_id
      AND src.document_type='service_delivery'
      AND src.state='posted'
  ) THEN RAISE(ABORT,'study_performance_basis_invalid') END;

  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM `service_delivery_details` s
    WHERE s.document_id=NEW.basis_document_id
      AND s.organization_id=NEW.organization_id
  ) THEN RAISE(ABORT,'study_performance_snapshot_missing') END;

  SELECT CASE WHEN NEW.number<>printf('ВД-%06d',NEW.basis_document_id)
    THEN RAISE(ABORT,'study_performance_number_invalid') END;

  SELECT CASE WHEN NEW.state<>'posted'
    THEN RAISE(ABORT,'study_performance_state_invalid') END;

  SELECT CASE WHEN NEW.occurred_at<>(
    SELECT s.performed_at FROM `service_delivery_details` s
    WHERE s.document_id=NEW.basis_document_id
      AND s.organization_id=NEW.organization_id
    LIMIT 1
  ) THEN RAISE(ABORT,'study_performance_occurred_at_mismatch') END;

  SELECT CASE WHEN NEW.created_by<>(
    SELECT src.posted_by FROM `business_documents` src
    WHERE src.id=NEW.basis_document_id AND src.organization_id=NEW.organization_id
    LIMIT 1
  ) OR NEW.posted_by<>(
    SELECT src.posted_by FROM `business_documents` src
    WHERE src.id=NEW.basis_document_id AND src.organization_id=NEW.organization_id
    LIMIT 1
  ) THEN RAISE(ABORT,'study_performance_actor_mismatch') END;

  SELECT CASE WHEN NEW.posted_at<>(
    SELECT src.posted_at FROM `business_documents` src
    WHERE src.id=NEW.basis_document_id AND src.organization_id=NEW.organization_id
    LIMIT 1
  ) THEN RAISE(ABORT,'study_performance_posted_at_mismatch') END;

  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM `business_documents` p
    WHERE p.organization_id=NEW.organization_id
      AND p.document_type='study_performance'
      AND p.basis_document_id=NEW.basis_document_id
  ) THEN RAISE(ABORT,'study_performance_source_already_registered') END;
END;
--> statement-breakpoint

CREATE TRIGGER `study_performance_from_service_delivery_post`
AFTER UPDATE OF `state` ON `business_documents`
WHEN OLD.document_type='service_delivery'
  AND OLD.state='draft'
  AND NEW.state='posted'
BEGIN
  INSERT INTO `business_documents`
    (`organization_id`,`document_type`,`number`,`occurred_at`,`state`,`comment`,
     `created_by`,`posted_by`,`posted_at`,`basis_document_id`)
  SELECT
    NEW.organization_id,
    'study_performance',
    printf('ВД-%06d',NEW.id),
    s.performed_at,
    'posted',
    'Факт виконання дослідження',
    NEW.posted_by,
    NEW.posted_by,
    NEW.posted_at,
    NEW.id
  FROM `service_delivery_details` s
  WHERE s.organization_id=NEW.organization_id
    AND s.document_id=NEW.id
    AND NOT EXISTS (
      SELECT 1 FROM `business_documents` p
      WHERE p.organization_id=NEW.organization_id
        AND p.document_type='study_performance'
        AND p.basis_document_id=NEW.id
    );
END;
--> statement-breakpoint

CREATE TRIGGER `study_performance_reversal_requires_source_reversed`
BEFORE UPDATE OF `state` ON `business_documents`
WHEN OLD.document_type='study_performance'
  AND OLD.state='posted'
  AND NEW.state='reversed'
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM `business_documents` src
    WHERE src.id=OLD.basis_document_id
      AND src.organization_id=OLD.organization_id
      AND src.document_type='service_delivery'
      AND src.state='reversed'
  ) THEN RAISE(ABORT,'study_performance_source_storno_required') END;
END;
--> statement-breakpoint

CREATE TRIGGER `study_performance_from_service_delivery_reversal`
AFTER UPDATE OF `state` ON `business_documents`
WHEN OLD.document_type='service_delivery'
  AND OLD.state='posted'
  AND NEW.state='reversed'
BEGIN
  UPDATE `business_documents`
  SET state='reversed'
  WHERE organization_id=NEW.organization_id
    AND document_type='study_performance'
    AND basis_document_id=NEW.id
    AND state='posted';
END;
