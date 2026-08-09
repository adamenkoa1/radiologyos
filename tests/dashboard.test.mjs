import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("dashboard API aggregates across pillars and never mutates schema", async () => {
  const route = await read("app/api/staff/dashboard/route.ts");
  assert.match(route, /requireStaff\(request, db\)/);
  assert.match(route, /awaiting.?protocol|protocol_status NOT IN/i);
  assert.match(route, /imaging_studies/);
  assert.match(route, /nszu_status = 'pending'/);
  assert.match(route, /needProtocol|needImaging|confirmQueue/);
  assert.doesNotMatch(route, /CREATE\s+TABLE/i);
  assert.doesNotMatch(route, /ALTER\s+TABLE/i);
  assert.doesNotMatch(route, /INSERT\s+INTO/i);
  assert.doesNotMatch(route, /UPDATE\s+bookings/i);
});

test("dashboard exposes a 7-day per-equipment workload", async () => {
  const route = await read("app/api/staff/dashboard/route.ts");
  // 7-денне вікно: сьогодні та 6 попередніх днів.
  assert.match(route, /setUTCDate\(d\.getUTCDate\(\) - 6\)/);
  assert.match(route, /desired_date BETWEEN \? AND \?/);
  assert.match(route, /GROUP BY desired_date, equipment_id/);
  assert.match(route, /equipmentWeek:/);
  assert.match(route, /weekStart,/);
  const page = await read("app/staff/dashboard/page.tsx");
  assert.match(page, /Завантаженість апаратів · 7 днів/);
  assert.match(page, /equipmentWeek/);
});

test("dashboard exposes a tenant-scoped clinical queue by machine state", async () => {
  const route = await read("app/api/staff/dashboard/route.ts");
  // Черга рахує активні стани єдиної state machine.
  assert.match(route, /CLINICAL_QUEUE_STATES/);
  assert.match(route, /'queued','in_progress','images_ready','reporting','protocol_ready'/);
  // Лічильники обмежені організацією зі серверного контексту.
  assert.match(route, /requireOrgContext\(request, db\)/);
  assert.match(route, /organization_id = \?/);
  assert.match(route, /clinicalQueue/);
  // Сторінка показує чергу з переходом у реєстр досліджень.
  const page = await read("app/staff/dashboard/page.tsx");
  assert.match(page, /dashQueue/);
  assert.match(page, /clinicalQueue/);
  assert.match(page, /\/staff\/studies/);
});

test("pending queue hides bookings whose date has already passed", async () => {
  const page = await read("app/staff/dashboard/page.tsx");
  // Черга «Нові заявки» лишає тільки заявки з датою дослідження ≥ сьогодні.
  assert.match(page, /\(b\.status === "new" \|\| b\.status === "rescheduled"\) && \(b\.desiredDate \|\| ""\) >= today/);
  // today визначено до pending, щоб фільтр міг ним користуватися.
  assert.match(page, /const today = data\?\.today \|\|/);
});

async function renderPath(path) {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(
    new Request(`http://localhost${path}`, { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("dashboard page renders inside the staff workspace", async () => {
  const response = await renderPath("/staff/dashboard");
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /Пульт відділення/);
});

test("confirm surfaces a persistent call-back list when notification fails", async () => {
  const page = await read("app/staff/dashboard/page.tsx");
  // null (крах) і failed>0 трактуються як «не попереджено».
  assert.match(page, /const notNotified = !r \|\| \(r\.failed \?\? 0\) > 0/);
  // Невдача → у стійкий список needsCall (а не лише зниклий тост).
  assert.match(page, /setNeedsCall\(cur =>/);
  assert.match(page, /const \[needsCall,setNeedsCall\]/);
  // Попереджувальний тост і блок із дзвінком.
  assert.match(page, /dashToast\$\{toast\.startsWith\("⚠"\)/);
  assert.match(page, /className="dashNeedsCall"/);
  assert.match(page, /href=\{`tel:\$\{b\.phone\}`\}/);
  // Успіх лишається лише коли реально надіслано.
  assert.match(page, /\(r\?\.sent \?\? 0\) > 0/);
  const css = await read("app/globals.css");
  assert.match(css, /\.dashNeedsCall\{[^}]*var\(--mod-urgent\)/);
  assert.match(css, /\.dashToast\.warn\{/);
});
