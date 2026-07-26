const schema = `CREATE TABLE IF NOT EXISTS bookings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  service TEXT NOT NULL,
  desired_date TEXT NOT NULL,
  desired_time TEXT NOT NULL,
  referral TEXT NOT NULL DEFAULT 'Уточню у адміністратора',
  comment TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'new',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
)`;

function clean(value: unknown, max = 200) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export async function POST(request: Request) {
  try {
    const db = (globalThis as typeof globalThis & { __RADIOLOGY_DB__?: D1Database }).__RADIOLOGY_DB__;
    if (!db) {
      return Response.json({ error: "Сервіс запису тимчасово недоступний" }, { status: 503 });
    }
    if (await isRateLimited(db, request, "create-booking", 8, 15)) {
      return Response.json({ error: "Забагато спроб. Спробуйте ще раз через 15 хвилин." }, { status: 429 });
    }
    const body = await request.json() as Record<string, unknown>;
    const name = clean(body.name, 120);
    const phone = clean(body.phone, 40);
    const service = clean(body.service, 160);
    const desiredDate = clean(body.date, 10);
    const desiredTime = clean(body.time, 5);
    const referral = clean(body.referral, 80);
    const comment = clean(body.comment, 700);

    if (!name || !phone || !service || !desiredDate || !desiredTime || body.consent !== "yes") {
      return Response.json({ error: "Заповніть усі обов’язкові поля" }, { status: 400 });
    }
    if (!/^\+?[0-9 ()-]{7,20}$/.test(phone)) {
      return Response.json({ error: "Перевірте номер телефону" }, { status: 400 });
    }
    if (!isService(service) || !isBookableDate(desiredDate) || !isTime(desiredTime)) {
      return Response.json({ error: "Оберіть доступні послугу, дату та час" }, { status: 400 });
    }

    const code = `RD-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
    await db.prepare(schema).run();
    await db.prepare(
      `CREATE UNIQUE INDEX IF NOT EXISTS active_booking_slot
       ON bookings(desired_date, desired_time)
       WHERE status NOT IN ('cancelled','completed')`
    ).run();
    const occupied = await db.prepare(
      `SELECT id FROM bookings WHERE desired_date = ? AND desired_time = ?
       AND status NOT IN ('cancelled','completed') LIMIT 1`
    ).bind(desiredDate, desiredTime).first();
    if (occupied) {
      return Response.json({ error: "Цей час щойно зайняли. Оберіть інший вільний час." }, { status: 409 });
    }
    try {
      await db.prepare(
        `INSERT INTO bookings (code, name, phone, service, desired_date, desired_time, referral, comment)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(code, name, phone, service, desiredDate, desiredTime, referral, comment).run();
    } catch (error) {
      if (error instanceof Error && /unique|constraint/i.test(error.message)) {
        return Response.json({ error: "Цей час щойно зайняли. Оберіть інший вільний час." }, { status: 409 });
      }
      throw error;
    }

    return Response.json({ code }, { status: 201 });
  } catch (error) {
    console.error("booking_create_failed", error);
    return Response.json({ error: "Не вдалося зберегти заявку" }, { status: 500 });
  }
}
import { isBookableDate, isService, isTime } from "../../../lib/booking-rules";
import { isRateLimited } from "../../../lib/rate-limit";
