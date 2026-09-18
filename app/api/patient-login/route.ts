// Patient cabinet login WITHOUT an SMS one-time code (knowledge-based).
//
// Primary path is phone number + date of birth — the least friction for
// patients (the department deliberately accepts this weaker knowledge factor for
// convenience). To keep it from leaking one patient's records to anyone who
// knows their phone+DOB, it is fail-closed on ambiguity: if that pair maps to
// more than one person (or unlinked records with no immutable patient_id), we do
// NOT open an arbitrary record — we ask for the booking code of a specific
// visit. The booking code (RD-…) remains an optional, stronger possession-like
// factor that always resolves to exactly one record. Hard rate-limited to blunt
// guessing.

import { audit } from "../../../lib/audit";
import { normalizeDob } from "../../../lib/dob";
import { createPatientSession, normalizeBookingCode, patientSessionCookie } from "../../../lib/patient-auth";
import { provePatientDobIdentity } from "../../../lib/patient-identity";
import { normalizeUkrainianPhone } from "../../../lib/phone";
import { isRateLimited } from "../../../lib/rate-limit";
import { dbBinding } from "../../../lib/db";

const PRIMARY_ORGANIZATION_ID = 1;

function maskedPhone(phoneNormalized: string): string {
  return phoneNormalized ? `***${phoneNormalized.slice(-4)}` : "";
}

export async function POST(request: Request) {
  const db = dbBinding();
  if (!db) return Response.json({ error: "Сервіс тимчасово недоступний" }, { status: 503 });

  const body = await request.json().catch(() => ({})) as { phone?: unknown; dob?: unknown; bookingCode?: unknown };
  const phoneNormalized = normalizeUkrainianPhone(String(body.phone || ""));
  const dob = normalizeDob(body.dob);
  const bookingCode = normalizeBookingCode(body.bookingCode);
  if (!phoneNormalized || !dob) {
    return Response.json({ error: "Вкажіть номер телефону та дату народження" }, { status: 400 });
  }

  if (await isRateLimited(db, request, `patient-login:${phoneNormalized}`, 8, 15)) {
    return Response.json({ error: "Забагато спроб. Спробуйте пізніше." }, { status: 429 });
  }

  // Шлях із номером заявки: усі три факти мають належати одному реальному запису.
  // Точний код — «секрет володіння», тож сесія прив'язується до нього і проходить
  // fail-closed guard кабінету навіть коли на телефон+ДН кілька записів.
  if (bookingCode) {
    const row = await db.prepare(
      `SELECT b.patient_id AS patientId, COALESCE(p.phone_normalized, '') AS profilePhone
       FROM bookings b
       LEFT JOIN patient_profiles p
         ON p.organization_id = b.organization_id AND p.patient_id = b.patient_id
       WHERE b.organization_id = ? AND b.phone_normalized = ? AND b.date_of_birth = ? AND b.code = ? LIMIT 1`,
    ).bind(PRIMARY_ORGANIZATION_ID, phoneNormalized, dob, bookingCode).first<{ patientId: string; profilePhone: string }>();

    if (!row) {
      await audit(db, {
        organizationId: PRIMARY_ORGANIZATION_ID, actorEmail: "patient", action: "patient_login_failed",
        resource: "patient_auth", targetId: bookingCode.slice(0, 12), details: { phone: maskedPhone(phoneNormalized) },
      });
      return Response.json(
        { error: "Дані не збігаються із записом. Перевірте номер телефону, дату народження та номер заявки." },
        { status: 401, headers: { "cache-control": "no-store" } },
      );
    }
    // A historical booking still opens through its exact code, but only expands
    // into the whole immutable patient record when that record's current phone
    // still matches — mirroring the OTP booking-code identity rules.
    const patientId = row.patientId && row.profilePhone === phoneNormalized ? row.patientId : "";
    const rawToken = await createPatientSession(
      db, phoneNormalized, PRIMARY_ORGANIZATION_ID, { kind: "booking", value: bookingCode }, patientId,
    );
    await audit(db, {
      organizationId: PRIMARY_ORGANIZATION_ID, actorEmail: "patient", action: "patient_login",
      resource: "patient_auth", targetId: bookingCode.slice(0, 12),
      details: { phone: maskedPhone(phoneNormalized), method: "booking_code" },
    });
    return Response.json(
      { ok: true },
      { headers: { "set-cookie": patientSessionCookie(rawToken), "cache-control": "no-store" } },
    );
  }

  // Шлях без номера заявки: телефон + дата народження (знання-фактор). Простіше
  // для пацієнта, слабше за захистом — тож зберігаємо fail-closed на
  // неоднозначність: якщо на телефон+ДН кілька різних людей / незмінного
  // patient_id немає, а записів кілька — не пускаємо в довільний запис, а
  // просимо номер заявки конкретного запису.
  const proof = await provePatientDobIdentity(db, PRIMARY_ORGANIZATION_ID, phoneNormalized, dob);
  if (proof.status === "ambiguous") {
    await audit(db, {
      organizationId: PRIMARY_ORGANIZATION_ID, actorEmail: "patient", action: "patient_login_ambiguous",
      resource: "patient_auth", targetId: "", details: { phone: maskedPhone(phoneNormalized) },
    });
    return Response.json(
      { error: "За цим номером і датою народження знайдено кілька записів. Увійдіть за номером заявки конкретного запису.", needBookingCode: true },
      { status: 409, headers: { "cache-control": "no-store" } },
    );
  }
  if (proof.status !== "ok") {
    await audit(db, {
      organizationId: PRIMARY_ORGANIZATION_ID, actorEmail: "patient", action: "patient_login_failed",
      resource: "patient_auth", targetId: "", details: { phone: maskedPhone(phoneNormalized), method: "phone_dob" },
    });
    return Response.json(
      { error: "Дані не збігаються із записом. Перевірте номер телефону та дату народження." },
      { status: 401, headers: { "cache-control": "no-store" } },
    );
  }
  const rawToken = await createPatientSession(
    db, phoneNormalized, PRIMARY_ORGANIZATION_ID, { kind: "dob", value: dob }, proof.patientId,
  );
  await audit(db, {
    organizationId: PRIMARY_ORGANIZATION_ID, actorEmail: "patient", action: "patient_login",
    resource: "patient_auth", targetId: "",
    details: { phone: maskedPhone(phoneNormalized), method: "phone_dob" },
  });
  return Response.json(
    { ok: true },
    { headers: { "set-cookie": patientSessionCookie(rawToken), "cache-control": "no-store" } },
  );
}
