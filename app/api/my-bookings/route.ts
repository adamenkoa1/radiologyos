import {
  clearedPatientSessionCookie,
  createPatientSession,
  destroyPatientSession,
  normalizeBookingCode,
  patientSessionCookie,
} from "../../../lib/patient-auth";
import { normalizeUkrainianPhone } from "../../../lib/phone";
import { isRateLimited } from "../../../lib/rate-limit";
import { publicTenant } from "../../../lib/tenant";

function dbBinding() {
  return (globalThis as typeof globalThis & { __RADIOLOGY_DB__?: D1Database }).__RADIOLOGY_DB__;
}

export async function POST(request: Request) {
  const db = dbBinding();
  if (!db) return Response.json({ error: "Сервіс тимчасово недоступний" }, { status: 503 });
  const tenant = publicTenant();
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
    `SELECT id FROM bookings
     WHERE organization_id = ? AND code = ? AND phone_normalized = ?
     LIMIT 1`
  ).bind(tenant.organizationId, code, phoneNormalized).first();
  if (!proof) {
    return Response.json({ error: "Не вдалося підтвердити номер телефону або код заявки" }, { status: 401 });
  }

  const rows = await db.prepare(
    `SELECT code, service, desired_date AS desiredDate, desired_time AS desiredTime,
       status, created_at AS createdAt, patient_category AS category,
       payment_status AS paymentStatus, payment_amount AS paymentAmount,
       CASE WHEN protocol_status = 'issued' THEN 1 ELSE 0 END AS hasProtocol
     FROM bookings WHERE organization_id = ? AND phone_normalized = ?
     ORDER BY created_at DESC, id DESC
     LIMIT 50`
  ).bind(tenant.organizationId, phoneNormalized).all();

  const bookings = (rows.results || []).map((row) => ({
    ...row,
    hasProtocol: Number((row as { hasProtocol: number }).hasProtocol) === 1,
  }));
  const rawToken = await createPatientSession(db, phoneNormalized, tenant.organizationId);
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
