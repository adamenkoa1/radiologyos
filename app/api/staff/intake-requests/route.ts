import { canManageBookings } from "../../../../lib/staff-auth";
import { requireOrgContext } from "../../../../lib/tenant";
import { dbBinding } from "../../../../lib/db";
import { audit } from "../../../../lib/audit";
import { sendTelegramTo } from "../../../../lib/telegram";

// Черга вхідних заявок (Telegram тощо) для реєстратора: перегляд, узяття в
// роботу, відхилення, звʼязування зі створеним дослідженням і надсилання
// підтвердження назад у месенджер. Доступ — реєстратор/адмін; tenant із сесії.
// Жодних медичних даних у підтвердженні; статус відправлення — чесний.

const LIST_COLUMNS = `id, channel, external_ref AS externalRef, contact, message,
  desired_service AS desiredService, desired_time AS desiredTime, status,
  assigned_email AS assignedEmail, linked_booking_id AS linkedBookingId,
  linked_patient_id AS linkedPatientId, created_at AS createdAt, updated_at AS updatedAt`;

function clean(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export async function GET(request: Request) {
  const db = dbBinding();
  if (!db) return Response.json({ error: "База тимчасово недоступна" }, { status: 503 });
  const ctx = await requireOrgContext(request, db);
  if (!ctx) return Response.json({ error: "Доступ лише для персоналу" }, { status: 403 });
  if (!canManageBookings(ctx.member.role)) {
    return Response.json({ error: "Заявки опрацьовує реєстратор або адміністратор" }, { status: 403 });
  }
  const url = new URL(request.url);
  const status = clean(url.searchParams.get("status"), 20);
  const allowed = ["new", "in_progress", "converted", "declined"];
  const where = allowed.includes(status) ? " AND status = ?" : "";
  const binds: Array<string | number> = [ctx.organizationId];
  if (where) binds.push(status);
  const rows = await db.prepare(
    `SELECT ${LIST_COLUMNS} FROM intake_requests WHERE organization_id = ?${where}
     ORDER BY (status = 'new') DESC, created_at DESC LIMIT 300`
  ).bind(...binds).all();
  return Response.json({ requests: rows.results, staff: ctx.member }, { headers: { "cache-control": "no-store" } });
}

export async function PATCH(request: Request) {
  const db = dbBinding();
  if (!db) return Response.json({ error: "База тимчасово недоступна" }, { status: 503 });
  const ctx = await requireOrgContext(request, db);
  if (!ctx) return Response.json({ error: "Доступ лише для персоналу" }, { status: 403 });
  const member = ctx.member;
  if (!canManageBookings(member.role)) {
    return Response.json({ error: "Заявки опрацьовує реєстратор або адміністратор" }, { status: 403 });
  }
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const id = Number(body.id);
  const action = clean(body.action, 20);
  if (!Number.isInteger(id) || id <= 0) return Response.json({ error: "Некоректна заявка" }, { status: 400 });

  const row = await db.prepare(
    "SELECT id, channel, external_ref AS externalRef, status FROM intake_requests WHERE id = ? AND organization_id = ? LIMIT 1"
  ).bind(id, ctx.organizationId).first<{ id: number; channel: string; externalRef: string; status: string }>();
  if (!row) return Response.json({ error: "Заявку не знайдено" }, { status: 404 });

  if (action === "claim") {
    await db.prepare("UPDATE intake_requests SET status = 'in_progress', assigned_email = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND organization_id = ?")
      .bind(member.email, id, ctx.organizationId).run();
    await audit(db, { action: "intake_request_claimed", resource: "intake", actorEmail: member.email, organizationId: ctx.organizationId, targetId: String(id) });
    return Response.json({ ok: true, status: "in_progress" });
  }

  if (action === "decline") {
    await db.prepare("UPDATE intake_requests SET status = 'declined', assigned_email = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND organization_id = ?")
      .bind(member.email, id, ctx.organizationId).run();
    await audit(db, { action: "intake_request_declined", resource: "intake", actorEmail: member.email, organizationId: ctx.organizationId, targetId: String(id) });
    return Response.json({ ok: true, status: "declined" });
  }

  if (action === "link") {
    const bookingId = Number(body.bookingId);
    const patientId = clean(body.patientId, 64).toLowerCase();
    if (!Number.isInteger(bookingId) || bookingId <= 0) return Response.json({ error: "Вкажіть створене дослідження" }, { status: 400 });
    const booking = await db.prepare("SELECT id FROM bookings WHERE id = ? AND organization_id = ? LIMIT 1").bind(bookingId, ctx.organizationId).first();
    if (!booking) return Response.json({ error: "Дослідження не знайдено в цій організації" }, { status: 400 });
    await db.prepare("UPDATE intake_requests SET status = 'converted', linked_booking_id = ?, linked_patient_id = ?, assigned_email = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND organization_id = ?")
      .bind(bookingId, patientId, member.email, id, ctx.organizationId).run();
    await audit(db, { action: "intake_request_converted", resource: "intake", actorEmail: member.email, organizationId: ctx.organizationId, targetId: String(id), details: { bookingId } });
    return Response.json({ ok: true, status: "converted" });
  }

  if (action === "confirm") {
    const text = clean(body.text, 600);
    if (!text) return Response.json({ error: "Введіть текст підтвердження" }, { status: 400 });
    if (row.channel !== "telegram") {
      return Response.json({ ok: false, sent: false, error: `Канал ${row.channel} ще не налаштовано для відправлення` });
    }
    // Чесний статус: якщо токен бота не налаштовано — sendTelegramTo поверне ok:false.
    const result = await sendTelegramTo(db, row.externalRef, text, ctx.organizationId).catch(() => ({ ok: false, error: "Помилка зʼєднання з Telegram" }));
    await audit(db, { action: "intake_request_confirmation_sent", resource: "intake", actorEmail: member.email, organizationId: ctx.organizationId, targetId: String(id), details: { sent: result.ok } });
    return Response.json({ ok: result.ok, sent: result.ok, error: result.ok ? undefined : (result.error || "Не вдалося надіслати") });
  }

  return Response.json({ error: "Невідома дія" }, { status: 400 });
}
