// Shared key/value access. `app_settings` is the legacy single-organization
// store. Integration credentials use organization_integration_settings and are
// always read with an explicit server-derived organization id.

const LEGACY_INTEGRATION_ORGANIZATION_ID = 1;

function validOrganizationId(organizationId: number): boolean {
  return Number.isInteger(organizationId) && organizationId > 0;
}

export async function getSetting(db: D1Database, key: string): Promise<string> {
  const row = await db.prepare("SELECT value FROM app_settings WHERE key = ? LIMIT 1")
    .bind(key).first<{ value: string }>();
  return row?.value || "";
}

export async function getSettings(db: D1Database, keys: string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const key of keys) out[key] = await getSetting(db, key);
  return out;
}

export async function setSetting(db: D1Database, key: string, value: string): Promise<void> {
  await db.prepare(
    `INSERT INTO app_settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).bind(key, value).run();
}

export async function getOrganizationIntegrationSetting(
  db: D1Database,
  organizationId: number,
  key: string,
): Promise<string> {
  if (!validOrganizationId(organizationId)) return "";
  const row = await db.prepare(
    `SELECT value FROM organization_integration_settings
     WHERE organization_id = ? AND key = ? LIMIT 1`
  ).bind(organizationId, key).first<{ value:string }>().catch(() => null);
  if (row) return row.value || "";
  // Compatibility is deliberately one-way: only org1 may read legacy values.
  // Secondary tenants fail closed rather than inheriting primary credentials.
  return organizationId === LEGACY_INTEGRATION_ORGANIZATION_ID
    ? getSetting(db, key).catch(() => "")
    : "";
}

export async function getOrganizationIntegrationSettings(
  db: D1Database,
  organizationId: number,
  keys: string[],
): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const key of keys) {
    out[key] = await getOrganizationIntegrationSetting(db, organizationId, key);
  }
  return out;
}

export async function setOrganizationIntegrationSetting(
  db: D1Database,
  organizationId: number,
  key: string,
  value: string,
  updatedBy?: string | null,
): Promise<void> {
  if (!validOrganizationId(organizationId)) throw new Error("invalid_organization_id");
  await db.prepare(
    `INSERT INTO organization_integration_settings
       (organization_id, key, value, updated_at, updated_by)
     VALUES (?, ?, ?, CURRENT_TIMESTAMP, ?)
     ON CONFLICT(organization_id, key) DO UPDATE SET
       value = excluded.value,
       updated_at = CURRENT_TIMESTAMP,
       updated_by = excluded.updated_by`
  ).bind(organizationId, key, value, updatedBy || null).run();
}
