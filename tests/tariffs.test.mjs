import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("tariffs migration + schema define the overrides table", async () => {
  const migration = await read("drizzle/0011_service_prices.sql");
  assert.match(migration, /CREATE TABLE IF NOT EXISTS `service_prices`/);
  assert.match(migration, /`code` text PRIMARY KEY/);
  const journal = JSON.parse(await read("drizzle/meta/_journal.json"));
  assert.ok(journal.entries.some((e) => e.tag === "0011_service_prices"));
  const schema = await read("db/schema.ts");
  assert.match(schema, /export const servicePrices = sqliteTable\("service_prices"/);
});

test("tariffs API: all staff read, only admin writes", async () => {
  const route = await read("app/api/staff/tariffs/route.ts");
  assert.match(route, /tariffList\(/);
  assert.match(route, /member\.role !== "admin"/); // PUT is admin-only
  assert.match(route, /INSERT INTO service_prices/);
  assert.match(route, /DELETE FROM service_prices WHERE code = \?/); // reset to default
});

test("bookings charge the effective (override-aware) price", async () => {
  const lib = await read("lib/tariffs.ts");
  assert.match(lib, /export async function effectivePrice/);
  const site = await read("app/api/site-booking/route.ts");
  assert.match(site, /effectivePrice\(db, service\.code\)/);
  const legacy = await read("app/api/bookings/route.ts");
  assert.match(legacy, /effectivePrice\(db, service\.code\)/);
});

test("home page shows tariffs (military free / civilian priced) with booking", async () => {
  const route = await read("app/api/catalog/route.ts");
  assert.match(route, /priceOverrides\(/);
  assert.match(route, /groups/);
  const index = await read("public/site/index.html");
  assert.match(index, /id="homeTariffs"/);
  assert.match(index, /assets\/home-tariffs\.js/);
  assert.match(index, /id="patientCategory"/); // category chooser on the home form
  const js = await read("public/site/assets/home-tariffs.js");
  assert.match(js, /\/api\/catalog/);
  assert.match(js, /безоплатно/); // military column
  assert.match(js, /addToCart\(/); // booking from a tariff row
  const bridge = await read("public/site/assets/d1-bridge.js");
  assert.match(bridge, /getElementById\('patientCategory'\)/); // category read at submit
});

test("the Тарифи tab is wired into the workspace and the public price list syncs", async () => {
  const shell = await read("app/staff/workspace-shell.tsx");
  assert.match(shell, /href:"\/staff\/tariffs", label:"Тарифи"/);
  const page = await read("app/staff/tariffs/page.tsx");
  assert.match(page, /active="tariffs"/);
  const priceHtml = await read("public/site/price.html");
  assert.match(priceHtml, /\/api\/tariffs/); // public prices reflect overrides
});
