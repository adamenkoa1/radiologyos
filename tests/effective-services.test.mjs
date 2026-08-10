import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("effective service resolver is the single merge point for config and tariffs", async () => {
  const lib = await read("lib/effective-services.ts");
  assert.match(lib, /configuredService\(/);
  assert.match(lib, /priceOverrides\(db, organizationId\)/);
  assert.match(lib, /serviceConfigKey\(organizationId\)/);
  assert.match(lib, /tenantConfig \|\| legacyConfig/);
  assert.match(lib, /defaultPrice/);
  assert.match(lib, /customPrice/);
  assert.match(lib, /export async function effectiveServiceByCode/);
});

test("tariff overrides are tenant-scoped through organization-specific settings", async () => {
  const tariffs = await read("lib/tariffs.ts");
  assert.match(tariffs, /tariffOverridesKey\(organizationId\)/);
  assert.match(tariffs, /getSetting\(db, tariffOverridesKey\(organizationId\)\)/);
  assert.match(tariffs, /organizationId === 1 \? legacyPriceOverrides\(db\) : \{\}/);
  assert.match(tariffs, /priceOverrides\(db, organizationId\)/);
});

test("service configuration rejects duplicates and invalid definitions", async () => {
  const config = await read("lib/service-config.ts");
  assert.match(config, /export function validateServiceConfig/);
  assert.match(config, /Код послуги дублюється/);
  assert.match(config, /Невідомий код послуги/);
  assert.match(config, /Некоректний апарат/);
  assert.match(config, /duration % 5 !== 0/);

  const route = await read("app/api/staff/services/route.ts");
  assert.match(route, /validateServiceConfig\(body\.services\)/);
  assert.match(route, /status: 400/);
});

test("staff service configuration is organization-scoped with a legacy fallback", async () => {
  const route = await read("app/api/staff/services/route.ts");
  assert.match(route, /requireOrgContext\(request, db\)/);
  assert.match(route, /serviceConfigKey\(ctx\.organizationId\)/);
  assert.match(route, /ctx\.member\.role !== "admin"/);
  assert.match(route, /organizationId: ctx\.organizationId/);
  assert.doesNotMatch(route, /organizationId: 1/);
});

test("public service visibility and availability use the effective resolver", async () => {
  const publicServices = await read("app/api/public-services/route.ts");
  const availability = await read("app/api/availability/route.ts");

  assert.match(publicServices, /effectiveServices\(db\)/);
  assert.match(publicServices, /durationMinutes: service\.durationMinutes/);
  assert.match(publicServices, /price: service\.price/);
  assert.doesNotMatch(publicServices, /configuredService\(/);

  assert.match(availability, /effectiveServiceByCode\(db, serviceCode, PUBLIC_ORGANIZATION_ID\)/);
  assert.match(availability, /WHERE organization_id = \? AND equipment_id = \?/);
  assert.match(availability, /service\.durationMinutes/);
  assert.match(availability, /price: service\.price/);
  assert.doesNotMatch(availability, /configuredServiceByCode/);
});
