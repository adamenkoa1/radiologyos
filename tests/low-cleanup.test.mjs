import assert from "node:assert/strict";
import { readFile, readdir, access } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const exists = (path) => access(new URL(`../${path}`, import.meta.url)).then(() => true, () => false);

test("dead Next pages (redirected by the worker) are removed", async () => {
  assert.equal(await exists("app/booking/page.tsx"), false);
  assert.equal(await exists("app/cabinet/page.tsx"), false);
  // Worker досі редіректить ці URL на статичні сторінки.
  const worker = await read("worker/index.ts");
  assert.match(worker, /url\.pathname === "\/booking"/);
  assert.match(worker, /url\.pathname === "\/cabinet"/);
});

test("dead `equipment` table is dropped by migration and absent from schema", async () => {
  const migration = await read("drizzle/0022_drop_equipment.sql");
  assert.match(migration, /DROP TABLE IF EXISTS .?equipment.?/);
  const schema = await read("db/schema.ts");
  assert.doesNotMatch(schema, /sqliteTable\("equipment"/);

  // Після всіх міграцій таблиці немає, а equipment_blocks лишається.
  const dir = new URL("../drizzle/", import.meta.url);
  const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
  const db = new DatabaseSync(":memory:");
  for (const f of files) {
    const sql = await readFile(new URL(f, dir), "utf8");
    for (const s of sql.split(/-->\s*statement-breakpoint/).map((x) => x.trim()).filter(Boolean)) db.exec(s);
  }
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name);
  assert.ok(!tables.includes("equipment"), "equipment dropped");
  assert.ok(tables.includes("equipment_blocks"), "equipment_blocks kept");
});

test("rate-limit fingerprint no longer trusts client x-forwarded-for", async () => {
  const src = await read("lib/rate-limit.ts");
  assert.match(src, /cf-connecting-ip/);
  assert.doesNotMatch(src, /x-forwarded-for/);
});

test("public booking assigns appointments from the clinic schedule", async () => {
  const route = await read("app/api/site-booking/route.ts");
  assert.match(route, /parseSchedule\(await getSetting\(db, SCHEDULE_KEY\)\)/);
  assert.match(route, /assignEarliestAppointments\(/);
});
