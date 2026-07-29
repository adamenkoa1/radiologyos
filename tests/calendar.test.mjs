import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("calendar migration + journal add the subscription token", async () => {
  const migration = await read("drizzle/0012_calendar_token.sql");
  assert.match(migration, /calendar_token/);
  const journal = JSON.parse(await read("drizzle/meta/_journal.json"));
  assert.ok(journal.entries.some((e) => e.tag === "0012_calendar_token"));
});

test("ICS builder emits valid VCALENDAR events", async () => {
  const lib = await read("lib/calendar-ics.ts");
  assert.match(lib, /BEGIN:VCALENDAR/);
  assert.match(lib, /BEGIN:VEVENT/);
  assert.match(lib, /DTSTART;TZID=Europe\/Kyiv/);
});

test("calendar feed is gated by a hashed secret token and omits direct identifiers", async () => {
  const route = await read("app/api/calendar/route.ts");
  assert.match(route, /searchParams\.get\("token"\)/);
  assert.match(route, /hashToken\(token\) !== expected/);
  assert.match(route, /calendar_token_hash/);
  assert.doesNotMatch(route, /SELECT[^`]*name|phone/s);
  assert.match(route, /text\/calendar/);
  assert.match(route, /status IN \('new','confirmed','rescheduled'\)/);
});

test("admin can generate the calendar link from settings", async () => {
  const route = await read("app/api/staff/settings/calendar/route.ts");
  assert.match(route, /member\.role !== "admin"/);
  assert.match(
    route,
    /setSetting\(db, "calendar_token_hash", await hashToken\(token\), member\.organizationId\)/,
  );
  const page = await read("app/staff/settings/page.tsx");
  assert.match(page, /\/api\/staff\/settings\/calendar/);
  assert.match(page, /\/api\/calendar\?token=/);
});
