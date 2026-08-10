import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

const criticalTests = [
  "canonical-public-url.test.mjs",
  "hosting-headers.test.mjs",
  "site-booking.behavior.test.mjs",
  "booking-capacity.test.mjs",
  "staff-confirm-reschedule.behavior.test.mjs",
  "staff-rbac.behavior.test.mjs",
  "patient-otp.behavior.test.mjs",
  "patient-cabinet-tenant.test.mjs",
  "my-bookings.behavior.test.mjs",
  "payment-api.behavior.test.mjs",
  "payment-ledger.behavior.test.mjs",
  "payment-settlement.behavior.test.mjs",
  "study-state.test.mjs",
  "protocol-builder.test.mjs",
  "dashboard.test.mjs",
  "security-hardening.test.mjs",
  "tenant-hardening.test.mjs",
];

test("package exposes a deterministic production release gate manifest", async () => {
  const pkg = JSON.parse(await read("package.json"));
  const gate = pkg.scripts?.["test:production-gate"] ?? "";
  assert.match(gate, /npm run build/);
  assert.match(gate, /node --experimental-strip-types --test/);
  for (const file of criticalTests) {
    assert.match(gate, new RegExp(file.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `${file} must remain release-blocking`);
  }
});

test("CI and production deploy both run the release gate", async () => {
  const ci = await read(".github/workflows/ci.yml");
  const deploy = await read(".github/workflows/deploy.yml");

  assert.match(ci, /name: Production release gate\s+run: npm run test:production-gate/);
  assert.match(deploy, /name: Production release gate\s+run: npm run test:production-gate/);

  const gatePosition = deploy.indexOf("name: Production release gate");
  const migrationsPosition = deploy.indexOf("name: Apply D1 migrations");
  const deployPosition = deploy.indexOf("name: Deploy Worker and assets");
  assert.ok(gatePosition >= 0 && gatePosition < migrationsPosition, "gate must run before D1 migrations");
  assert.ok(gatePosition < deployPosition, "gate must run before Worker deployment");
});

test("manual production smoke document covers the release-critical controls", async () => {
  const doc = await read("docs/production-smoke-checklist.md");
  for (const required of [
    "synthetic",
    "Migration verification",
    "capacity",
    "IDOR",
    "payment",
    "Tenant isolation",
    "Cleanup",
    "Rollback criteria",
    "D1 Time Travel",
    "security headers",
  ]) {
    assert.match(doc, new RegExp(required, "i"), `smoke checklist must cover ${required}`);
  }
  assert.match(doc, /Never enter a real patient/i);
  assert.match(doc, /Do not include patient data/i);
});
