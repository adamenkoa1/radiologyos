import { audit } from "../../../lib/audit";
import {
  normalizeBookingCode,
  patientSessionScopeIsUnambiguous,
  requirePatientSession,
} from "../../../lib/patient-auth";
import { isRateLimited } from "../../../lib/rate-limit";
import { dbBinding } from "../../../lib/db";

export async function POST(request: Request) {
  const db = dbBinding();
  if (!db) return Response.json({ error: "Сервіс тимчасово недоступний" }, { status: 503 });
  if (await isRateLimited(db, request, "my-protocol", 12, 15)) {
    return Response.json({ error: "Забагато спроб. Повторіть пізніше." }, { status: 429 });
  }
  const session = await requirePatientSession(request, db);
  if (!session) return Response.json({ error: "Сесію завершено. Увійдіть до кабінету повторно." }, { status: 401 });
  if (!await patientSessionScopeIsUnambiguous(db, session)) {
    return Response.json(
      { error: "За цим номером і датою народження знайдено кілька записів. Увійдіть за кодом конкретної заявки." },
      { status: 409, headers: { "cache-control": "no-store" } },
    );
  }

  const body = await request.json().catch(() => ({})) as { code?: string };
  const code = normalizeBookingCode(body.code);
  if (!code) return Response.json({ error: "Некоректний код заявки" }, { status: 400 });

  const identityClause = session.identityKind === "dob" ? "date_of_birth = ?" : "code = ?";
  const whereClause = session.patientId
    ? "organization_id = ? AND code = ? AND patient_id = ?"
    : `organization_id = ? AND code = ? AND phone_normalized = ? AND ${identityClause}`;
  const bindings = session.patientId
    ? [session.organizationId, code, session.patientId]
    : [session.organizationId, code, session.phoneNormalized, session.identityValue];
  const booking = await db.prepare(
    `SELECT id, name, service, protocol_status AS protocolStatus, protocol_issued_at AS issuedAt
     FROM bookings
     WHERE ${whereClause} LIMIT 1`
  ).bind(...bindings).first<{
    id: number; name: string; service: string; protocolStatus: string; issuedAt: string;
  }>();
  if (!booking) return Response.json({ error: "Заявку не знайдено" }, { status: 404 });
  if (booking.protocolStatus !== "issued") {
    return Response.json({ error: "Протокол ще не готовий" }, { status: 409 });
  }

  const proto = await db.prepare(
    `SELECT number, method, findings, conclusion, recommendations
     FROM protocols WHERE organization_id = ? AND booking_id = ? AND status = 'issued' LIMIT 1`
  ).bind(session.organizationId, booking.id).first<{
    number: string; method: string; findings: string; conclusion: string; recommendations: string;
  }>();
  if (!proto) return Response.json({ error: "Протокол ще не готовий" }, { status: 409 });

  await audit(db, {
    organizationId: session.organizationId,
    actorEmail: "patient_session",
    action: "patient_protocol_viewed",
    resource: "protocol",
    targetId: booking.id,
    details: { channel: "patient_cabinet", identityKind:session.patientId ? "patient_id" : session.identityKind },
  });

  return Response.json({
    protocol: {
      patient: booking.name,
      service: booking.service,
      issuedAt: booking.issuedAt,
      number: proto.number,
      method: proto.method,
      findings: proto.findings,
      conclusion: proto.conclusion,
      recommendations: proto.recommendations,
    },
  }, { headers: { "cache-control": "no-store" } });
}
