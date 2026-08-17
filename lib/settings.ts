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

// Public webhooks have no authenticated tenant context. Resolve their tenant
// only from an exact secret that belongs to exactly one organization. Duplicate
// secrets fail closed. Legacy app_settings is accepted for org1 only until that
// key has an authoritative org1 scoped row; a stale legacy secret can therefore
// never override a rotated org1 secret.
export async function resolveOrganizationByIntegrationSecret(
  db: D1Database,
  key: string,
  providedSecret: string,
): Promise<number | null> {
  const secret = String(providedSecret || "");
  if (!secret) return null;

  const rows = await db.prepare(
    `SELECT organization_id AS organizationId
     FROM organization_integration_settings
     WHERE key = ? AND value = ?
     ORDER BY organization_id
     LIMIT 2`
  ).bind(key, secret).all<{ organizationId:number }>().catch(() => ({ results: [] } as { results:Array<{organizationId:number}> }));
  const matches = rows.results || [];
  if (matches.length !== 0) {
    return matches.length === 1 ? Number(matches[0].organizationId) : null;
  }

  const org1Scoped = await db.prepare(
    `SELECT 1 AS present FROM organization_integration_settings
     WHERE organization_id = ? AND key = ? LIMIT 1`
  ).bind(LEGACY_INTEGRATION_ORGANIZATION_ID, key).first<{ present:number }>().catch(() => null);
  if (org1Scoped) return null;

  const legacy = await getSetting(db, key).catch(() => "");
  return legacy && legacy === secret ? LEGACY_INTEGRATION_ORGANIZATION_ID : null;
}
