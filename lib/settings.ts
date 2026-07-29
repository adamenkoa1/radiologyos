// Organization-scoped values such as Telegram credentials and payment links.

import { DEFAULT_ORGANIZATION_ID } from "./tenant";

export async function getSetting(
  db: D1Database,
  key: string,
  organizationId = DEFAULT_ORGANIZATION_ID,
): Promise<string> {
  const row = await db.prepare(
    "SELECT value FROM organization_settings WHERE organization_id = ? AND key = ? LIMIT 1"
  ).bind(organizationId, key).first<{ value: string }>();
  return row?.value || "";
}

export async function getSettings(
  db: D1Database,
  keys: string[],
  organizationId = DEFAULT_ORGANIZATION_ID,
): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const key of keys) out[key] = await getSetting(db, key, organizationId);
  return out;
}

export async function setSetting(
  db: D1Database,
  key: string,
  value: string,
  organizationId = DEFAULT_ORGANIZATION_ID,
): Promise<void> {
  await db.prepare(
    `INSERT INTO organization_settings (organization_id, key, value) VALUES (?, ?, ?)
     ON CONFLICT(organization_id, key) DO UPDATE SET value = excluded.value`
  ).bind(organizationId, key, value).run();
}
