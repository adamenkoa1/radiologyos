// Patient cabinet login WITHOUT an SMS one-time code.
//
// The department has no SMS gateway, and the booking already shows the patient a
// concrete visit time — so instead of an SMS possession factor the cabinet is
// opened by three matching facts: phone number + date of birth + the booking
// code (RD-…) the patient received after booking. The code is a per-booking
// secret shown only to that patient, so it stands in for possession. All three
// must match one real booking; the session is then scoped to phone + DOB so the
// patient sees all their visits. Hard rate-limited to blunt guessing.

import { audit } from "../../../lib/audit";
import { normalizeDob } from "../../../lib/dob";
import { createPatientSession, normalizeBookingCode, patientSessionCookie } from "../../../lib/patient-auth";
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
  if (!phoneNormalized || !dob || !bookingCode) {
    return Response.json({ error: "Вкажіть номер телефону, дату народження та номер заявки" }, { status: 400 });
  }

  if (await isRateLimited(db, request, `patient-login:${phoneNormalized}`, 8, 15)) {
    return Response.json({ error: "Забагато спроб. Спробуйте пізніше." }, { status: 429 });
  }

  // All three facts must belong to one real booking.
  const row = await db.prepare(
    `SELECT b.patient_id AS patientId, COALESCE(p.phone_normalized, '') AS profilePhone
     FROM bookings b
     LEFT JOIN patient_profiles p
       ON p.organization_id = b.organization_id AND p.patient_id = b.patient_id
     WHERE b.organization_id = ? AND b.phone_normalized = ? AND b.date_of_birth = ? AND b.code = ? LIMIT 1`,
  ).bind(PRIMARY_ORGANIZATION_ID, phoneNormalized, dob, bookingCode).first<{ patientId: string; profilePhone: string }>();

  if (!row) {
    await audit(db, {
      organizationId: PRIMARY_ORGANIZATION_ID,
      actorEmail: "patient",
      action: "patient_login_failed",
      resource: "patient_auth",
      targetId: bookingCode.slice(0, 12),
      details: { phone: maskedPhone(phoneNormalized) },
    });
    return Response.json(
      { error: "Дані не збігаються із записом. Перевірте номер телефону, дату народження та номер заявки." },
      { status: 401, headers: { "cache-control": "no-store" } },
    );
  }

  // Scope the session to the exact booking code (unambiguous — passes the
  // cabinet's fail-closed guard even when one phone+DOB has several records).
  // A historical booking still opens through its exact code, but only expands
  // into the whole immutable patient record when that record's current phone
  // still matches — mirroring the OTP booking-code identity rules.
  const patientId = row.patientId && row.profilePhone === phoneNormalized ? row.patientId : "";
  const rawToken = await createPatientSession(
    db,
    phoneNormalized,
    PRIMARY_ORGANIZATION_ID,
    { kind: "booking", value: bookingCode },
    patientId,
  );
  await audit(db, {
    organizationId: PRIMARY_ORGANIZATION_ID,
    actorEmail: "patient",
    action: "patient_login",
    resource: "patient_auth",
    targetId: bookingCode.slice(0, 12),
    details: { phone: maskedPhone(phoneNormalized), method: "booking_code" },
  });
  return Response.json(
    { ok: true },
    { headers: { "set-cookie": patientSessionCookie(rawToken), "cache-control": "no-store" } },
  );
}
