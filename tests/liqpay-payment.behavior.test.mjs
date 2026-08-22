import assert from "node:assert/strict";
import test from "node:test";
import { withD1, callWorker } from "./helpers/d1.mjs";
import {
  buildLiqpayCheckout,
  encodeLiqpayData,
  liqpaySignature,
  verifyLiqpayCallback,
  encodeOrderId,
  decodeOrderId,
} from "../lib/liqpay.ts";

const PUBLIC_KEY = "sandbox_i12345678901";
const PRIVATE_KEY = "sandbox_secret_key_abcdef0123456789";

async function seedBooking(db, { code, amount = 800, time = "11:00" }) {
  const result = await db.prepare(
    `INSERT INTO bookings (
      organization_id, code, name, phone, phone_normalized, service, service_code,
      equipment_id, duration_minutes, desired_date, desired_time, patient_category,
      payment_status, payment_amount, paid_amount, status
    ) VALUES (1, ?, 'Пацієнт', '+380501112233', '380501112233', 'КТ ОГК', '407',
      'ct', 30, '2026-08-25', ?, 'civilian', 'pending', ?, 0, 'confirmed')`,
  ).bind(code, time, amount).run();
  return Number(result.meta.last_row_id);
}

function callbackRequest(data, signature) {
  return new Request("http://localhost/api/liqpay-callback", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ data, signature }).toString(),
  });
}

async function setKeys(db) {
  for (const [key, value] of [["liqpay_public_key", PUBLIC_KEY], ["liqpay_private_key", PRIVATE_KEY]]) {
    await db.prepare(
      `INSERT INTO organization_integration_settings (organization_id, key, value, updated_by)
       VALUES (1, ?, ?, 'test')
       ON CONFLICT(organization_id, key) DO UPDATE SET value = excluded.value`,
    ).bind(key, value).run();
  }
}

test("LiqPay signing round-trips: a callback signed with our key verifies and reports paid", async () => {
  const { data, signature } = await buildLiqpayCheckout({
    publicKey: PUBLIC_KEY, privateKey: PRIVATE_KEY, amount: 800,
    description: "тест", orderId: encodeOrderId(["RD-1", "RD-2"]),
    resultUrl: "https://x/y", serverUrl: "https://x/cb",
  });
  assert.ok(data && signature);
  assert.deepEqual(decodeOrderId(encodeOrderId(["rd-1", "RD-2"])), ["RD-1", "RD-2"]);

  // A callback the gateway would send for this order.
  const callbackData = encodeLiqpayData({ status: "success", order_id: encodeOrderId(["RD-1"]), amount: 800 });
  const callbackSig = await liqpaySignature(PRIVATE_KEY, callbackData);
  const good = await verifyLiqpayCallback(PRIVATE_KEY, callbackData, callbackSig);
  assert.equal(good.ok, true);
  assert.equal(good.paid, true);
  assert.equal(good.orderId, "RD-1");
  // A tampered signature never verifies.
  const bad = await verifyLiqpayCallback(PRIVATE_KEY, callbackData, "not-a-signature");
  assert.equal(bad.ok, false);
  assert.equal(bad.paid, false);
});

test("site-payment renders a signed LiqPay checkout for the exact server-side amount", async () => {
  await withD1(async (db) => {
    await setKeys(db);
    await seedBooking(db, { code: "RD-PAY-1", amount: 800, time: "11:00" });
    await seedBooking(db, { code: "RD-PAY-2", amount: 250, time: "12:00" });
    const res = await callWorker(
      new Request("http://localhost/api/site-payment?codes=RD-PAY-1,RD-PAY-2", { headers: { "cf-connecting-ip": "203.0.113.9" } }),
      db,
    );
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.match(html, /liqpay\.ua\/api\/3\/checkout/);
    assert.match(html, /name="data"/);
    assert.match(html, /name="signature"/);
    // Total (800 + 250) shown to the payer.
    assert.match(html, /1050 грн/);
  });
});

test("site-payment falls back to the static PrivatBank QR when LiqPay keys are absent", async () => {
  await withD1(async (db) => {
    await seedBooking(db, { code: "RD-NOLP-1", amount: 800 });
    const res = await callWorker(
      new Request("http://localhost/api/site-payment?codes=RD-NOLP-1", { headers: { "cf-connecting-ip": "203.0.113.10" } }),
      db,
    );
    assert.equal(res.status, 302);
    assert.match(res.headers.get("location") || "", /privatbank\.ua/);
  });
});

test("a verified LiqPay callback settles the booking; a forged one does not", async () => {
  await withD1(async (db) => {
    await setKeys(db);
    const bookingId = await seedBooking(db, { code: "RD-CB-1", amount: 800 });

    // Forged signature — booking stays pending.
    const data = encodeLiqpayData({ status: "success", order_id: "RD-CB-1", amount: 800 });
    const forgedRes = await callWorker(callbackRequest(data, "forged"), db);
    assert.equal(forgedRes.status, 200);
    let row = await db.prepare("SELECT payment_status AS s, paid_amount AS p FROM bookings WHERE id = ?").bind(bookingId).first();
    assert.equal(row.s, "pending");

    // Properly signed success — booking becomes paid for the exact amount.
    const signature = await liqpaySignature(PRIVATE_KEY, data);
    assert.equal((await callWorker(callbackRequest(data, signature), db)).status, 200);
    row = await db.prepare("SELECT payment_status AS s, paid_amount AS p FROM bookings WHERE id = ?").bind(bookingId).first();
    assert.equal(row.s, "paid");
    assert.equal(Number(row.p), 800);

    // Replaying the same callback is a no-op (still paid, no double-posting).
    assert.equal((await callWorker(callbackRequest(data, signature), db)).status, 200);
    const paidCount = await db.prepare(
      "SELECT COUNT(*) AS n FROM payment_transactions WHERE organization_id = 1 AND booking_id = ? AND status = 'paid'",
    ).bind(bookingId).first();
    assert.equal(Number(paidCount.n), 1);
  });
});
