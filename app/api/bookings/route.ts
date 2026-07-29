import { addMinutes, serviceByCode } from "../../../lib/catalog";
import { isBookableDate, isTimeForService } from "../../../lib/booking-rules";
import { normalizeUkrainianPhone } from "../../../lib/phone";
import { isRateLimited } from "../../../lib/rate-limit";
import { effectivePrice } from "../../../lib/tariffs";

function clean(value: unknown, max = 200) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export async function POST(request: Request) {
  try {
    const db = (globalThis as typeof globalThis & { __RADIOLOGY_DB__?: D1Database }).__RADIOLOGY_DB__;
    if (!db) return Response.json({ error: "Сервіс запису тимчасово недоступний" }, { status: 503 });
    if (await isRateLimited(db, request, "create-booking", 8, 15)) {
      return Response.json({ error: "Забагато спроб. Спробуйте ще раз через 15 хвилин." }, { status: 429 });
    }

    const body = await request.json() as Record<string, unknown>;
    const name = clean(body.name, 120);
    const phone = clean(body.phone, 40);
    const phoneNormalized = normalizeUkrainianPhone(phone);
    const emailRaw = clean(body.email, 254).toLowerCase();
    const patientEmail = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(emailRaw) ? emailRaw : "";
    const serviceCode = clean(body.serviceCode, 12);
    const service = serviceByCode(serviceCode);
    const desiredDate = clean(body.date, 10);
    const desiredTime = clean(body.time, 5);
    const patientCategory = clean(body.patientCategory, 20);
    const referralType = clean(body.referralType, 30);
    const referralNumber = clean(body.referralNumber, 80);
    const marketingSource = clean(body.marketingSource, 40);
    const comment = clean(body.comment, 700);

    if (!name || !phoneNormalized || !service || !desiredDate || !desiredTime || body.consent !== "yes") {
      return Response.json({ error: "Перевірте всі обов’язкові поля" }, { status: 400 });
    }
    if (!["military", "civilian"].includes(patientCategory)) {
      return Response.json({ error: "Оберіть категорію пацієнта" }, { status: 400 });
    }
    if (!["military_referral", "eh_referral", "paper_referral", "none", "other"].includes(referralType)) {
      return Response.json({ error: "Оберіть тип направлення" }, { status: 400 });
    }
    if (!isBookableDate(desiredDate) || !isTimeForService(desiredTime, serviceCode)) {
      return Response.json({ error: "Оберіть доступні дату та час" }, { status: 400 });
    }

    const code = `RD-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
    const endTime = addMinutes(desiredTime, service.durationMinutes);
    const referral = referralType === "none" ? "Немає направлення" : referralType;
    const paymentStatus = patientCategory === "civilian" ? "pending" : "not_required";
    const nszuStatus = referralType === "eh_referral" ? "pending" : "not_applicable";
    const price = await effectivePrice(db, service.code);
    const result = await db.prepare(
      `INSERT INTO bookings (
        code, name, phone, phone_normalized, patient_email, service, service_code, equipment_id,
        duration_minutes, desired_date, desired_time, referral, patient_category,
        referral_type, referral_number, marketing_source, payment_status,
        payment_amount, nszu_status, comment
      )
      SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?
      WHERE NOT EXISTS (
        SELECT 1 FROM bookings
        WHERE equipment_id = ? AND desired_date = ?
          AND status NOT IN ('cancelled','completed')
          AND desired_time < ?
          AND time(desired_time, '+' || duration_minutes || ' minutes') > ?
      )
      AND NOT EXISTS (
        SELECT 1 FROM equipment_blocks
        WHERE equipment_id = ? AND blocked_date = ?
          AND start_time < ? AND end_time > ?
      )`
    ).bind(
      code, name, phone, phoneNormalized, patientEmail, service.title, service.code, service.equipmentId,
      service.durationMinutes, desiredDate, desiredTime, referral, patientCategory,
      referralType, referralNumber, marketingSource, paymentStatus,
      price, nszuStatus, comment,
      service.equipmentId, desiredDate, endTime, desiredTime,
      service.equipmentId, desiredDate, endTime, desiredTime,
    ).run();

    if (!result.meta.changes) {
      return Response.json({ error: "Цей час щойно зайняли. Оберіть інший вільний час." }, { status: 409 });
    }
    if (result.meta.last_row_id) {
      await db.prepare(
        "INSERT INTO booking_events (booking_id, action, details, actor) VALUES (?, 'created', ?, 'patient')"
      ).bind(result.meta.last_row_id, `${service.code} ${desiredDate} ${desiredTime}`).run();
    }
    return Response.json({ code }, { status: 201 });
  } catch (error) {
    console.error("booking_create_failed", error);
    return Response.json({ error: "Не вдалося зберегти заявку" }, { status: 500 });
  }
}
