const STAFF_EMAILS = new Set(["adamenko.artem96@gmail.com"]);

function getStaffEmail(request: Request) {
  return (request.headers.get("oai-authenticated-user-email") || "").trim().toLowerCase();
}

function dbBinding() {
  return (globalThis as typeof globalThis & { __RADIOLOGY_DB__?: D1Database }).__RADIOLOGY_DB__;
}

export async function GET(request: Request) {
  const email = getStaffEmail(request);
  if (!STAFF_EMAILS.has(email)) {
    return Response.json({ error: "Доступ лише для персоналу" }, { status: 403 });
  }
  const db = dbBinding();
  if (!db) return Response.json({ error: "База тимчасово недоступна" }, { status: 503 });

  await db.prepare(`CREATE TABLE IF NOT EXISTS bookings (
    id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
    phone TEXT NOT NULL, service TEXT NOT NULL, desired_date TEXT NOT NULL,
    desired_time TEXT NOT NULL, referral TEXT NOT NULL DEFAULT '', comment TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'new', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`).run();
  await db.prepare(`CREATE TABLE IF NOT EXISTS booking_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT, booking_id INTEGER NOT NULL,
    action TEXT NOT NULL, details TEXT NOT NULL DEFAULT '', actor TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`).run();
  await db.prepare(`CREATE TABLE IF NOT EXISTS booking_staff_notes (
    booking_id INTEGER PRIMARY KEY, note TEXT NOT NULL DEFAULT '',
    updated_by TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`).run();
  const result = await db.prepare(
    `SELECT id, code, name, phone, service, desired_date AS desiredDate,
      desired_time AS desiredTime, referral, comment, status, created_at AS createdAt
     FROM bookings ORDER BY created_at DESC LIMIT 200`
  ).all();
  const events = await db.prepare(
    `SELECT id, booking_id AS bookingId, action, details, actor, created_at AS createdAt
     FROM booking_events ORDER BY created_at DESC LIMIT 500`
  ).all();
  const notes = await db.prepare(
    `SELECT booking_id AS bookingId, note, updated_by AS updatedBy, updated_at AS updatedAt
     FROM booking_staff_notes`
  ).all();
  return Response.json({ bookings: result.results, events: events.results, notes: notes.results, staffEmail: email });
}

export async function PATCH(request: Request) {
  const email = getStaffEmail(request);
  if (!STAFF_EMAILS.has(email)) {
    return Response.json({ error: "Доступ лише для персоналу" }, { status: 403 });
  }
  const db = dbBinding();
  if (!db) return Response.json({ error: "База тимчасово недоступна" }, { status: 503 });
  const body = await request.json() as { id?: number; status?: string; desiredDate?: string; desiredTime?: string; note?: string };
  const allowed = new Set(["new", "confirmed", "rescheduled", "completed", "cancelled"]);
  if (!Number.isInteger(body.id)) {
    return Response.json({ error: "Некоректні дані" }, { status: 400 });
  }
  if (typeof body.note === "string") {
    const note = body.note.trim().slice(0, 1200);
    await db.prepare(
      `INSERT INTO booking_staff_notes (booking_id, note, updated_by, updated_at)
       VALUES (?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(booking_id) DO UPDATE SET note=excluded.note, updated_by=excluded.updated_by, updated_at=CURRENT_TIMESTAMP`
    ).bind(body.id, note, email).run();
    await db.prepare(
      "INSERT INTO booking_events (booking_id, action, details, actor) VALUES (?, 'staff_note', 'updated', ?)"
    ).bind(body.id, email).run();
    return Response.json({ ok: true });
  }
  if (body.desiredDate && body.desiredTime) {
    if (!isBookableDate(body.desiredDate) || !isTime(body.desiredTime)) {
      return Response.json({ error: "Некоректні дата або час" }, { status: 400 });
    }
    const conflict = await db.prepare(
      `SELECT id FROM bookings WHERE desired_date = ? AND desired_time = ? AND id != ?
       AND status NOT IN ('cancelled','completed') LIMIT 1`
    ).bind(body.desiredDate, body.desiredTime, body.id).first();
    if (conflict) return Response.json({ error: "Цей час уже зайнятий" }, { status: 409 });
    await db.prepare(
      "UPDATE bookings SET desired_date = ?, desired_time = ?, status = 'rescheduled' WHERE id = ?"
    ).bind(body.desiredDate, body.desiredTime, body.id).run();
    await db.prepare(
      "INSERT INTO booking_events (booking_id, action, details, actor) VALUES (?, 'rescheduled', ?, ?)"
    ).bind(body.id, `${body.desiredDate} ${body.desiredTime}`, email).run();
    return Response.json({ ok: true, status: "rescheduled" });
  }
  if (!body.status || !allowed.has(body.status)) {
    return Response.json({ error: "Некоректний статус" }, { status: 400 });
  }
  await db.prepare("UPDATE bookings SET status = ? WHERE id = ?").bind(body.status, body.id).run();
  await db.prepare(
    "INSERT INTO booking_events (booking_id, action, details, actor) VALUES (?, 'status_changed', ?, ?)"
  ).bind(body.id, body.status, email).run();
  return Response.json({ ok: true });
}
import { isBookableDate, isTime } from "../../../../lib/booking-rules";
