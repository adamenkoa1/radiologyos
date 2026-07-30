import {
  clearedPatientSessionCookie,
  createPatientSession,
  destroyPatientSession,
  normalizeBookingCode,
  patientSessionCookie,
} from "../../../lib/patient-auth";
import { normalizeUkrainianPhone } from "../../../lib/phone";
import { isRateLimited } from "../../../lib/rate-limit";
import { stateLabel } from "../../../lib/study-state";

function dbBinding() {
  return (globalThis as typeof globalThis & { __RADIOLOGY_DB__?: D1Database }).__RADIOLOGY_DB__;
}

export async function POST(request: Request) {
  const db = dbBinding();
  if (!db) return Response.json({ error: "Сервіс тимчасово недоступний" }, { status: 503 });
  if (await isRateLimited(db, request, "patient-login", 8, 15)) {
    return Response.json({ error: "Забагато спроб. Повторіть перевірку пізніше." }, { status: 429 });
  }

  const body = await request.json().catch(() => ({})) as { phone?: string; code?: string };
  const phoneNormalized = normalizeUkrainianPhone(String(body.phone || ""));
  const code = normalizeBookingCode(body.code);
  if (!phoneNormalized || !code) {
    return Response.json({ error: "Введіть повний номер телефону та код заявки" }, { status: 400 });
  }

  const proof = await db.prepare(
    "SELECT id FROM bookings WHERE code = ? AND phone_normalized = ? LIMIT 1"
  ).bind(code, phoneNormalized).first();
  if (!proof) {
    return Response.json({ error: "Не вдалося підтвердити номер телефону або код заявки" }, { status: 401 });
  }

  const rows = await db.prepare(
    `SELECT b.code, b.service, b.desired_date AS desiredDate, b.desired_time AS desiredTime,
       b.status, b.created_at AS createdAt, b.patient_category AS category,
       b.payment_status AS paymentStatus, b.payment_amount AS paymentAmount,
       COALESCE(o.name, '') AS organization,
       CASE WHEN b.protocol_status = 'issued' THEN 1 ELSE 0 END AS hasProtocol
     FROM bookings b LEFT JOIN organizations o ON o.id = b.organization_id
     WHERE b.phone_normalized = ?
     ORDER BY b.created_at DESC, b.id DESC
     LIMIT 50`
  ).bind(phoneNormalized).all();

  const bookings = (rows.results || []).map((row) => ({
    ...row,
    hasProtocol: Number((row as { hasProtocol: number }).hasProtocol) === 1,
    // Людський підпис стану дослідження для пацієнта.
    statusLabel: stateLabel(String((row as { status: string }).status)),
  }));
  const rawToken = await createPatientSession(db, phoneNormalized);
  return Response.json(
    { bookings },
    {
      headers: {
        "set-cookie": patientSessionCookie(rawToken),
        "cache-control": "no-store",
      },
    },
  );
}

export async function DELETE(request: Request) {
  const db = dbBinding();
  if (db) await destroyPatientSession(request, db);
  return Response.json(
    { ok: true },
    { headers: { "set-cookie": clearedPatientSessionCookie(), "cache-control": "no-store" } },
  );
}
