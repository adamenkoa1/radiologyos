// Booking intake for the static v22 public site. Unlike /api/bookings (the
// self-service slot picker with hard collision checks), this accepts a
// "desired time" request for one or more services from the v22 cart: each
// service becomes a booking with status "new" for the registrar to confirm.

import { serviceByCode } from "../../../lib/catalog";
import { normalizeUkrainianPhone } from "../../../lib/phone";
import { isRateLimited } from "../../../lib/rate-limit";
import { bookingMessage, sendTelegram } from "../../../lib/telegram";
import { effectivePrice } from "../../../lib/tariffs";

function dbBinding() {
  return (globalThis as typeof globalThis & { __RADIOLOGY_DB__?: D1Database }).__RADIOLOGY_DB__;
}

function clean(value: unknown, max = 200) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

const REFERRAL_TYPES = ["military_referral", "eh_referral", "paper_referral", "none", "other"];

export async function POST(request: Request) {
  try {
    const db = dbBinding();
    if (!db) return Response.json({ error: "Сервіс запису тимчасово недоступний" }, { status: 503 });
    if (await isRateLimited(db, request, "site-booking", 8, 15)) {
      return Response.json({ error: "Забагато спроб. Спробуйте ще раз через 15 хвилин." }, { status: 429 });
    }

    const body = await request.json() as Record<string, unknown>;
    const name = clean(body.name, 120);
    const phone = clean(body.phone, 40);
    const phoneNormalized = normalizeUkrainianPhone(phone);
    const category = clean(body.category, 20) === "military" ? "military" : "civilian";
    let referralType = clean(body.referralType, 30);
    if (!REFERRAL_TYPES.includes(referralType)) referralType = "other";
    const comment = clean(body.comment, 700);
    const marketingSource = clean(body.source, 40);
    const desiredDate = clean(body.desiredDate, 10);
    const desiredTime = clean(body.desiredTime, 5);

    const rawItems = Array.isArray(body.items) ? body.items : [];
    const services = rawItems
      .map((item) => serviceByCode(clean((item as { code?: unknown })?.code, 12)))
      .filter((service): service is NonNullable<typeof service> => Boolean(service));

    if (!name || !phoneNormalized) {
      return Response.json({ error: "Вкажіть ім’я та коректний телефон" }, { status: 400 });
    }
    if (!services.length) {
      return Response.json({ error: "Додайте хоча б одну послугу" }, { status: 400 });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(desiredDate)) {
      return Response.json({ error: "Вкажіть бажану дату" }, { status: 400 });
    }

    const referral = referralType === "none" ? "Немає направлення" : referralType;
    const codes: string[] = [];
    for (const service of services) {
      const code = `RD-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
      const paymentStatus = category === "civilian" ? "pending" : "not_required";
      const nszuStatus = referralType === "eh_referral" ? "pending" : "not_applicable";
      const price = await effectivePrice(db, service.code);
      const result = await db.prepare(
        `INSERT INTO bookings (
          code, name, phone, phone_normalized, service, service_code, equipment_id,
          duration_minutes, desired_date, desired_time, referral, patient_category,
          referral_type, marketing_source, payment_status, payment_amount, nszu_status, comment
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
      ).bind(
        code, name, phone, phoneNormalized, service.title, service.code, service.equipmentId,
        service.durationMinutes, desiredDate, desiredTime, referral, category,
        referralType, marketingSource, paymentStatus, price, nszuStatus, comment,
      ).run();
      if (result.meta.last_row_id) {
        await db.prepare(
          "INSERT INTO booking_events (booking_id, action, details, actor) VALUES (?, 'created', ?, 'patient')"
        ).bind(result.meta.last_row_id, `${service.code} ${desiredDate} ${desiredTime || "час не обрано"}`).run();
      }
      codes.push(code);
    }

    // Best-effort registrar notification; never let it break the booking.
    try {
      await sendTelegram(db, bookingMessage({
        codes, name, phone, category,
        services: services.map((s) => s.title),
        desiredDate, desiredTime, comment,
      }));
    } catch (notifyError) {
      console.error("site_booking_notify_failed", notifyError);
    }

    return Response.json({ codes, code: codes[0] }, { status: 201 });
  } catch (error) {
    console.error("site_booking_failed", error);
    return Response.json({ error: "Не вдалося зберегти заявку" }, { status: 500 });
  }
}
