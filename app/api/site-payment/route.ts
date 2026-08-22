// Public payment entry point for a civilian booking (or a multi-study visit).
//
// GET /api/site-payment?codes=RD-...-002,RD-...-003
//   • If LiqPay keys are configured for the public organization, this renders an
//     auto-submitting form that redirects the payer to the LiqPay checkout with
//     the exact amount and the booking codes as order_id — so the amount is
//     pre-filled and, after payment, /api/liqpay-callback settles the bookings.
//   • Otherwise it falls back to the department's static PrivatBank link (the
//     payer types the amount), preserving the previous behavior.
//
// The amount is always computed server-side from the D1 booking rows; the query
// only names which bookings to pay, never how much.

import { dbBinding } from "../../../lib/db";
import { isRateLimited } from "../../../lib/rate-limit";
import { getOrganizationIntegrationSettings } from "../../../lib/settings";
import { buildLiqpayCheckout, encodeOrderId, LIQPAY_CHECKOUT_URL } from "../../../lib/liqpay";

const PUBLIC_ORGANIZATION_ID = 1;
const DEFAULT_PRIVAT24_PAY_LINK =
  "https://irc.privatbank.ua/qrstickws/route/qr?type=nextfastpay&params=%7B%22token%22%3A%22cadc7a4d-d56c-4005-9cfe-04a96077f8c1%22%7D";

function esc(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function parseCodes(raw: string | null): string[] {
  if (!raw) return [];
  return [...new Set(
    raw.split(",").map((code) => code.trim().toUpperCase().slice(0, 24)).filter((code) => /^[A-Z0-9-]{3,24}$/.test(code)),
  )].slice(0, 8);
}

function htmlResponse(body: string, status = 200) {
  return new Response(body, { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}

function redirect(url: string) {
  return new Response(null, { status: 302, headers: { location: url, "cache-control": "no-store" } });
}

function staticFallback(payLink: string) {
  const target = payLink || DEFAULT_PRIVAT24_PAY_LINK;
  return redirect(target);
}

export async function GET(request: Request) {
  const db = dbBinding();
  if (!db) return htmlResponse("<!doctype html><meta charset=utf-8><p>Сервіс тимчасово недоступний.</p>", 503);

  if (await isRateLimited(db, request, "site-payment", 30, 10)) {
    return htmlResponse("<!doctype html><meta charset=utf-8><p>Забагато спроб. Спробуйте за хвилину.</p>", 429);
  }

  const url = new URL(request.url);
  const codes = parseCodes(url.searchParams.get("codes") || url.searchParams.get("code"));
  const settings = await getOrganizationIntegrationSettings(db, PUBLIC_ORGANIZATION_ID, [
    "liqpay_public_key", "liqpay_private_key", "pay_link",
  ]);
  const publicKey = settings.liqpay_public_key || "";
  const privateKey = settings.liqpay_private_key || "";
  const payLink = settings.pay_link || "";

  if (!codes.length) return staticFallback(payLink);

  // Amount is authoritative: sum the unpaid, civilian bookings named by the codes.
  const placeholders = codes.map(() => "?").join(",");
  const rows = await db.prepare(
    `SELECT code, service, payment_amount AS amount, payment_status AS paymentStatus,
            paid_amount AS paidAmount, patient_category AS category
     FROM bookings
     WHERE organization_id = ? AND code IN (${placeholders})`,
  ).bind(PUBLIC_ORGANIZATION_ID, ...codes).all<{
    code: string; service: string; amount: number; paymentStatus: string; paidAmount: number; category: string;
  }>();

  const payable = (rows.results || []).filter((row) =>
    row.category === "civilian" && row.amount > 0 && !(row.paymentStatus === "paid" && row.paidAmount === row.amount));
  const total = payable.reduce((sum, row) => sum + row.amount, 0);

  if (!payable.length || total <= 0) return staticFallback(payLink);

  // No LiqPay keys → keep the previous static-QR behavior.
  if (!publicKey || !privateKey) return staticFallback(payLink);

  const orderCodes = payable.map((row) => row.code);
  const orderId = encodeOrderId(orderCodes);
  const description = `Сплата за медичні послуги, заявка ${orderCodes.join(", ")}`;
  const { data, signature } = await buildLiqpayCheckout({
    publicKey,
    privateKey,
    amount: total,
    currency: "UAH",
    description,
    orderId,
    resultUrl: `${url.origin}/site/cabinet.html?paid=1`,
    serverUrl: `${url.origin}/api/liqpay-callback`,
  });

  return htmlResponse(
    `<!doctype html><html lang="uk"><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<title>Перенаправлення на оплату…</title></head>` +
    `<body style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;text-align:center;padding:48px 20px;color:#123d3a">` +
    `<p>Переходимо до оплати <strong>${esc(String(total))} грн</strong> у ПриватБанк…</p>` +
    `<form id="liqpay" method="POST" action="${LIQPAY_CHECKOUT_URL}" accept-charset="utf-8">` +
    `<input type="hidden" name="data" value="${esc(data)}">` +
    `<input type="hidden" name="signature" value="${esc(signature)}">` +
    `<noscript><button type="submit" style="padding:12px 20px;background:#123d3a;color:#fff;border:0;border-radius:10px;font-size:16px">Перейти до оплати</button></noscript>` +
    `</form><script>document.getElementById('liqpay').submit();</script></body></html>`,
  );
}
