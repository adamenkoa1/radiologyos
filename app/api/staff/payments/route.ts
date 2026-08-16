import { recordAnalyticsEvent } from "../../../../lib/analytics";
import { dbBinding } from "../../../../lib/db";
import { recordManualPayment, latestPaymentForBooking } from "../../../../lib/payments";
import { refundLatestPayment } from "../../../../lib/payment-settlement";
import { canAccessBooking, canManageFinance } from "../../../../lib/staff-auth";
import { requireOrgContext } from "../../../../lib/tenant";

const PAYMENT_METHODS = new Set(["cash", "card", "bank_transfer", "privat_link", "other"]);

function clean(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

async function financeContext(request: Request) {
  const db = dbBinding();
  if (!db) return { response: Response.json({ error: "База тимчасово недоступна" }, { status: 503 }) } as const;
  const ctx = await requireOrgContext(request, db);
  if (!ctx) return { response: Response.json({ error: "Доступ лише для персоналу" }, { status: 403 }) } as const;
  if (!canManageFinance(ctx.member.role)) {
    return { response: Response.json({ error: "Розрахунки може змінювати лише реєстратор або адміністратор" }, { status: 403 }) } as const;
  }
  return { db, ctx } as const;
}

export async function POST(request: Request) {
  const auth = await financeContext(request);
  if ("response" in auth) return auth.response;
  const { db, ctx } = auth;

  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const bookingId = Number(body.bookingId);
  const method = clean(body.method, 40);
  const providerReference = clean(body.providerReference, 160);
  if (!Number.isInteger(bookingId) || bookingId <= 0 || !PAYMENT_METHODS.has(method)) {
    return Response.json({ error: "Некоректні дані оплати" }, { status: 400 });
  }
  if (!(await canAccessBooking(db, ctx.member, bookingId, ctx.organizationId))) {
    return Response.json({ error: "Заявку не знайдено" }, { status: 404 });
  }

  try {
    const result = await recordManualPayment(db as never, {
      organizationId: ctx.organizationId,
      bookingId,
      actor: ctx.member.email,
      method,
      providerReference,
    });
    if (result.changed) {
      await recordAnalyticsEvent(db, {
        eventName: "payment_completed",
        organizationId: ctx.organizationId,
        serviceCode: result.booking.serviceCode,
        patientCategory: result.booking.patientCategory === "military" ? "military" : "civilian",
        source: "server",
      });
    }
    const payment = await latestPaymentForBooking(db as never, ctx.organizationId, bookingId);
    return Response.json({
      ok: true,
      created: result.created,
      payment,
      paymentStatus: "paid",
      paidAmount: result.booking.paymentAmount,
      documentId: result.documentId,
      legacy: result.legacy,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message === "booking_not_found") return Response.json({ error: "Заявку не знайдено" }, { status: 404 });
    if (message === "invalid_booking_amount") {
      return Response.json({ error: "Для цієї заявки не визначено коректну суму до сплати" }, { status: 409 });
    }
    if (message === "payment_reference_conflict") {
      return Response.json({ error: "Цей платіжний референс уже прив’язаний до іншої оплати або повернення" }, { status: 409 });
    }
    console.error("payment_reconciliation_failed", bookingId, error);
    return Response.json({ error: "Не вдалося підтвердити оплату" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const auth = await financeContext(request);
  if ("response" in auth) return auth.response;
  const { db, ctx } = auth;

  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const bookingId = Number(body.bookingId);
  if (!Number.isInteger(bookingId) || bookingId <= 0) {
    return Response.json({ error: "Некоректна заявка" }, { status: 400 });
  }
  if (!(await canAccessBooking(db, ctx.member, bookingId, ctx.organizationId))) {
    return Response.json({ error: "Заявку не знайдено" }, { status: 404 });
  }

  try {
    const refund = await refundLatestPayment(db as never, {
      organizationId: ctx.organizationId,
      bookingId,
      actor: ctx.member.email,
    });
    const payment = await latestPaymentForBooking(db as never, ctx.organizationId, bookingId);
    return Response.json({
      ok: true,
      changed: refund.changed,
      payment,
      paymentStatus: "refunded",
      paidAmount: 0,
      documentId: refund.documentId,
      legacy: refund.legacy,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message === "booking_not_found") return Response.json({ error: "Заявку не знайдено" }, { status: 404 });
    if (message === "paid_payment_not_found") {
      return Response.json({ error: "Немає підтвердженої оплати для повернення" }, { status: 409 });
    }
    if (message === "payment_reference_conflict") {
      return Response.json({ error: "Повернення конфліктує з уже проведеним фінансовим документом" }, { status: 409 });
    }
    console.error("payment_refund_failed", bookingId, error);
    return Response.json({ error: "Не вдалося оформити повернення" }, { status: 500 });
  }
}
