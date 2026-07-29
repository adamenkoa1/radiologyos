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

test("external-calendar endpoint fetches the configured feed for staff", async () => {
  const route = await read("app/api/staff/external-calendar/route.ts");
  assert.match(route, /requireStaff\(/);
  assert.match(route, /getSetting\(db, "external_ics_url", member\.organizationId\)/);
  assert.match(route, /parseIcs\(/);
  assert.match(route, /safeOutboundUrl\(url\)/);
  assert.match(route, /fetchLimited\(safeUrl/);
  assert.match(route, /canAccessAllBookings\(member\.role\)/);
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
