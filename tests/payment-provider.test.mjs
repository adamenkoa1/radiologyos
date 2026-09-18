import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createPaymentProvider, isPaymentProviderName } from "../lib/providers/payment.ts";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

// Провайдер добирається за назвою; невідома назва → безпечний none.
test("payment provider resolves by known name, defaults to none", () => {
  assert.ok(isPaymentProviderName("manual") && isPaymentProviderName("liqpay"));
  assert.ok(!isPaymentProviderName("bitcoin"));
  assert.equal(createPaymentProvider().name, "none");
  assert.equal(createPaymentProvider({ provider: "bitcoin" }).name, "none");
  assert.equal(createPaymentProvider({ provider: "manual" }).name, "manual");
});

// Ручна оплата: сконфігурована, звірка вручну, детермінований референс.
test("manual provider supports reconciliation and returns a deterministic reference", async () => {
  const manual = createPaymentProvider({ provider: "manual", currency: "uah" });
  const d = manual.describe();
  assert.equal(d.configured, true);
  assert.equal(d.currency, "UAH");
  assert.deepEqual(d.capabilities, { onlineCharge: false, manualReconciliation: true });
  const charge = await manual.createCharge({ amount: 100, currency: "UAH", reference: "AB12" });
  assert.equal(charge.id, "manual-AB12");
});

// LiqPay: онлайн-можливість заявлена; «сконфігуровано» лише з ключем; charge —
// заглушка до інтеграції.
test("liqpay reports online capability, configured only with a key, charge stubbed", async () => {
  const off = createPaymentProvider({ provider: "liqpay" });
  assert.equal(off.configured, false);
  assert.equal(off.describe().capabilities.onlineCharge, true);
  const on = createPaymentProvider({ provider: "liqpay", liqpayPublicKey: "pk" });
  assert.equal(on.configured, true);
  await assert.rejects(() => on.createCharge({ amount: 1, currency: "UAH", reference: "x" }), /не інтегровано/);
});

// none: онлайн-оплата недоступна, charge відхиляється.
test("none provider refuses charges", async () => {
  const none = createPaymentProvider();
  assert.equal(none.configured, false);
  await assert.rejects(() => none.createCharge({ amount: 1, currency: "UAH", reference: "x" }), /не налаштовано/);
});

// Резолвер добирає оплату з профілю організації (per-org), не хардкодом.
test("resolver picks payment from the organization profile settings", async () => {
  const idx = await read("lib/providers/index.ts");
  assert.match(idx, /createPaymentProvider\(paymentConfig\(profile\.settings\)\)/);
  assert.match(idx, /settings\.payment/);
  assert.doesNotMatch(idx, /const nullPayment/);
  // Стан оплат віддається у діагностиці провайдерів.
  const route = await read("app/api/staff/providers/route.ts");
  assert.match(route, /providers\.payment\.describe\(\)/);
});
