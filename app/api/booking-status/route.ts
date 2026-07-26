function dbBinding() {
  return (globalThis as typeof globalThis & { __RADIOLOGY_DB__?: D1Database }).__RADIOLOGY_DB__;
}

export async function POST(request: Request) {
  const db = dbBinding();
  if (!db) return Response.json({ error: "Сервіс тимчасово недоступний" }, { status: 503 });
  if (await isRateLimited(db, request, "booking-status", 12, 15)) {
    return Response.json({ error: "Забагато спроб. Повторіть перевірку пізніше." }, { status: 429 });
  }
  const body = await request.json() as { code?: string; phoneLast4?: string };
  const code = (body.code || "").trim().toUpperCase().slice(0, 20);
  const phoneLast4 = (body.phoneLast4 || "").replace(/\D/g, "").slice(-4);
  if (!/^RD-[A-Z0-9]{8}$/.test(code) || phoneLast4.length !== 4) {
    return Response.json({ error: "Перевірте код і останні 4 цифри телефону" }, { status: 400 });
  }
  const result = await db.prepare(
    `SELECT code, service, desired_date AS desiredDate, desired_time AS desiredTime,
      status, created_at AS createdAt
     FROM bookings WHERE code = ? AND substr(replace(replace(replace(replace(phone,' ',''),'-',''),'(',''),')',''), -4) = ?
     LIMIT 1`
  ).bind(code, phoneLast4).first();
  if (!result) return Response.json({ error: "Заявку не знайдено" }, { status: 404 });
  return Response.json({ booking: result });
}

export async function PATCH(request: Request) {
  const db = dbBinding();
  if (!db) return Response.json({ error: "Сервіс тимчасово недоступний" }, { status: 503 });
  if (await isRateLimited(db, request, "booking-cancel", 6, 15)) {
    return Response.json({ error: "Забагато спроб. Повторіть пізніше." }, { status: 429 });
  }
  const body = await request.json() as { code?: string; phoneLast4?: string; action?: string };
  const code = (body.code || "").trim().toUpperCase().slice(0, 20);
  const phoneLast4 = (body.phoneLast4 || "").replace(/\D/g, "").slice(-4);
  if (body.action !== "cancel" || !/^RD-[A-Z0-9]{8}$/.test(code) || phoneLast4.length !== 4) {
    return Response.json({ error: "Некоректний запит" }, { status: 400 });
  }
  const booking = await db.prepare(
    `SELECT id, status FROM bookings WHERE code = ?
     AND substr(replace(replace(replace(replace(phone,' ',''),'-',''),'(',''),')',''), -4) = ? LIMIT 1`
  ).bind(code, phoneLast4).first<{id:number;status:string}>();
  if (!booking) return Response.json({ error: "Заявку не знайдено" }, { status: 404 });
  if (!["new","confirmed","rescheduled"].includes(booking.status)) {
    return Response.json({ error: "Цю заявку вже не можна скасувати онлайн" }, { status: 409 });
  }
  await db.prepare("UPDATE bookings SET status = 'cancelled' WHERE id = ?").bind(booking.id).run();
  await db.prepare(`CREATE TABLE IF NOT EXISTS booking_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT, booking_id INTEGER NOT NULL,
    action TEXT NOT NULL, details TEXT NOT NULL DEFAULT '', actor TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`).run();
  await db.prepare(
    "INSERT INTO booking_events (booking_id, action, details, actor) VALUES (?, 'cancelled', 'patient_self_service', 'patient')"
  ).bind(booking.id).run();
  return Response.json({ ok: true, status: "cancelled" });
}
import { isRateLimited } from "../../../lib/rate-limit";
