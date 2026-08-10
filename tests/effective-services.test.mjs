import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("effective service resolver is the single merge point for config and tariffs", async () => {
  const lib = await read("lib/effective-services.ts");
  assert.match(lib, /configuredService\(/);
  assert.match(lib, /priceOverrides\(/);
  assert.match(lib, /defaultPrice/);
  assert.match(lib, /customPrice/);
  assert.match(lib, /export async function effectiveServiceByCode/);
});

test("public service visibility and availability use the effective resolver", async () => {
  const publicServices = await read("app/api/public-services/route.ts");
  const availability = await read("app/api/availability/route.ts");

  assert.match(publicServices, /effectiveServices\(db\)/);
  assert.match(publicServices, /durationMinutes: service\.durationMinutes/);
  assert.match(publicServices, /price: service\.price/);
  assert.doesNotMatch(publicServices, /configuredService\(/);

  assert.match(availability, /effectiveServiceByCode\(db, serviceCode\)/);
  assert.match(availability, /service\.durationMinutes/);
  assert.match(availability, /price: service\.price/);
  assert.doesNotMatch(availability, /configuredServiceByCode/);
});
