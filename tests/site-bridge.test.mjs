import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("site-booking endpoint saves v22 cart requests into D1 bookings", async () => {
  const route = await read("app/api/site-booking/route.ts");
  assert.match(route, /configuredServiceByCode\(/);
  assert.match(route, /INSERT INTO bookings/);
  assert.match(route, /INSERT INTO booking_events/);
  assert.match(route, /isRateLimited\(/);
  assert.match(route, /normalizeUkrainianPhone\(/);
  assert.match(route, /codes,\s*code:\s*codes\[0\]/);
  assert.match(route, /status:\s*201/);
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

test("my-bookings lists only the verified phone inside the verified tenant", async () => {
  const route = await read("app/api/my-bookings/route.ts");
  assert.match(route, /requirePatientSession\(/);
  assert.doesNotMatch(route, /normalizeUkrainianPhone\(/);
  assert.doesNotMatch(route, /createPatientSession\(/);
  assert.match(route, /WHERE b\.organization_id = \? AND b\.phone_normalized = \?/);
  assert.match(route, /session\.organizationId, session\.phoneNormalized/);
  assert.match(route, /protocol_status = 'issued'/);
  assert.match(route, /isRateLimited\(/);
});

test("my-protocol only returns an issued protocol behind the same tenant-scoped patient session", async () => {
  const route = await read("app/api/my-protocol/route.ts");
  assert.match(route, /normalizeBookingCode\(/);
  assert.match(route, /requirePatientSession\(/);
  assert.match(route, /WHERE organization_id = \? AND code = \? AND phone_normalized = \?/);
  assert.match(route, /protocolStatus !== "issued"/);
  assert.match(route, /FROM protocols WHERE organization_id = \? AND booking_id = \?/);
});

test("new bookings notify the registrar via Telegram (best-effort)", async () => {
  const lib = await read("lib/telegram.ts");
  assert.match(lib, /api\.telegram\.org\/bot/);
  assert.match(lib, /if \(!token \|\| !chatId\) return \{ ok: false/);
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
  assert.match(lib, /description \|\|/);
});

test("payment link is served publicly and used by the site, not hardcoded", async () => {
  const route = await read("app/api/pay-link/route.ts");
  assert.match(route, /pay_link/);
  const bridge = await read("public/site/assets/d1-bridge.js");
  assert.match(bridge, /\/api\/pay-link/);
  const index = await read("public/site/index.html");
  assert.doesNotMatch(index, /assets\/notify\.js/);
  const cabinet = await read("public/site/cabinet.html");
  assert.match(cabinet, /До сплати/);
  assert.match(cabinet, /const paymentPurpose = `Сплата за медичні послуги, заявка \$\{b\.code\}/);
});

test("the payment QR renders on the site and in the cabinet; button only for real URLs", async () => {
  const bridge = await read("public/site/assets/d1-bridge.js");
  assert.match(bridge, /if \(\/\^https\?:/);
  assert.match(bridge, /btn\.removeAttribute\('href'\); btn\.hidden = true/);
  assert.match(bridge, /qr\.createImgTag/);
  const cabinet = await read("public/site/cabinet.html");
  assert.match(cabinet, /assets\/qrgen\.js/);
  assert.match(cabinet, /function payQrImg/);
  assert.match(cabinet, /payLink \? `<div class="pay-qr"/);
  assert.match(cabinet, /isPayUrl\(payLink\)/);
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
