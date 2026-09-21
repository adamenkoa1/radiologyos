// Приватна конверсійна аналітика вітрини: static-сайт шле ті самі події в
// /api/analytics, що й Next-лендинги, з тим самим journey-id і БЕЗ персональних
// чи медичних даних. Перевірка — на рівні джерельних рядків (як інші frontend-тести).

import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const read = (p) => readFile(new URL(`../${p}`, import.meta.url), "utf8");
const PAGES = ["public/site/index.html", "public/site/price.html", "public/site/military.html"];

test("site-analytics: спільний endpoint, journey-id і чисті поля без PII", async () => {
  const js = await read("public/site/assets/site-analytics.js");
  assert.match(js, /\/api\/analytics/);
  // Той самий journey-key, що й у lib/client-analytics (кореляція шляху).
  assert.match(js, /radiologyos_analytics_journey_v1/);
  assert.match(js, /window\.rosTrack\s*=/);
  assert.match(js, /rosTrack\('page_view'/);
  assert.match(js, /keepalive:\s*true/);
  // Дозволені ключі payload — лише ці; жодних персональних/медичних полів.
  for (const key of ["eventName", "journeyId", "serviceCode", "patientCategory", "pageKey"]) {
    assert.match(js, new RegExp(key));
  }
  for (const forbidden of ["patientName", "\\bname\\b", "phone", "\\bdob\\b", "desiredDate", "desiredTime", "\\bemail\\b"]) {
    assert.doesNotMatch(js, new RegExp(forbidden), `site-analytics не має слати ${forbidden}`);
  }
});

test("d1-bridge fires booking_started (with service code) on a validated messenger click", async () => {
  const bridge = await read("public/site/assets/d1-bridge.js");
  assert.match(bridge, /window\.rosTrack/);
  assert.match(bridge, /rosTrack\('booking_started',\s*\{\s*serviceCode:/);
  // Подія — лише після успішної валідації (після `if (!data) return;`).
  const gateIdx = bridge.indexOf("if (!data) return;");
  const eventIdx = bridge.indexOf("booking_started");
  assert.ok(gateIdx !== -1 && eventIdx > gateIdx, "booking_started має йти після гейта валідації");
});

test("every public page loads site-analytics before the booking bridge", async () => {
  for (const page of PAGES) {
    const html = await read(page);
    const a = html.indexOf('assets/site-analytics.js');
    const b = html.indexOf('assets/d1-bridge.js');
    assert.ok(a !== -1, `${page}: підключено site-analytics.js`);
    assert.ok(b !== -1 && a < b, `${page}: site-analytics перед d1-bridge`);
  }
});
