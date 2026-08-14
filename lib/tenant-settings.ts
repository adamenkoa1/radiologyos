import { getSetting, setSetting } from "./settings";

export function tenantSettingKey(key: string, organizationId: number): string {
  const id = Number.isInteger(organizationId) && organizationId > 0 ? organizationId : 1;
  return `${key}:org:${id}`;
}

// Tenant configuration never falls back across organizations. Org 1 alone may
// read the legacy un-namespaced key so existing single-tenant installations
// keep working until an administrator next saves the setting.
export async function getTenantSetting(
  db: D1Database,
  key: string,
  organizationId: number,
): Promise<string> {
  const id = Number.isInteger(organizationId) && organizationId > 0 ? organizationId : 1;
  const scoped = await getSetting(db, tenantSettingKey(key, id));
  if (scoped || id !== 1) return scoped;
  return getSetting(db, key);
}

export async function getTenantSettings(
  db: D1Database,
  keys: string[],
  organizationId: number,
): Promise<Record<string, string>> {
  const values: Record<string, string> = {};
  for (const key of keys) values[key] = await getTenantSetting(db, key, organizationId);
  return values;
}

// Org 1 mirrors writes to the legacy key because the public storefront is still
// intentionally org1-only and a few public compatibility paths read legacy
// settings. Other tenants write namespaced keys only.
export async function setTenantSetting(
  db: D1Database,
  key: string,
  value: string,
  organizationId: number,
  mirrorOrg1Legacy = true,
): Promise<void> {
  const id = Number.isInteger(organizationId) && organizationId > 0 ? organizationId : 1;
  await setSetting(db, tenantSettingKey(key, id), value);
  if (id === 1 && mirrorOrg1Legacy) await setSetting(db, key, value);
}
