// Public GET exposes the primary department's generic payment link. POST starts a
// booking-bound manual payment for an OTP-authenticated patient only while the
// legacy payment destination remains primary-tenant scoped.

import { getSetting } from "../../../lib/settings";
import { dbBinding } from "../../../lib/db";
import { requirePatientSession } from "../../../lib/patient-auth";
import { createPendingPayment, latestPaymentForBooking } from "../../../lib/payments";
import { recordAnalyticsEvent } from "../../../lib/analytics";

const PRIMARY_ORGANIZATION_ID = 1;
const DEFAULT_PRIVAT24_PAY_LINK = 'https://irc.privatbank.ua/qrstickws/route/qr?type=nextfastpay&params=%7B%22token%22%3A%22cadc7a4d-d56c-4005-9cfe-04a96077f8c1%22%7D';

async function configuredPayLink(db: D1Database | null | undefined) {
  if (!db) return DEFAULT_PRIVAT24_PAY_LINK;
  return (await getSetting(db, "pay_link")) || DEFAULT_PRIVAT24_PAY_LINK;
}

export async function GET() {
  const db = dbBinding();
  return Response.json(
    { payLink: await configuredPayLink(db) },
    { headers: { "cache-control": "no-store" } },
  );
}

export async function POST(request: Request) {
  const db = dbBinding();
  if (!db) return Response.json({ error: "Сервіс тимчасово недоступний" }, { status: 503 });

  const session = await requirePatientSession(request, db);
  if (!session) return Response.json({ error: "Потрібне підтвердження номера телефону" }, { status: 401 });
  if (session.organizationId !== PRIMARY_ORGANIZATION_ID) {
    return Response.json(
      { error: "Онлайн-оплата ще не налаштована для цієї організації" },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }

  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const code = typeof body.code === "string" ? body.code.trim().toUpperCase().slice(0, 24) : "";
  if (!code) return Response.json({ error: "Не вказано заявку" }, { status: 400 });

  const identityClause = session.identityKind === "dob" ? "date_of_birth = ?" : "code = ?";
  const booking = await db.prepare(
    `SELECT id, code, service, service_code AS serviceCode, desired_date AS desiredDate,
      desired_time AS desiredTime, payment_status AS paymentStatus, payment_amount AS paymentAmount,
      paid_amount AS paidAmount, patient_category AS category, status
     FROM bookings
     WHERE organization_id = ? AND phone_normalized = ? AND code = ? AND ${identityClause} LIMIT 1`,
  ).bind(session.organizationId, session.phoneNormalized, code, session.identityValue).first<{
    id: number;
    code: string;
    service: string;
    serviceCode: string;
    desiredDate: string;
    desiredTime: string;
    paymentStatus: string;
    paymentAmount: number;
    paidAmount: number;
    category: string;
    status: string;
  }>();
  if (!booking) return Response.json({ error: "Заявку не знайдено" }, { status: 404 });
  if (booking.category !== "civilian" || booking.paymentAmount <= 0) {
    return Response.json({ error: "Для цієї заявки онлайн-оплата не потрібна" }, { status: 409 });
  }
  if (booking.paymentStatus === "paid" && booking.paidAmount === booking.paymentAmount) {
    return Response.json({ error: "Ця заявка вже повністю оплачена" }, { status: 409 });
  }
  if (["cancelled", "completed"].includes(booking.status)) {
    return Response.json({ error: "Ця заявка вже закрита" }, { status: 409 });
  }

  const providerReference = `manual:${booking.code}`;
  try {
    const pending = await createPendingPayment(db as never, {
      organizationId: session.organizationId,
      bookingId: booking.id,
      provider: "manual",
      currency: "UAH",
      providerReference,
    });
    const payment = await latestPaymentForBooking(db as never, session.organizationId, booking.id);
    await recordAnalyticsEvent(db, {
      eventName: "payment_started",
      organizationId: session.organizationId,
      serviceCode: booking.serviceCode,
      patientCategory: "civilian",
      source: "server",
    });
    return Response.json({
      booking: {
        code: booking.code,
        service: booking.service,
        serviceCode: booking.serviceCode,
        desiredDate: booking.desiredDate,
        desiredTime: booking.desiredTime,
        amount: booking.paymentAmount,
        currency: "UAH",
        paymentStatus: booking.paymentStatus,
      },
      payment,
      created: pending.created,
      payLink: await configuredPayLink(db),
      purpose: `Сплата за медичні послуги, заявка ${booking.code}: ${booking.service}`,
    }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message === "payment_already_settled") {
      return Response.json({ error: "Ця заявка вже повністю оплачена" }, { status: 409 });
    }
    if (message === "payment_reference_conflict") {
      return Response.json({ error: "Платіжний референс уже використано" }, { status: 409 });
    }
    console.error("payment_start_failed", booking.id, error);
    return Response.json({ error: "Не вдалося підготувати оплату" }, { status: 500 });
  }
}
