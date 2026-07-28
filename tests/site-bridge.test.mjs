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
  assert.match(route, /WHERE phone_normalized = \?/);
  assert.match(route, /protocol_status = 'issued'/); // exposes hasProtocol flag
  assert.match(route, /isRateLimited\(/);
});

test("my-protocol only returns an issued protocol behind code + phone", async () => {
  const route = await read("app/api/my-protocol/route.ts");
  assert.match(route, /RD-\[A-Z0-9\]\{8\}/); // code required
  assert.match(route, /substr\(phone_normalized, -4\)/); // phone required
  assert.match(route, /protocolStatus !== "issued"/); // gated until issued
  assert.match(route, /FROM protocols WHERE booking_id = \?/);
});

test("the slot picker uses the real department schedule", async () => {
  const slots = await read("public/site/assets/slots.js");
  assert.match(slots, /\/api\/availability\?date=/);
  assert.match(slots, /serviceCode=/);
  const cart = await read("public/site/assets/cart.js");
  assert.match(cart, /serviceCode:\s*code/); // cart drives the picker by service code
});
