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

test("the client bridge posts the cart and opens the patient cabinet for OTP verification", async () => {
  const bridge = await read("public/site/assets/d1-bridge.js");
  assert.match(bridge, /\/api\/site-booking/);
  assert.match(bridge, /stopImmediatePropagation\(\)/);
  assert.match(bridge, /items:\s*items\.map/);
  assert.match(bridge, /cabinet\.html\?new=1/);
  assert.doesNotMatch(bridge, /Код заявки|Коди заявок/);
  const cabinet = await read("public/site/cabinet.html");
  assert.match(cabinet, /\/api\/patient-otp/);
  assert.match(cabinet, /autoEnter:false/);
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
  assert.match(route, /sendTelegram\(db,\s*bookingMessage\([\s\S]*?\),\s*PUBLIC_ORGANIZATION_ID\)/);
  assert.match(route, /bookingMessage\(/);
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

test("payment link is served publicly and used by the site, not hardcoded", async () => {
  const route = await read("app/api/pay-link/route.ts");
  assert.match(route, /pay_link/);
  const bridge = await read("public/site/assets/d1-bridge.js");
  // The site pays through /api/site-payment (server-side amount), never a hardcoded link.
  assert.match(bridge, /\/api\/site-payment/);
  assert.doesNotMatch(bridge, /privatbank\.ua|liqpay\.ua/);
  const index = await read("public/site/index.html");
  assert.doesNotMatch(index, /assets\/notify\.js/);
  const cabinet = await read("public/site/cabinet.html");
  // One clear pay CTA showing the amount, plus the exact transfer purpose.
  assert.match(cabinet, /Сплатити \$\{esc\(money\(b\.paymentAmount\)\)\} грн/);
  assert.match(cabinet, /const paymentPurpose = `Сплата за медичні послуги, заявка \$\{b\.code\}/);
});

test("the payment QR renders on the site and in the cabinet, pointing at /api/site-payment", async () => {
  const bridge = await read("public/site/assets/d1-bridge.js");
  assert.match(bridge, /qr\.createImgTag/);
  assert.match(bridge, /\/api\/site-payment\?codes=/);
  const cabinet = await read("public/site/cabinet.html");
  assert.match(cabinet, /assets\/qrgen\.js/);
  assert.match(cabinet, /function payQrImg/);
  // The cabinet QR and pay button both go through the auto-amount endpoint (payUrl).
  assert.match(cabinet, /const payUrl = location\.origin\+'\/api\/site-payment\?codes='\+encodeURIComponent\(b\.code\)/);
  assert.match(cabinet, /payQrImg\(payUrl\)/);
  assert.match(cabinet, /data-open-payment data-url="\$\{esc\(payUrl\)\}"/);
});

test("civilian public request offers an optional preferred-time picker (not forced)", async () => {
  const bridge = await read("public/site/assets/d1-bridge.js");
  // Submit is never blocked on a chosen slot: desiredDate/desiredTime fall back to ''.
  assert.match(bridge, /desiredTime = \(typeof pickedSlot[^\n]*pickedSlot\.time\) \? pickedSlot\.time : ''/);
  // Civilian booking pages expose the optional slot picker (patient suggests a time,
  // registrar confirms). Wiring lives in cart.js -> refreshSlotPicker().
  for (const page of ["public/site/index.html", "public/site/price.html"]) {
    const html = await read(page);
    assert.match(html, /id="slotPicker"/);
  }
  // Military referral form stays slot-free — scheduling is by referral, not self-service.
  const military = await read("public/site/military.html");
  assert.doesNotMatch(military, /id="(?:mil)?[Ss]lotPicker"/);
});

test("a civilian booking offers PrivatBank payment right in the drawer, not only in the cabinet", async () => {
  const bridge = await read("public/site/assets/d1-bridge.js");
  // Civilian submit shows the in-drawer success/pay step instead of a blind cabinet redirect.
  assert.match(bridge, /showCivilSuccess\(result\)/);
  assert.match(bridge, /function showCivilSuccess/);
  // The pay button/QR go through /api/site-payment for the booking codes.
  assert.match(bridge, /function wirePayButton/);
  assert.match(bridge, /\/api\/site-payment\?codes=/);
  assert.match(bridge, /qr\.createImgTag/);
  // The confirmation markup carries the PrivatBank pay button on both civilian pages.
  for (const page of ["public/site/index.html", "public/site/price.html"]) {
    const html = await read(page);
    assert.match(html, /id="payBtn"[\s\S]*ПриватБанк/);
    assert.match(html, /id="payBlock"/);
  }
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

test("the military free-booking form saves to D1 as category 'military'", async () => {
  const bridge = await read("public/site/assets/d1-bridge.js");
  assert.match(bridge, /getElementById\('militaryRequestForm'\)/);
  assert.match(bridge, /category:\s*'military'/);
  assert.match(bridge, /referralType:\s*'military_referral'/);
  const military = await read("public/site/military.html");
  assert.match(military, /assets\/d1-bridge\.js/);
  assert.doesNotMatch(military, /id="milSlotPicker"/);
});

test("civilian booking warns about the 18+ rule up front, not only on submit error", async () => {
  for (const page of ["index", "price"]) {
    const html = await read(`public/site/${page}.html`);
    assert.match(html, /Онлайн-запис — для пацієнтів <strong>від 18 років<\/strong>/, `${page}: нема проактивної 18\+ нотатки`);
    assert.match(html, /tel:\+380972808899/, `${page}: нема телефону реєстратури в нотатці`);
  }
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
  assert.match(military, /Візьміть із собою направлення, документ, що посвідчує особу/);
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