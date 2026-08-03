// Staff tariffs: view the full price list; admins can override prices. Overrides
// are stored per service code; setting a price back to the catalog default (or
// blank) removes the override.

import { requireStaff } from "../../../../lib/staff-auth";
import { serviceByCode } from "../../../../lib/catalog";
import { tariffList } from "../../../../lib/tariffs";
import { dbBinding } from "../../../../lib/db";

export async function GET(request: Request) {
  const db = dbBinding();
  if (!db) return Response.json({ error: "База тимчасово недоступна" }, { status: 503 });
  const member = await requireStaff(request, db);
  if (!member) return Response.json({ error: "Доступ лише для персоналу" }, { status: 403 });
  return Response.json({ tariffs: await tariffList(db), staff: member }, { headers: { "cache-control": "no-store" } });
}

export async function PUT(request: Request) {
  const db = dbBinding();
  if (!db) return Response.json({ error: "База тимчасово недоступна" }, { status: 503 });
  const member = await requireStaff(request, db);
  if (!member) return Response.json({ error: "Доступ лише для персоналу" }, { status: 403 });
  if (member.role !== "admin") return Response.json({ error: "Змінювати тарифи може лише адміністратор" }, { status: 403 });

  const body = await request.json().catch(() => ({})) as { prices?: Record<string, unknown> };
  const prices = body.prices && typeof body.prices === "object" ? body.prices : {};

  // Спочатку валідуємо всі позиції, потім пишемо однією транзакцією (db.batch),
  // щоб некоректна ціна наприкінці не лишила частково збережений прайс.
  const statements = [];
  for (const [code, rawValue] of Object.entries(prices)) {
    const service = serviceByCode(code);
    if (!service) continue;
    const value = Math.round(Number(rawValue));
    if (!Number.isFinite(value) || value < 0 || value > 1_000_000) {
      return Response.json({ error: `Некоректна ціна для послуги ${code}` }, { status: 400 });
    }
    statements.push(value === service.price
      ? db.prepare("DELETE FROM service_prices WHERE code = ?").bind(code)
      : db.prepare(
          `INSERT INTO service_prices (code, price) VALUES (?, ?)
           ON CONFLICT(code) DO UPDATE SET price = excluded.price`
        ).bind(code, value));
  }
  if (statements.length) await db.batch(statements);

  return Response.json({ ok: true, tariffs: await tariffList(db) });
}
