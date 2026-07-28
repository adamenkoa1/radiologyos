// Patient self-service: return the finalized radiology protocol for one booking,
// gated behind the booking code + phone (two factors) and only once the protocol
// has been officially issued to the patient.

import { isRateLimited } from "../../../lib/rate-limit";

function dbBinding() {
  return (globalThis as typeof globalThis & { __RADIOLOGY_DB__?: D1Database }).__RADIOLOGY_DB__;
}

export async function POST(request: Request) {
  const db = dbBinding();
  if (!db) return Response.json({ error: "Сервіс тимчасово недоступний" }, { status: 503 });
  if (await isRateLimited(db, request, "my-protocol", 12, 15)) {
    return Response.json({ error: "Забагато спроб. Повторіть пізніше." }, { status: 429 });
  }

  const body = await request.json().catch(() => ({})) as { code?: string; phoneLast4?: string };
  const code = (body.code || "").trim().toUpperCase().slice(0, 20);
  const phoneLast4 = (body.phoneLast4 || "").replace(/\D/g, "").slice(-4);
  if (!/^RD-[A-Z0-9]{8}$/.test(code) || phoneLast4.length !== 4) {
    return Response.json({ error: "Перевірте код і останні 4 цифри телефону" }, { status: 400 });
  }

  const booking = await db.prepare(
    `SELECT id, name, service, protocol_status AS protocolStatus, protocol_issued_at AS issuedAt
     FROM bookings WHERE code = ? AND substr(phone_normalized, -4) = ? LIMIT 1`
  ).bind(code, phoneLast4).first<{
    id: number; name: string; service: string; protocolStatus: string; issuedAt: string;
  }>();
  if (!booking) return Response.json({ error: "Заявку не знайдено" }, { status: 404 });
  if (booking.protocolStatus !== "issued") {
    return Response.json({ error: "Протокол ще не готовий" }, { status: 409 });
  }

  const proto = await db.prepare(
    `SELECT number, method, findings, conclusion, recommendations
     FROM protocols WHERE booking_id = ? LIMIT 1`
  ).bind(booking.id).first<{
    number: string; method: string; findings: string; conclusion: string; recommendations: string;
  }>();
  if (!proto) return Response.json({ error: "Протокол ще не готовий" }, { status: 409 });

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
  });
}
