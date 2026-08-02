import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("site-booking endpoint saves v22 cart requests into D1 bookings", async () => {
  const route = await read("app/api/site-booking/route.ts");
  assert.match(route, /serviceByCode\(/);
  assert.match(route, /INSERT INTO bookings/);
  assert.match(route, /INSERT INTO booking_events/);
  assert.match(route, /isRateLimited\(/);
  assert.match(route, /normalizeUkrainianPhone\(/);
  assert.match(route, /codes,\s*code:\s*codes\[0\]/); // returns the RD codes
  assert.match(route, /status:\s*201/);
});

test("the client bridge posts the cart to /api/site-booking and reuses v22 success UI", async () => {
  const bridge = await read("public/site/assets/d1-bridge.js");
  assert.match(bridge, /\/api\/site-booking/);
  assert.match(bridge, /stopImmediatePropagation\(\)/); // takes over cart.js submit
  assert.match(bridge, /items:\s*items\.map/);
  assert.match(bridge, /showSuccess\(/); // shows v22 confirmation panel with the RD code
  assert.match(bridge, /Код заявки|Коди заявок/);
});

test("the booking pages load the D1 bridge after cart.js", async () => {
  for (const page of ["public/site/index.html", "public/site/price.html"]) {
    const html = await read(page);
    const cartAt = html.indexOf("assets/cart.js");
    const bridgeAt = html.indexOf("assets/d1-bridge.js");
    assert.ok(cartAt > -1 && bridgeAt > -1, `${page} should load both scripts`);
    assert.ok(bridgeAt > cartAt, `${page} should load the bridge after cart.js`);
  }
});

test("patient cabinet lists bookings by phone and reads protocols from D1", async () => {
  const cabinet = await read("public/site/cabinet.html");
  assert.match(cabinet, /\/api\/my-bookings/); // list every booking for the phone
  assert.match(cabinet, /\/api\/my-protocol/); // finalized protocol
  assert.match(cabinet, /method:\s*'PATCH'[\s\S]*action:\s*'cancel'/); // self-service cancel
  assert.doesNotMatch(cabinet, /radiologyos_applications_v1/); // no more localStorage data store
});

test("my-bookings lists every booking for a full phone number", async () => {
  const route = await read("app/api/my-bookings/route.ts");
  assert.match(route, /normalizeUkrainianPhone\(/);
  assert.match(route, /WHERE b\.phone_normalized = \?/);
  assert.match(route, /protocol_status = 'issued'/); // exposes hasProtocol flag
  assert.match(route, /isRateLimited\(/);
});

test("my-protocol only returns an issued protocol behind a verified patient session", async () => {
  const route = await read("app/api/my-protocol/route.ts");
  assert.match(route, /normalizeBookingCode\(/);
  assert.match(route, /requirePatientSession\(/);
  assert.match(route, /phone_normalized = \?/);
  assert.match(route, /protocolStatus !== "issued"/); // gated until issued
  assert.match(route, /FROM protocols WHERE booking_id = \?/);
});

test("new bookings notify the registrar via Telegram (best-effort)", async () => {
  const lib = await read("lib/telegram.ts");
  assert.match(lib, /api\.telegram\.org\/bot/);
  assert.match(lib, /if \(!token \|\| !chatId\) return \{ ok: false/); // no-op until configured
  const route = await read("app/api/site-booking/route.ts");
  assert.match(route, /sendTelegram\(/);
  assert.match(route, /bookingMessage\(/);
});

test("department settings are admin-only and validated", async () => {
  const route = await read("app/api/staff/settings/route.ts");
  assert.match(route, /member\.role !== "admin"/);
  assert.match(route, /telegram_bot_token/);
  assert.match(route, /pay_link/);
  assert.match(route, /paymentUrl\.protocol !== "https:"/);
  assert.match(route, /safeOutboundUrl\(externalIcsUrl\)/);
  assert.doesNotMatch(route, /registration_code_hash|accessCode/);
  const migration = await read("drizzle/0010_department_settings.sql");
  assert.match(migration, /telegram_bot_token/);
  assert.match(migration, /pay_link/);
  const journal = JSON.parse(await read("drizzle/meta/_journal.json"));
  assert.ok(journal.entries.some((e) => e.tag === "0010_department_settings"));
});

test("a test-message endpoint verifies the Telegram connection (admin-only)", async () => {
  const route = await read("app/api/staff/settings/telegram-test/route.ts");
  assert.match(route, /member\.role !== "admin"/);
  assert.match(route, /sendTelegramResult\(/);
  const lib = await read("lib/telegram.ts");
  assert.match(lib, /export async function sendTelegramResult/);
  assert.match(lib, /description \|\|/); // surfaces Telegram's error reason
});

test("payment link is served publicly and used by the site, not hardcoded", async () => {
  const route = await read("app/api/pay-link/route.ts");
  assert.match(route, /pay_link/);
  const bridge = await read("public/site/assets/d1-bridge.js");
  assert.match(bridge, /\/api\/pay-link/);
  const index = await read("public/site/index.html");
  assert.doesNotMatch(index, /assets\/notify\.js/); // obsolete client-side gateway removed
  const cabinet = await read("public/site/cabinet.html");
  assert.match(cabinet, /Очікує оплати/);
});

test("the payment QR renders on the site and in the cabinet; button only for real URLs", async () => {
  // site: button hidden for a raw bank-QR payload, QR still drawn
  const bridge = await read("public/site/assets/d1-bridge.js");
  assert.match(bridge, /if \(\/\^https\?:/); // button gated on a real http(s) URL
  assert.match(bridge, /btn\.removeAttribute\('href'\); btn\.hidden = true/); // raw QR payload => scan-only
  assert.match(bridge, /qr\.createImgTag/);
  // cabinet: loads the QR generator and draws a QR for pending payments
  const cabinet = await read("public/site/cabinet.html");
  assert.match(cabinet, /assets\/qrgen\.js/);
  assert.match(cabinet, /function payQrImg/);
  assert.match(cabinet, /awaitingPayment && payLink \? `<div class="pay-qr"/);
  assert.match(cabinet, /awaitingPayment && isPayUrl\(payLink\)/); // link button gated on http(s)
});

test("the public request does not force patients to choose a slot", async () => {
  const bridge = await read("public/site/assets/d1-bridge.js");
  assert.match(bridge, /const desiredDate = ''/);
  assert.match(bridge, /const desiredTime = ''/);
  for (const page of ["public/site/index.html", "public/site/price.html", "public/site/military.html"]) {
    const html = await read(page);
    assert.doesNotMatch(html, /id="(?:mil)?[Ss]lotPicker"/);
  }
});

test("the military free-booking form saves to D1 as category 'military'", async () => {
  const bridge = await read("public/site/assets/d1-bridge.js");
  assert.match(bridge, /getElementById\('militaryRequestForm'\)/);
  assert.match(bridge, /category:\s*'military'/);
  assert.match(bridge, /referralType:\s*'military_referral'/);
  const military = await read("public/site/military.html");
  assert.match(military, /assets\/d1-bridge\.js/); // bridge loaded on the military page
  assert.doesNotMatch(military, /id="milSlotPicker"/);
});
