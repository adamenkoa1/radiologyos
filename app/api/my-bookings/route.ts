import {
  clearedPatientSessionCookie,
  destroyPatientSession,
  requirePatientSession,
} from "../../../lib/patient-auth";
import { isRateLimited } from "../../../lib/rate-limit";
import { stateLabel } from "../../../lib/study-state";
import { dbBinding } from "../../../lib/db";

export async function POST(request: Request) {
  const db = dbBinding();
  if (!db) return Response.json({ error: "Сервіс тимчасово недоступний" }, { status: 503 });
  if (await isRateLimited(db, request, "patient-cabinet", 20, 15)) {
    return Response.json({ error: "Забагато запитів. Повторіть пізніше." }, { status: 429 });
  }

  const session = await requirePatientSession(request, db);
  if (!session) {
    return Response.json({ error: "Сесію не підтверджено. Отримайте одноразовий код ще раз." }, { status: 401 });
  }

  const identityClause = session.identityKind === "dob"
    ? "b.date_of_birth = ?"
    : "b.code = ?";
  const whereClause = session.patientId
    ? "b.organization_id = ? AND b.patient_id = ?"
    : `b.organization_id = ? AND b.phone_normalized = ? AND ${identityClause}`;
  const bindings = session.patientId
    ? [session.organizationId, session.patientId]
    : [session.organizationId, session.phoneNormalized, session.identityValue];
  const rows = await db.prepare(
    `SELECT b.code, b.name AS patientName, b.service, b.service_code AS serviceCode,
       b.desired_date AS desiredDate, b.desired_time AS desiredTime,
       b.status, b.created_at AS createdAt, b.patient_category AS category,
       b.payment_status AS paymentStatus, b.payment_amount AS paymentAmount,
       b.paid_amount AS paidAmount, b.payment_method AS paymentMethod,
       COALESCE(o.name, '') AS organization,
       CASE WHEN b.protocol_status = 'issued' THEN 1 ELSE 0 END AS hasProtocol,
       (SELECT pt.id FROM payment_transactions pt
         WHERE pt.organization_id = b.organization_id AND pt.booking_id = b.id
         ORDER BY pt.id DESC LIMIT 1) AS paymentTransactionId,
       COALESCE((SELECT pt.status FROM payment_transactions pt
         WHERE pt.organization_id = b.organization_id AND pt.booking_id = b.id
         ORDER BY pt.id DESC LIMIT 1), '') AS paymentTransactionStatus,
       COALESCE((SELECT pt.provider FROM payment_transactions pt
         WHERE pt.organization_id = b.organization_id AND pt.booking_id = b.id
         ORDER BY pt.id DESC LIMIT 1), '') AS paymentProvider,
       COALESCE((SELECT pt.provider_reference FROM payment_transactions pt
         WHERE pt.organization_id = b.organization_id AND pt.booking_id = b.id
         ORDER BY pt.id DESC LIMIT 1), '') AS paymentReference
     FROM bookings b LEFT JOIN organizations o ON o.id = b.organization_id
     WHERE ${whereClause}
     ORDER BY b.created_at DESC, b.id DESC
     LIMIT 50`
  ).bind(...bindings).all();

  const bookings = (rows.results || []).map((row) => ({
    ...row,
    hasProtocol: Number((row as { hasProtocol: number }).hasProtocol) === 1,
    statusLabel: stateLabel(String((row as { status: string }).status)),
  }));

  return Response.json(
    { bookings },
    { headers: { "cache-control": "no-store" } },
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
