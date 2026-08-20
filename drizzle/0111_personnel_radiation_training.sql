CREATE TABLE personnel_radiation_training_records (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id INTEGER NOT NULL,
  personnel_id TEXT NOT NULL,
  training_date TEXT NOT NULL,
  training_kind TEXT NOT NULL,
  result_code TEXT NOT NULL,
  course_title TEXT NOT NULL,
  provider_name TEXT NOT NULL DEFAULT '',
  training_hours INTEGER NOT NULL DEFAULT 0,
  valid_until TEXT NOT NULL DEFAULT '',
  certificate_number TEXT NOT NULL DEFAULT '',
  certificate_date TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  supersedes_id TEXT,
  created_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE RESTRICT,
  FOREIGN KEY (personnel_id) REFERENCES personnel_records(id) ON DELETE RESTRICT,
  FOREIGN KEY (supersedes_id) REFERENCES personnel_radiation_training_records(id) ON DELETE RESTRICT,
  CHECK (training_kind IN ('radiation_safety', 'knowledge_check', 'briefing', 'other')),
  CHECK (result_code IN ('completed', 'passed', 'failed', 'other')),
  CHECK (training_hours >= 0)
);
--> statement-breakpoint
CREATE INDEX personnel_radiation_training_org_personnel_idx
  ON personnel_radiation_training_records(organization_id, personnel_id, training_date DESC, created_at DESC);
--> statement-breakpoint
CREATE UNIQUE INDEX personnel_radiation_training_supersedes_once_idx
  ON personnel_radiation_training_records(supersedes_id)
  WHERE supersedes_id IS NOT NULL;
--> statement-breakpoint
CREATE TRIGGER personnel_radiation_training_personnel_scope_insert
BEFORE INSERT ON personnel_radiation_training_records
FOR EACH ROW
WHEN NOT EXISTS (
  SELECT 1 FROM personnel_records p
  WHERE p.id = NEW.personnel_id AND p.organization_id = NEW.organization_id
)
BEGIN
  SELECT RAISE(ABORT, 'personnel_radiation_training_personnel_scope');
END;
--> statement-breakpoint
CREATE TRIGGER personnel_radiation_training_supersedes_scope_insert
BEFORE INSERT ON personnel_radiation_training_records
FOR EACH ROW
WHEN NEW.supersedes_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM personnel_radiation_training_records previous
  WHERE previous.id = NEW.supersedes_id
    AND previous.organization_id = NEW.organization_id
    AND previous.personnel_id = NEW.personnel_id
)
BEGIN
  SELECT RAISE(ABORT, 'personnel_radiation_training_supersedes_scope');
END;
--> statement-breakpoint
CREATE TRIGGER personnel_radiation_training_append_only_update
BEFORE UPDATE ON personnel_radiation_training_records
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'personnel_radiation_training_append_only');
END;
--> statement-breakpoint
CREATE TRIGGER personnel_radiation_training_append_only_delete
BEFORE DELETE ON personnel_radiation_training_records
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'personnel_radiation_training_append_only');
END;
