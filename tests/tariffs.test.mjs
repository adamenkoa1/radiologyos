import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("legacy tariff table remains available as migration fallback", async () => {
  const migration = await read("drizzle/0011_service_prices.sql");
  assert.match(migration, /CREATE TABLE IF NOT EXISTS `service_prices`/);
  assert.match(migration, /`code` text PRIMARY KEY/);
  const journal = JSON.parse(await read("drizzle/meta/_journal.json"));
  assert.ok(journal.entries.some((e) => e.tag === "0011_service_prices"));
  const schema = await read("db/schema.ts");
  assert.match(schema, /export const servicePrices = sqliteTable\("service_prices"/);
});

test("tariffs API is organization-scoped and only admin writes", async () => {
  const route = await read("app/api/staff/tariffs/route.ts");
  assert.match(route, /requireOrgContext\(request, db\)/);
  assert.match(route, /ctx\.member\.role !== "admin"/);
  assert.match(route, /tariffList\(db, ctx\.organizationId\)/);
  assert.match(route, /tariffOverridesKey\(ctx\.organizationId\)/);
  assert.match(route, /setSetting\(/);
  assert.doesNotMatch(route, /INSERT INTO service_prices/);
  assert.doesNotMatch(route, /DELETE FROM service_prices/);
});

test("tenant tariff storage uses org-specific settings with legacy fallback only for org 1", async () => {
  const lib = await read("lib/tariffs.ts");
  assert.match(lib, /export function tariffOverridesKey/);
  assert.match(lib, /getSetting\(db, tariffOverridesKey\(organizationId\)\)/);
  assert.match(lib, /organizationId === 1 \? legacyPriceOverrides\(db\) : \{\}/);
  assert.match(lib, /WHERE organization_id = 1/);
});

test("booking paths use server-derived effective prices", async () => {
  const lib = await read("lib/tariffs.ts");
  assert.match(lib, /export async function effectivePrice/);

  const site = await read("app/api/site-booking/route.ts");
  assert.match(site, /effectiveServices\(db, PUBLIC_ORGANIZATION_ID\)/);
  assert.match(site, /paymentStatus, verifiedService\.price/);
  assert.doesNotMatch(site, /effectivePrice\(/);

  const legacy = await read("app/api/bookings/route.ts");
  assert.match(legacy, /effectiveServiceByCode\(db, serviceCode, PUBLIC_ORGANIZATION_ID\)/);
  assert.match(legacy, /service\.price/);
  assert.doesNotMatch(legacy, /effectivePrice\(/);
});

test("public catalog and tariff map use the canonical effective service source", async () => {
  const catalog = await read("app/api/catalog/route.ts");
  const tariffs = await read("app/api/tariffs/route.ts");
  assert.match(catalog, /effectiveServices\(db\)/);
  assert.doesNotMatch(catalog, /priceOverrides\(/);
  assert.match(tariffs, /effectiveServices\(db\)/);
  assert.doesNotMatch(tariffs, /priceOverrides\(/);

  const index = await read("public/site/index.html");
  assert.doesNotMatch(index, /id="homeTariffs"/);
  assert.doesNotMatch(index, /assets\/home-tariffs\.js/);
  assert.match(index, /id="patientCategory"/);
  const bridge = await read("public/site/assets/d1-bridge.js");
  assert.match(bridge, /getElementById\('patientCategory'\)/);
});

test("the Тарифи tab is wired into the workspace and the public price list syncs", async () => {
  const shell = await read("app/staff/workspace-shell.tsx");
  assert.match(shell, /key:"services",label:"Послуги"/);
  assert.match(shell, /label:"Тарифи",href:"\/staff\/tariffs"/);
  const page = await read("app/staff/tariffs/page.tsx");
  assert.match(page, /active="tariffs"/);
  const priceHtml = await read("public/site/price.html");
  assert.match(priceHtml, /\/api\/tariffs/);
});
