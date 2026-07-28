// Patient self-service: list every booking tied to a phone number. Requires the
// full phone number (not just the last four digits) so the list isn't trivially
// enumerable. Returns only non-sensitive fields; the protocol document itself is
// gated separately behind the booking code (see /api/my-protocol).

import { normalizeUkrainianPhone } from "../../../lib/phone";
import { isRateLimited } from "../../../lib/rate-limit";

function dbBinding() {
  return (globalThis as typeof globalThis & { __RADIOLOGY_DB__?: D1Database }).__RADIOLOGY_DB__;
}

export async function POST(request: Request) {
  const db = dbBinding();
  if (!db) return Response.json({ error: "Сервіс тимчасово недоступний" }, { status: 503 });
  if (await isRateLimited(db, request, "my-bookings", 12, 15)) {
    return Response.json({ error: "Забагато спроб. Повторіть перевірку пізніше." }, { status: 429 });
  }

  const body = await request.json().catch(() => ({})) as { phone?: string };
  const phoneNormalized = normalizeUkrainianPhone(String(body.phone || ""));
  if (!phoneNormalized) {
    return Response.json({ error: "Введіть повний номер телефону" }, { status: 400 });
  }

  const rows = await db.prepare(
    `SELECT code, service, desired_date AS desiredDate, desired_time AS desiredTime,
       status, created_at AS createdAt,
       CASE WHEN protocol_status = 'issued' THEN 1 ELSE 0 END AS hasProtocol
     FROM bookings WHERE phone_normalized = ?
     ORDER BY created_at DESC, id DESC
     LIMIT 50`
  ).bind(phoneNormalized).all();

  const bookings = (rows.results || []).map((row) => ({
    ...row,
    hasProtocol: Number((row as { hasProtocol: number }).hasProtocol) === 1,
  }));
  return Response.json({ bookings });
}
