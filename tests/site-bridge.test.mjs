import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("site-booking endpoint saves v22 cart requests into D1 bookings", async () => {
  const route = await read("app/api/site-booking/route.ts");
  assert.match(route, /effectiveServices\(db, PUBLIC_ORGANIZATION_ID\)/);
  assert.match(route, /serviceAvailableTo\(/);
  assert.match(route, /INSERT INTO bookings/);
  assert.match(route, /INSERT INTO booking_events/);
  assert.match(route, /isRateLimited\(/);
  assert.match(route, /normalizeUkrainianPhone\(/);
  assert.match(route, /codes,\s*code:\s*codes\[0\]/);
  assert.match(route, /status:\s*201/);
  assert.doesNotMatch(route, /configuredServiceByCode\(/);
});

// Публічний запис більше не POST-ить у /api/site-booking і не відкриває кабінет
// автоматично — це месенджер-хендоф (див. public-booking-messenger.test).

test("the booking pages load the D1 bridge after cart.js", async () => {
  for (const page of ["public/site/index.html", "public/site/price.html"]) {
    const html = await read(page);
    const cartAt = html.indexOf("assets/cart.js");
    const bridgeAt = html.indexOf("assets/d1-bridge.js");
    assert.ok(cartAt > -1 && bridgeAt > -1, `${page} should load both scripts`);
    assert.ok(bridgeAt > cartAt, `${page} should load the bridge after cart.js`);
  }
});

test("patient cabinet lists verified-session bookings and reads protocols from D1", async () => {
  const cabinet = await read("public/site/cabinet.html");
  assert.match(cabinet, /\/api\/my-bookings/);
  assert.match(cabinet, /\/api\/my-protocol/);
  assert.match(cabinet, /method:\s*'PATCH'[\s\S]*action:\s*'cancel'/);
  assert.doesNotMatch(cabinet, /radiologyos_applications_v1/);
});

test("my-bookings prefers immutable patient_id and preserves the verified legacy fallback", async () => {
  const route = await read("app/api/my-bookings/route.ts");
  assert.match(route, /requirePatientSession\(/);
  assert.doesNotMatch(route, /normalizeUkrainianPhone\(/);
  assert.doesNotMatch(route, /createPatientSession\(/);
  assert.match(route, /session\.patientId[\s\S]*b\.organization_id = \? AND b\.patient_id = \?/);
  assert.match(route, /b\.organization_id = \? AND b\.phone_normalized = \? AND \$\{identityClause\}/);
  assert.match(route, /\[session\.organizationId, session\.patientId\]/);
  assert.match(route, /\[session\.organizationId, session\.phoneNormalized, session\.identityValue\]/);
  assert.match(route, /protocol_status = 'issued'/);
  assert.match(route, /isRateLimited\(/);
});

test("my-protocol returns issued protocol through immutable patient_id or the exact verified legacy scope", async () => {
  const route = await read("app/api/my-protocol/route.ts");
  assert.match(route, /normalizeBookingCode\(/);
  assert.match(route, /requirePatientSession\(/);
  assert.match(route, /session\.patientId[\s\S]*organization_id = \? AND code = \? AND patient_id = \?/);
  assert.match(route, /organization_id = \? AND code = \? AND phone_normalized = \? AND \$\{identityClause\}/);
  assert.match(route, /protocolStatus !== "issued"/);
  assert.match(route, /FROM protocols WHERE organization_id = \? AND booking_id = \?/);
});

test("new public bookings notify the registrar via the public organization's Telegram credentials", async () => {
  const lib = await read("lib/telegram.ts");
  assert.match(lib, /api\.telegram\.org\/bot/);
  assert.match(lib, /getOrganizationIntegrationSettings\(db, organizationId/);
  assert.match(lib, /if \(!token \|\| !chatId\) return \{ ok:\s*false/);
  const route = await read("app/api/site-booking/route.ts");
  assert.match(route, /sendTelegramBookingNotice\(db,[\s\S]*?PUBLIC_ORGANIZATION_ID\)/);
  assert.match(route, /desiredDate:appointments\[index\]\.date/);
});

test("department settings use system-admin authority and validate input", async () => {
  const route = await read("app/api/staff/settings/route.ts");
  assert.match(route, /requireSystemOrgContext\(request, db\)/);
  assert.match(route, /canManageSystem\(ctx\.role\)/);
  assert.doesNotMatch(route, /requireStaff\(request, db\)/);
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

test("a test-message endpoint verifies the current organization's Telegram connection", async () => {
  const route = await read("app/api/staff/settings/telegram-test/route.ts");
  assert.match(route, /requireSystemOrgContext\(request, db\)/);
  assert.match(route, /canManageSystem\(ctx\.role\)/);
  assert.doesNotMatch(route, /PRIMARY_ORGANIZATION_ID/);
  assert.doesNotMatch(route, /requireStaff\(request, db\)/);
  assert.match(route, /sendTelegramResult\(db, text, ctx\.organizationId\)/);
  const lib = await read("lib/telegram.ts");
  assert.match(lib, /export async function sendTelegramResult/);
  assert.match(lib, /description\s*\|\|/);
});

test("pay-link and in-cabinet payment stay available (no prepayment in the public booking)", async () => {
  const route = await read("app/api/pay-link/route.ts");
  assert.match(route, /pay_link/);
  // Публічна форма запису не пропонує оплату (див. public-booking-messenger.test);
  // оплата лишається лише в кабінеті — після оформлення персоналом.
  const cabinet = await read("public/site/cabinet.html");
  assert.match(cabinet, /Сплатити \$\{esc\(money\(b\.paymentAmount\)\)\} грн/);
  assert.match(cabinet, /const paymentPurpose = `Сплата за медичні послуги, заявка \$\{b\.code\}/);
  assert.match(cabinet, /assets\/qrgen\.js/);
  assert.match(cabinet, /function payQrImg/);
  assert.match(cabinet, /const payUrl = location\.origin\+'\/api\/site-payment\?codes='\+encodeURIComponent\(b\.code\)/);
});

test("site-payment builds a signed LiqPay checkout with a server-side amount, or falls back to the static QR", async () => {
  const route = await read("app/api/site-payment/route.ts");
  // Amount comes from D1, never the query string.
  assert.match(route, /SELECT[\s\S]*payment_amount AS amount[\s\S]*FROM bookings/);
  assert.match(route, /row\.category === "civilian" && row\.amount > 0/);
  assert.match(route, /buildLiqpayCheckout/);
  assert.match(route, /LIQPAY_CHECKOUT_URL/);
  // No keys → static PrivatBank fallback (previous behavior preserved).
  assert.match(route, /if \(!publicKey \|\| !privateKey\) return staticFallback/);
  // The callback settles paid bookings through the shared manual-payment ledger path.
  const cb = await read("app/api/liqpay-callback/route.ts");
  assert.match(cb, /verifyLiqpayCallback/);
  assert.match(cb, /if \(!result\.paid\) return ok\(\)/);
  assert.match(cb, /settleVerifiedProviderPayment/);
  assert.match(cb, /payment_already_settled/);
  // Signing/verification contract lives in lib/liqpay.
  const lib = await read("lib/liqpay.ts");
  assert.match(lib, /private_key.*data.*private_key|privateKey.*data.*privateKey/s);
  assert.match(lib, /SHA-1/);
});

test("military booking page loads the messenger bridge and the free-time slot picker", async () => {
  const bridge = await read("public/site/assets/d1-bridge.js");
  assert.match(bridge, /getElementById\('militaryRequestForm'\)/);
  const military = await read("public/site/military.html");
  assert.match(military, /assets\/d1-bridge\.js/);
  // «Оберіть зручний час»: пікер вільних слотів із розкладу відділення.
  assert.match(military, /assets\/slots\.js/);
  assert.match(military, /id="militarySlotPicker"/);
  assert.match(military, /refreshMilitarySlotPicker\(/);
});

test("public booking pages offer the free-time slot picker feeding desired date/time", async () => {
  const cart = await read("public/site/assets/cart.js");
  assert.match(cart, /function refreshSlotPicker\(/);
  assert.match(cart, /serviceCode: code/);
  assert.match(cart, /getElementById\('desiredDate'\)/);
  assert.match(cart, /getElementById\('desiredTime'\)/);
  for (const page of ["public/site/index.html", "public/site/price.html"]) {
    const html = await read(page);
    assert.match(html, /id="slotPicker"/, `${page}: slot picker container`);
    assert.match(html, /assets\/slots\.js/, `${page}: slots.js`);
    assert.match(html, /Оберіть зручний час/, `${page}: heading`);
  }
  // Плановий запис — лише робочі дні (Пн–Пт): субота й неділя пропускаються.
  const slots = await read("public/site/assets/slots.js");
  assert.match(slots, /getDay\(\) === 0 \|\| .*getDay\(\) === 6/);
  assert.doesNotMatch(slots, /Пн–Сб/);
  // Слот-пікер основний; ручні дата/час — у згорнутому fallback.
  for (const page of ["public/site/index.html", "public/site/price.html", "public/site/military.html"]) {
    const html = await read(page);
    assert.match(html, /<details class="manual-time">[\s\S]*?type="date"[\s\S]*?type="time"[\s\S]*?<\/details>/, `${page}: manual fallback`);
  }
  // markInvalid розгортає прихований fallback, щоб показати помилку.
  const bridge = await read("public/site/assets/d1-bridge.js");
  assert.match(bridge, /closest\('details'\)[\s\S]*?\.open = true/);
});

test("cabinet groups a multi-study submission into one visit", async () => {
  const cabinet = await read("public/site/cabinet.html");
  assert.match(cabinet, /function renderBookings\(items\)/);
  assert.match(cabinet, /items\[i \+ 1\]\.createdAt === items\[i\]\.createdAt/);
  assert.match(cabinet, /Візит ·/);
  assert.match(cabinet, /разом до сплати/);
  assert.match(cabinet, /list\.innerHTML = renderBookings\(bookings\)/);
});

test("visit reminder: cabinet tells patients what to bring; military form mentions ID", async () => {
  const cabinet = await read("public/site/cabinet.html");
  assert.match(cabinet, /Візьміть із собою:/);
  assert.match(cabinet, /b\.category === 'military' \? 'направлення та '/);
  const military = await read("public/site/military.html");
  assert.match(military, /документ, що посвідчує особу/);
});

test("ПІБ field suggests Ukrainian given names + patronymics by token", async () => {
  const js = await read("public/site/assets/name-suggest.js");
  assert.match(js, /var NAMES =/);
  assert.match(js, /var PATRO =/);
  assert.match(js, /Олександрович/);
  assert.match(js, /Іванівна/);
  assert.match(js, /p\.idx === 1 \? NAMES : p\.idx === 2 \? PATRO/);
  assert.match(js, /'patientName', 'militaryPatientName'/);
  for (const p of ["index", "price", "military"]) {
    const html = await read(`public/site/${p}.html`);
    assert.match(html, /assets\/name-suggest\.js/, `${p} лінкує name-suggest.js`);
  }
});

test("manual date/time fallback cannot book a moment that already passed", async () => {
  const js = await read("public/site/assets/d1-bridge.js");
  // native date picker is bounded to today in the clinic timezone
  assert.match(js, /dateEl\.min = kyivToday\(\)/);
  assert.match(js, /function kyivToday\(\)/);
  assert.match(js, /function kyivNowTime\(\)/);
  // collect() rejects a past date and a past time-for-today with a specific message
  assert.match(js, /if \(date < today\) \{ markInvalid\(dateEl, 'Ця дата вже минула/);
  assert.match(js, /if \(date === today && time <= kyivNowTime\(\)\) \{ markInvalid\(timeEl, 'Цей час сьогодні вже минув/);
  // markInvalid supports a specific message and clearInvalid restores the base text
  assert.match(js, /function markInvalid\(input, message\)/);
  assert.match(js, /err\.dataset\.base != null\) err\.textContent = err\.dataset\.base/);
});

test("cart offers optional online payment without becoming a господарський факт", async () => {
  const js = await read("public/site/assets/cart.js");
  // shown only for paid (civilian) services, i.e. total > 0
  assert.match(js, /function renderPayOptional\(total\)/);
  assert.match(js, /if \(!\(total > 0\)\) \{ box\.hidden = true/);
  // uses the existing configured pay link (no booking/business document created)
  assert.match(js, /fetch\('\/api\/pay-link'/);
  assert.match(js, /window\.open\(link/);
  // messaging stays "pay after", payment is explicitly optional
  assert.match(js, /необов[’']язкова/);
  // the sum/purpose go through textContent, never interpolated into innerHTML
  assert.match(js, /#cartPaySum'\)\.textContent = money\(total\)/);
  assert.match(js, /#cartPayPurpose'\)\.textContent = payPurpose\(\)/);
  for (const p of ["index", "price"]) {
    const html = await read(`public/site/${p}.html`);
    assert.match(html, /<div class="cart-pay" id="cartPay" hidden><\/div>/, `${p} має точку монтування оплати`);
  }
  const css = await read("public/site/assets/site.css");
  assert.match(css, /\.cart-pay\{/);
});

test("messenger handoff copies honestly and always exposes the заявка text to copy manually", async () => {
  const js = await read("public/site/assets/d1-bridge.js");
  // copyText reports success/failure and the toast branches on it — no false "скопійовано"
  assert.match(js, /const copied = await copyText\(text\)/);
  assert.match(js, /copied\s*\?/);
  // the confirm box always holds the заявка text in a selectable field so a blocked
  // clipboard is not a dead end; value is set via .value, never interpolated into HTML
  assert.match(js, /class="book-confirm-field"/);
  assert.match(js, /field\.value = text/);
  assert.doesNotMatch(js, /innerHTML\s*=[^;]*\+\s*text/);
  const css = await read("public/site/assets/site.css");
  assert.match(css, /\.book-confirm-field\{/);
});

test("ПІБ field keeps a semantic name autocomplete so the browser never offers a bank card", async () => {
  const js = await read("public/site/assets/name-suggest.js");
  // Chrome/iOS ignores autocomplete="off" and heuristically offers saved cards
  // on a payment-worded page; the attach() must set the explicit "name" hint.
  assert.match(js, /setAttribute\('autocomplete', 'name'\)/);
  assert.doesNotMatch(js, /setAttribute\('autocomplete', 'off'\)/);
  for (const p of ["index", "price", "military"]) {
    const html = await read(`public/site/${p}.html`);
    assert.match(html, /autocomplete="name" id="(patientName|militaryPatientName)"/, `${p} ПІБ має autocomplete="name"`);
  }
});
