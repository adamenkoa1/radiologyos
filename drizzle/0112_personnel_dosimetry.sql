CREATE TABLE personnel_dosimetry_records (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id INTEGER NOT NULL,
  personnel_id TEXT NOT NULL,
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  measurement_status TEXT NOT NULL,
  dosimeter_code TEXT NOT NULL DEFAULT '',
  hp10_msv REAL NOT NULL DEFAULT 0,
  hp007_msv REAL NOT NULL DEFAULT 0,
  hp3_msv REAL NOT NULL DEFAULT 0,
  provider_name TEXT NOT NULL DEFAULT '',
  report_number TEXT NOT NULL DEFAULT '',
  report_date TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  supersedes_id TEXT,
  created_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE RESTRICT,
  FOREIGN KEY (personnel_id) REFERENCES personnel_records(id) ON DELETE RESTRICT,
  FOREIGN KEY (supersedes_id) REFERENCES personnel_dosimetry_records(id) ON DELETE RESTRICT,
  CHECK (measurement_status IN ('measured', 'below_detection', 'missing', 'other')),
  CHECK (period_end >= period_start),
  CHECK (hp10_msv >= 0),
  CHECK (hp007_msv >= 0),
  CHECK (hp3_msv >= 0),
  CHECK (measurement_status IN ('measured', 'other') OR (hp10_msv = 0 AND hp007_msv = 0 AND hp3_msv = 0))
);
--> statement-breakpoint
CREATE INDEX personnel_dosimetry_org_personnel_idx
  ON personnel_dosimetry_records(organization_id, personnel_id, period_end DESC, created_at DESC);
--> statement-breakpoint
CREATE UNIQUE INDEX personnel_dosimetry_supersedes_once_idx
  ON personnel_dosimetry_records(supersedes_id)
  WHERE supersedes_id IS NOT NULL;
--> statement-breakpoint
CREATE TRIGGER personnel_dosimetry_personnel_scope_insert
BEFORE INSERT ON personnel_dosimetry_records
FOR EACH ROW
WHEN NOT EXISTS (
  SELECT 1 FROM personnel_records p
  WHERE p.id = NEW.personnel_id AND p.organization_id = NEW.organization_id
)
BEGIN
  SELECT RAISE(ABORT, 'personnel_dosimetry_personnel_scope');
END;
--> statement-breakpoint
CREATE TRIGGER personnel_dosimetry_supersedes_scope_insert
BEFORE INSERT ON personnel_dosimetry_records
FOR EACH ROW
WHEN NEW.supersedes_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM personnel_dosimetry_records previous
  WHERE previous.id = NEW.supersedes_id
    AND previous.organization_id = NEW.organization_id
    AND previous.personnel_id = NEW.personnel_id
)
BEGIN
  SELECT RAISE(ABORT, 'personnel_dosimetry_supersedes_scope');
END;
--> statement-breakpoint
CREATE TRIGGER personnel_dosimetry_append_only_update
BEFORE UPDATE ON personnel_dosimetry_records
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'personnel_dosimetry_append_only');
END;
--> statement-breakpoint
CREATE TRIGGER personnel_dosimetry_append_only_delete
BEFORE DELETE ON personnel_dosimetry_records
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'personnel_dosimetry_append_only');
END;
