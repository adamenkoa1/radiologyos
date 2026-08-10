import { dbBinding } from "../../../../lib/db";
import { recordManualPayment, latestPaymentForBooking } from "../../../../lib/payments";
import { canAccessBooking, canManageFinance } from "../../../../lib/staff-auth";
import { requireOrgContext } from "../../../../lib/tenant";

const PAYMENT_METHODS = new Set(["cash", "card", "bank_transfer", "privat_link", "other"]);

function clean(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export async function POST(request: Request) {
  const db = dbBinding();
  if (!db) return Response.json({ error: "База тимчасово недоступна" }, { status: 503 });

  const ctx = await requireOrgContext(request, db);
  if (!ctx) return Response.json({ error: "Доступ лише для персоналу" }, { status: 403 });
  if (!canManageFinance(ctx.member.role)) {
    return Response.json({ error: "Підтверджувати оплату може лише реєстратор або адміністратор" }, { status: 403 });
  }

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
    const payment = await latestPaymentForBooking(db as never, ctx.organizationId, bookingId);
    return Response.json({
      ok: true,
      created: result.created,
      payment,
      paymentStatus: "paid",
      paidAmount: result.booking.paymentAmount,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message === "booking_not_found") return Response.json({ error: "Заявку не знайдено" }, { status: 404 });
    if (message === "invalid_booking_amount") {
      return Response.json({ error: "Для цієї заявки не визначено коректну суму до сплати" }, { status: 409 });
    }
    if (message === "payment_reference_conflict") {
      return Response.json({ error: "Цей платіжний референс уже прив’язаний до іншої оплати" }, { status: 409 });
    }
    console.error("payment_reconciliation_failed", bookingId, error);
    return Response.json({ error: "Не вдалося підтвердити оплату" }, { status: 500 });
  }
}
