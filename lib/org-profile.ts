// Продукт обслуговує ЄДИНИЙ заклад — відділення променевої діагностики
// Чернігівського військового госпіталю. Конструктор профілів організацій і
// перемикачі можливостей (feature flags) прибрано: усі функції завжди
// доступні. Лишається тільки читання org-scoped налаштувань (settings_json)
// для провайдерів (оплата тощо).

import type { OrgContext } from "./tenant";

export interface OrgProfile {
  settings: Record<string, unknown>;
}

function safeParse(json: string): Record<string, unknown> {
  try {
    const value = JSON.parse(json || "{}");
    return value && typeof value === "object" ? value as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

export async function getOrgProfile(db: D1Database, ctx: OrgContext): Promise<OrgProfile> {
  const row = await db.prepare(
    "SELECT settings_json AS settingsJson FROM organization_profiles WHERE organization_id = ?"
  ).bind(ctx.organizationId).first<{ settingsJson: string }>();
  return { settings: row ? safeParse(row.settingsJson) : {} };
}
