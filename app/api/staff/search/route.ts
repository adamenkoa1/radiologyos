// Швидкий пошук для командної палітри (⌘K): заявки за ПІБ, телефоном або
// кодом RD у межах організації персоналу. Лише для активного співробітника.

import { requireOrgContext } from "../../../../lib/tenant";
import { normalizeUkrainianPhone } from "../../../../lib/phone";
import { stateLabel } from "../../../../lib/study-state";
import { dbBinding } from "../../../../lib/db";

// SQLite LOWER() не чіпає кирилицю, тож регістронезалежність по імені робимо
// через варіанти запиту (як є / нижній / з великої) — toLowerCase/Upper у JS
// кирилицю обробляють правильно.
function nameVariants(q: string): string[] {
  const lower = q.toLowerCase();
  const title = q.replace(/\S+/g, (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
  return [...new Set([q, lower, title])];
}

export async function GET(request: Request) {
  const db = dbBinding();
  if (!db) return Response.json({ error: "База тимчасово недоступна" }, { status: 503 });
  const ctx = await requireOrgContext(request, db);
  if (!ctx) return Response.json({ error: "Доступ лише для персоналу" }, { status: 403 });

  const q = (new URL(request.url).searchParams.get("q") || "").trim().slice(0, 60);
  if (q.length < 2) return Response.json({ results: [] }, { headers: { "cache-control": "no-store" } });

  // Динамічний WHERE: додаємо лише релевантні умови (без «нічого не матчить»
  // сентинелів, які ламаються при мініфікації).
  const conds: string[] = [];
  const binds: (string | number)[] = [ctx.organizationId];
  for (const v of nameVariants(q)) { conds.push("name LIKE ?"); binds.push(`%${v}%`); }
  conds.push("UPPER(code) LIKE ?"); binds.push(`%${q.toUpperCase()}%`);
  const phoneDigits = q.replace(/\D/g, "");
  if (phoneDigits.length >= 3) { conds.push("phone_normalized LIKE ?"); binds.push(`%${normalizeUkrainianPhone(q) || phoneDigits}%`); }

  const rows = await db.prepare(
    `SELECT id, code, name, phone, service, desired_date AS desiredDate, desired_time AS desiredTime, status
       FROM bookings
      WHERE organization_id = ? AND (${conds.join(" OR ")})
      ORDER BY created_at DESC, id DESC
      LIMIT 12`
  ).bind(...binds).all<{
    id: number; code: string; name: string; phone: string;
    desiredDate: string; desiredTime: string; status: string;
  }>();

  const results = (rows.results || []).map((r) => ({
    ...r,
    statusLabel: stateLabel(String(r.status)),
  }));
  return Response.json({ results }, { headers: { "cache-control": "no-store" } });
}
