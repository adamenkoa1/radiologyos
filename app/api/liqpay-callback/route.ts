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

export async function POST(request: Request) {
  const db = dbBinding();
  if (!db) return ok();

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

  const privateKey = await getOrganizationIntegrationSetting(db, PUBLIC_ORGANIZATION_ID, "liqpay_private_key");
  const result = await verifyLiqpayCallback(privateKey || "", data, signature);
  if (!result.ok) {
    console.warn("liqpay_callback_bad_signature");
    return ok();
  }
  if (!result.paid) return ok();

  const codes = decodeOrderId(result.orderId);
  if (!codes.length) return ok();

  const placeholders = codes.map(() => "?").join(",");
  const rows = await db.prepare(
    `SELECT id, code, service_code AS serviceCode, payment_amount AS amount, payment_status AS paymentStatus,
            paid_amount AS paidAmount, patient_category AS category
     FROM bookings WHERE organization_id = ? AND code IN (${placeholders})`,
  ).bind(PUBLIC_ORGANIZATION_ID, ...codes).all<{
    id: number; code: string; serviceCode: string; amount: number; paymentStatus: string; paidAmount: number; category: string;
  }>();

  const payable = (rows.results || []).filter((row) =>
    row.category === "civilian" && row.amount > 0 && !(row.paymentStatus === "paid" && row.paidAmount === row.amount));
  const expected = payable.reduce((sum, row) => sum + row.amount, 0);
  if (expected <= 0) return ok();

  // The signed amount from LiqPay must cover what we are about to settle.
  if (result.amount + 0.5 < expected) {
    console.warn("liqpay_amount_short", result.amount, expected);
    return ok();
  }

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
      await recordAnalyticsEvent(db, {
        eventName: "payment_settled",
        organizationId: PUBLIC_ORGANIZATION_ID,
        serviceCode: row.serviceCode,
        patientCategory: "civilian",
        source: "server",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (message === "payment_already_settled") continue;
      console.error("liqpay_settle_failed", row.code, error);
    }
  }
  return ok();
}
