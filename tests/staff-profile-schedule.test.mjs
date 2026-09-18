import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = path => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("staff profile stores separate name, contact, rank and position fields", async () => {
  const migration = await read("drizzle/0024_staff_profiles.sql");
  for (const column of ["last_name", "first_name", "patronymic", "contact_email", "military_rank", "position_title"])
    assert.match(migration, new RegExp(column));
  const route = await read("app/api/staff/members/route.ts");
  assert.match(route, /\[lastName, firstName, patronymic\]/);
  assert.match(route, /position_title/);
});

test("room schedule can assign the full active team", async () => {
  const schedule = await read("lib/schedule.ts");
  const page = await read("app/staff/schedule/page.tsx");
  assert.match(schedule, /teamEmails\?: string\[\]/);
  assert.match(page, /Команда кабінету/);
  assert.match(page, /toggleTeamMember/);
});
