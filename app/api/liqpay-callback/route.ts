// LiqPay server callback (server_url). LiqPay POSTs form-encoded `data` +
// `signature` after a payment. We verify the signature with our private key,
// and on a paid status settle every civilian booking named in order_id through
// the verified-provider ledger path (finance document + booking flip), so online
// and desk payments post identically. Amounts are authoritative from D1 — the
// callback's signed total must cover them. Idempotent and replay-safe. Always
// answers 200 so LiqPay stops retrying.

import { dbBinding } from "../../../lib/db";
import { getOrganizationIntegrationSetting } from "../../../lib/settings";
import { decodeOrderId, verifyLiqpayCallback } from "../../../lib/liqpay";
import { settleVerifiedProviderPayment } from "../../../lib/payment-settlement";
import { recordAnalyticsEvent } from "../../../lib/analytics";

const PUBLIC_ORGANIZATION_ID = 1;

const ok = () => new Response("ok", { status: 200, headers: { "cache-control": "no-store" } });
const retryableFailure = () => new Response("temporarily unavailable", {
  status: 503,
  headers: { "cache-control": "no-store", "retry-after": "5" },
});

export async function POST(request: Request) {
  const db = dbBinding();
  if (!db) return retryableFailure();

  let data = "";
  let signature = "";
  try {
    const form = await request.formData();
    data = String(form.get("data") || "");
    signature = String(form.get("signature") || "");
  } catch {
    return ok();
  }
  if (!data || !signature) return ok();

  let privateKey = "";
  try {
    privateKey = await getOrganizationIntegrationSetting(db, PUBLIC_ORGANIZATION_ID, "liqpay_private_key") || "";
  } catch {
    console.error("liqpay_callback_config_lookup_failed");
    return retryableFailure();
  }
  const result = await verifyLiqpayCallback(privateKey, data, signature);
  if (!result.ok) {
    console.warn("liqpay_callback_bad_signature");
    return ok();
  }
  if (!result.paid) return ok();

  const codes = decodeOrderId(result.orderId);
  if (!codes.length) return ok();

  const placeholders = codes.map(() => "?").join(",");
  let rows;
  try {
    rows = await db.prepare(
      `SELECT id, code, service_code AS serviceCode, payment_amount AS amount, payment_status AS paymentStatus,
              paid_amount AS paidAmount, patient_category AS category
       FROM bookings WHERE organization_id = ? AND code IN (${placeholders})`,
    ).bind(PUBLIC_ORGANIZATION_ID, ...codes).all<{
      id: number; code: string; serviceCode: string; amount: number; paymentStatus: string; paidAmount: number; category: string;
    }>();
  } catch {
    console.error("liqpay_callback_booking_lookup_failed");
    return retryableFailure();
  }

  const payable = (rows.results || []).filter((row) =>
    row.category === "civilian" && row.amount > 0 && !(row.paymentStatus === "paid" && row.paidAmount === row.amount));
  const expected = payable.reduce((sum, row) => sum + row.amount, 0);
  if (expected <= 0) return ok();

  // The signed amount from LiqPay must cover what we are about to settle.
  if (result.amount + 0.5 < expected) {
    console.warn("liqpay_amount_short", result.amount, expected);
    return ok();
  }

  let settlementFailed = false;
  const settled = [];
  for (const row of payable) {
    try {
      await settleVerifiedProviderPayment(db as never, {
        organizationId: PUBLIC_ORGANIZATION_ID,
        bookingId: row.id,
        provider: "liqpay",
        providerReference: `liqpay:${row.code}`,
        amount: row.amount,
        actor: "online:liqpay",
      });
      settled.push(row);
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (message === "payment_already_settled") continue;
      settlementFailed = true;
      console.error("liqpay_settle_failed", row.id);
    }
  }

  // If one booking could not be persisted, let the provider retry the whole
  // signed callback. Earlier rows are safe to replay through the idempotent
  // settlement function; analytics waits until every payable row is settled.
  if (settlementFailed) return retryableFailure();

  for (const row of settled) {
    try {
      await recordAnalyticsEvent(db, {
        eventName: "payment_completed",
        organizationId: PUBLIC_ORGANIZATION_ID,
        serviceCode: row.serviceCode,
        patientCategory: "civilian",
        source: "server",
      });
    } catch {
      // Analytics is best-effort and must not turn a persisted payment into a
      // retryable callback (which could duplicate analytics events on replay).
      console.warn("liqpay_payment_analytics_failed");
    }
  }
  return ok();
}
