CREATE TABLE IF NOT EXISTS custom_field_definitions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  organization_id INTEGER NOT NULL,
  entity_type TEXT NOT NULL DEFAULT 'booking' CHECK(entity_type IN ('booking')),
  label TEXT NOT NULL,
  field_type TEXT NOT NULL CHECK(field_type IN ('text','number','date','boolean','select')),
  options_json TEXT NOT NULL DEFAULT '[]',
  required INTEGER NOT NULL DEFAULT 0 CHECK(required IN (0,1)),
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (organization_id) REFERENCES organizations(id)
);

CREATE INDEX IF NOT EXISTS idx_custom_field_definitions_org_entity
  ON custom_field_definitions(organization_id, entity_type, active, sort_order, id);

CREATE TABLE IF NOT EXISTS custom_field_values (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  organization_id INTEGER NOT NULL,
  definition_id INTEGER NOT NULL,
  entity_type TEXT NOT NULL DEFAULT 'booking' CHECK(entity_type IN ('booking')),
  entity_id INTEGER NOT NULL,
  value_text TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (organization_id) REFERENCES organizations(id),
  FOREIGN KEY (definition_id) REFERENCES custom_field_definitions(id),
  UNIQUE (organization_id, definition_id, entity_type, entity_id)
);

CREATE INDEX IF NOT EXISTS idx_custom_field_values_org_entity
  ON custom_field_values(organization_id, entity_type, entity_id, definition_id);
