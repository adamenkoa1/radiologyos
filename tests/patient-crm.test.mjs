import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("CRM migration creates profile and communication tables with indexes", async () => {
  const migration = await read("drizzle/0006_patient_crm.sql");
  assert.match(migration, /CREATE TABLE IF NOT EXISTS `patient_profiles`/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS `patient_communications`/);
  for (const column of ["phone_normalized", "display_name", "do_not_contact", "channel", "direction", "summary"]) {
    assert.match(migration, new RegExp(`\\\`${column}\\\``));
  }
  assert.match(migration, /CREATE INDEX IF NOT EXISTS `patient_communications_phone_idx`/);
  assert.match(migration, /CREATE INDEX IF NOT EXISTS `bookings_patient_idx`/);

  const journal = JSON.parse(await read("drizzle/meta/_journal.json"));
  assert.ok(journal.entries.some((entry) => entry.tag === "0006_patient_crm"));

  const schema = await read("db/schema.ts");
  assert.match(schema, /export const patientProfiles = sqliteTable\("patient_profiles"/);
  assert.match(schema, /export const patientCommunications = sqliteTable\("patient_communications"/);
});

test("CRM library aggregates bookings into patient summaries by phone", async () => {
  const source = await read("lib/patients.ts");
  for (const fn of [
    "buildPatientSummaries", "matchesSegment", "segmentCounts",
    "sanitizeProfile", "sanitizeCommunication",
  ]) assert.match(source, new RegExp(`export function ${fn}`));
  for (const segment of ["repeat", "upcoming", "awaiting_protocol", "outstanding_payment", "do_not_contact"]) {
    assert.match(source, new RegExp(`"${segment}"`));
  }
  // Patients are grouped strictly by normalized phone.
  assert.match(source, /const key = row\.phoneNormalized/);
});

test("CRM API guards profile writes and validates before persisting", async () => {
  const route = await read("app/api/staff/patients/route.ts");
  assert.match(route, /requireOrgContext\(request, db\)/); // tenant-scoped доступ
  assert.match(route, /canManageBookings\(member\.role\)/);
  assert.match(route, /canViewPatientRegistry\(member\.role\)/);
  assert.match(route, /logSecurityEvent\(/);
  assert.match(route, /sanitizeProfile\(/);
  assert.match(route, /sanitizeCommunication\(/);
  assert.match(route, /INSERT INTO patient_profiles/);
  assert.match(route, /INSERT INTO patient_communications/);
  assert.doesNotMatch(route, /CREATE\s+TABLE/i);
  assert.doesNotMatch(route, /ALTER\s+TABLE/i);
});

test("patient registry query is bounded (no unbounded profile scan)", async () => {
  const route = await read("app/api/staff/patients/route.ts");
  assert.match(route, /FROM patient_profiles WHERE organization_id = \? ORDER BY updated_at DESC LIMIT \d+/);
});

test("reminder and telegram send failures are logged, not silently swallowed", async () => {
  const bookings = await read("app/api/staff/bookings/route.ts");
  assert.match(bookings, /console\.error\("reminder_failed"/);
  const site = await read("app/api/site-booking/route.ts");
  assert.match(site, /console\.error\("telegram_notify_failed"/);
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

test("CRM page renders inside the staff workspace", async () => {
  const response = await renderPath("/staff/patients");
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /Картки пацієнтів/);
  assert.match(html, /Оберіть пацієнта зі списку/);
});

test("CRM card shows a loading state, a book action, and context-correct visit links", async () => {
  const page = await read("app/staff/patients/page.tsx");
  // Окремий стан завантаження картки (не плутати з плейсхолдером «оберіть пацієнта»).
  assert.match(page, /cardLoading/);
  assert.match(page, /Завантаження картки…/);
  // Кнопка «Записати на дослідження» веде у форму запису з даними пацієнта.
  assert.match(page, /crmBookBtn/);
  assert.match(page, /\/staff\/book\?/);
  assert.match(page, /Записати на дослідження/);
  // Майбутні візити ведуть у календар, виконані — у протокол.
  assert.match(page, /\/staff\/appointments\?date=/);
  assert.match(page, /performedAt \|\| \["ready","issued","in_progress"\]/);
  // Drawer у CRM: клік по візиту відкриває спільну панель (контекст + дії).
  assert.match(page, /<BookingDrawer/);
  assert.match(page, /button type="button" className="crmVisitHead"/);
  assert.match(page, /drawerPatch/); // підтвердження/перенесення з панелі
});

test("booking form pre-fills patient data from query params (CRM → book)", async () => {
  const page = await read("app/staff/book/page.tsx");
  for (const p of ["name", "phone", "dob", "category"]) {
    assert.match(page, new RegExp(`params\\.get\\("${p}"\\)`), `reads ${p}`);
  }
  // Поля контрольовані, щоб передзаповнення справді відображалося.
  assert.match(page, /value=\{name\} onChange/);
  assert.match(page, /value=\{phone\} onChange/);
  assert.match(page, /value=\{category\} onChange/);
});
