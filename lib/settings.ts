// Shared key/value access. `app_settings` is the legacy single-organization
// store used by public org-1 flows; staff-facing multi-tenant configuration
// uses `organization_settings` and an organization id from server context.

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

export async function getOrgSetting(db: D1Database, organizationId: number, key: string): Promise<string> {
  const row = await db.prepare(
    "SELECT value FROM organization_settings WHERE organization_id = ? AND key = ? LIMIT 1"
  ).bind(organizationId, key).first<{ value: string }>();
  return row?.value || "";
}

export async function getOrgSettings(
  db: D1Database,
  organizationId: number,
  keys: string[],
): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const key of keys) out[key] = await getOrgSetting(db, organizationId, key);
  return out;
}

export async function setOrgSetting(
  db: D1Database,
  organizationId: number,
  key: string,
  value: string,
): Promise<void> {
  await db.prepare(
    `INSERT INTO organization_settings (organization_id, key, value, updated_at)
     VALUES (?, ?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(organization_id, key) DO UPDATE SET
       value = excluded.value, updated_at = CURRENT_TIMESTAMP`
  ).bind(organizationId, key, value).run();
}

// Transitional compatibility for the current public storefront, which is
// explicitly organization 1. Staff changes for org 1 are mirrored into the
// legacy store so public booking/reminder flows continue to see the same data.
export async function setOrgSettingCompat(
  db: D1Database,
  organizationId: number,
  key: string,
  value: string,
): Promise<void> {
  await setOrgSetting(db, organizationId, key, value);
  if (organizationId === 1) await setSetting(db, key, value);
}
