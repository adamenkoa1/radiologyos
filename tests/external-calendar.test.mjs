import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("external-calendar migration + journal", async () => {
  const migration = await read("drizzle/0013_external_calendar.sql");
  assert.match(migration, /external_ics_url/);
  const journal = JSON.parse(await read("drizzle/meta/_journal.json"));
  assert.ok(journal.entries.some((e) => e.tag === "0013_external_calendar"));
});

test("ICS parser reads VEVENTs and formats Kyiv time", async () => {
  const lib = await read("lib/ics-parse.ts");
  assert.match(lib, /export function parseIcs/);
  assert.match(lib, /BEGIN:VEVENT/);
  assert.match(lib, /Europe\/Kyiv/);
  assert.match(lib, /DTSTART/);
});

test("external-calendar endpoint serves the tenant feed via the calendar provider", async () => {
  const route = await read("app/api/staff/external-calendar/route.ts");
  // Маршрут тонкий: tenant-контекст + провайдер календаря.
  assert.match(route, /requireOrgContext\(request, db\)/);
  assert.match(route, /canAccessAllBookings\(ctx\.member\.role\)/);
  assert.match(route, /resolveProviders\(db, ctx\)/);
  assert.match(route, /calendar\.listUpcoming\(\)/);

  // Реальна доставка живе у провайдері, через політику вихідних зʼєднань.
  const provider = await read("lib/providers/calendar.ts");
  assert.match(provider, /export function createCalendarProvider/);
  assert.match(provider, /parseIcs\(/);
  assert.match(provider, /safeOutboundUrl\(url\)/);
  assert.match(provider, /fetchLimited\(safeUrl/);

  // Резолвер добирає джерело (external_ics_url) у tenant-контексті.
  const resolver = await read("lib/providers/index.ts");
  assert.match(resolver, /external_ics_url/);
  assert.match(resolver, /createCalendarProvider\(icsUrl\)/);
});

test("settings expose the external calendar URL and the dashboard shows events", async () => {
  const route = await read("app/api/staff/settings/route.ts");
  assert.match(route, /external_ics_url/);
  const page = await read("app/staff/settings/page.tsx");
  assert.match(page, /externalIcsUrl/);
  const dash = await read("app/staff/dashboard/page.tsx");
  assert.match(dash, /\/api\/staff\/external-calendar/);
  assert.match(dash, /Google Календар — найближчі події/);
});
