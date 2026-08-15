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
  assert.match(route, /effectiveServices\(db, ctx\.organizationId\)/);
  assert.match(route, /effectiveServices: effective/);
  assert.match(route, /ctx\.member\.role !== "admin"/);
  assert.match(route, /organizationId: ctx\.organizationId/);
  assert.doesNotMatch(route, /organizationId: 1/);
});

test("public and staff availability use the effective resolver with server-derived tenant scope", async () => {
  const publicServices = await read("app/api/public-services/route.ts");
  const availability = await read("app/api/availability/route.ts");

  assert.match(publicServices, /effectiveServices\(db\)/);
  assert.match(publicServices, /durationMinutes: service\.durationMinutes/);
  assert.match(publicServices, /price: service\.price/);
  assert.doesNotMatch(publicServices, /configuredService\(/);

  assert.match(availability, /requireOrgContext\(request, db\)/);
  assert.match(availability, /staffContext\?\.organizationId \?\? PUBLIC_ORGANIZATION_ID/);
  assert.match(availability, /effectiveServiceByCode\(db, serviceCode, organizationId\)/);
  assert.match(availability, /WHERE organization_id = \? AND equipment_id = \?/);
  assert.match(availability, /service\.durationMinutes/);
  assert.match(availability, /price: service\.price/);
  assert.doesNotMatch(availability, /configuredServiceByCode/);
});

test("staff booking UI consumes effective services rather than the static catalog", async () => {
  const page = await read("app/staff/book/page.tsx");
  assert.match(page, /fetch\("\/api\/staff\/services"/);
  assert.match(page, /effectiveServices\?: EffectiveService\[\]/);
  assert.match(page, /service\.active && \(category === "military" \? service\.military : service\.civilian\)/);
  assert.doesNotMatch(page, /groupedServices|serviceByCode/);
});

test("staff booking mutations resolve effective services and preserve booking price snapshots", async () => {
  const route = await read("app/api/staff/bookings/route.ts");
  const projection = await read("lib/staff-booking-projection.ts");
  assert.match(route, /effectiveServiceByCode\(db, serviceCode, ctx\.organizationId\)/);
  assert.match(route, /serviceAvailableTo\(service, category\)/);
  assert.match(route, /paymentStatus, service\.price/);
  assert.match(route, /projectBookingForStaff\(booking, capabilities\)/);
  assert.match(projection, /booking\.listedPrice = Number\(booking\.paymentAmount\) \|\| 0/);
  assert.match(route, /effectiveServiceByCode\(db, e\.serviceCode\.trim\(\)\.slice\(0, 12\), ctx\.organizationId\)/);
  assert.match(route, /binds\.push\(svc\.price\)/);
  assert.doesNotMatch(route, /effectivePrice\(/);
  assert.doesNotMatch(route, /serviceByCode\(/);
});
