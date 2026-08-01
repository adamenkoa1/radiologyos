import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("worker applies browser security headers and rejects cross-site API mutations", async () => {
  const worker = await read("worker/index.ts");
  for (const header of [
    "content-security-policy",
    "cross-origin-resource-policy",
    "strict-transport-security",
    "x-content-type-options",
    "permissions-policy",
    "referrer-policy",
  ]) assert.match(worker, new RegExp(header));
  assert.match(worker, /pathname\.startsWith\("\/api\/"\)/);
  assert.match(worker, /sec-fetch-site/);
  assert.match(worker, /new URL\(origin\)\.origin !== url\.origin/);
});

test("patient data requires a short-lived server-side session", async () => {
  const auth = await read("lib/patient-auth.ts");
  const bookings = await read("app/api/my-bookings/route.ts");
  const protocol = await read("app/api/my-protocol/route.ts");
  assert.match(auth, /PATIENT_SESSION_TTL_SECONDS = 30 \* 60/);
  assert.match(auth, /HttpOnly; Secure; SameSite=Strict/);
  assert.match(bookings, /createPatientSession\(/);
  assert.match(bookings, /phone_normalized = \?/);
  assert.match(protocol, /requirePatientSession\(/);
  assert.doesNotMatch(protocol, /substr\(phone_normalized, -4\)/);
});

test("public booking intake is consented, bounded, idempotent and atomic", async () => {
  const route = await read("app/api/site-booking/route.ts");
  assert.match(route, /MAX_SERVICES_PER_REQUEST = 5/);
  assert.match(route, /idempotency-key/);
  assert.match(route, /booking_requests/);
  assert.match(route, /body\.consent !== true/);
  assert.match(route, /await db\.batch\(statements\)/);
  assert.match(route, /verification_required/);
});

test("staff authorization scopes sensitive records and exports", async () => {
  const auth = await read("lib/staff-auth.ts");
  const bookings = await read("app/api/staff/bookings/route.ts");
  const imaging = await read("app/api/staff/imaging/route.ts");
  const patientsExport = await read("app/api/staff/patients/export/route.ts");
  const reports = await read("app/api/staff/reports/route.ts");
  assert.match(auth, /export async function canAccessBooking/);
  assert.match(bookings, /assigned_radiologist_email = \?/);
  assert.match(imaging, /canAccessBooking\(/);
  assert.match(patientsExport, /canExportPatientData\(member\.role\)/);
  assert.match(reports, /canViewReports\(member\.role\)/);
});

test("protocols use optimistic concurrency and immutable revision history", async () => {
  const route = await read("app/api/staff/protocols/route.ts");
  const migration = await read("drizzle/0016_security_hardening.sql");
  assert.match(route, /baseVersion/);
  assert.match(route, /existing\?\.status === "issued"/);
  assert.match(route, /INSERT INTO protocol_revisions/);
  assert.match(route, /await db\.batch\(/);
  assert.match(migration, /UNIQUE\(`booking_id`, `version`\)/);
});

test("server-side integrations block SSRF and oversized responses", async () => {
  const outbound = await read("lib/outbound.ts");
  // Доставлення нагадувань перенесено у месенджинг-провайдер; захист від SSRF
  // лишається на кожному зовнішньому виклику (safeOutboundUrl + fetchLimited).
  const messaging = await read("lib/providers/messaging.ts");
  const telegram = await read("lib/telegram.ts");
  assert.match(outbound, /privateHostname/);
  assert.match(outbound, /url\.protocol !== "https:"/);
  assert.match(outbound, /redirect: "error"/);
  assert.match(outbound, /MAX_RESPONSE_BYTES/);
  assert.match(outbound, /AbortController/);
  assert.match(messaging, /safeOutboundUrl\(url\)/);
  assert.match(messaging, /fetchLimited\(/);
  assert.doesNotMatch(telegram, /notice\.category|notice\.services/);
});

test("legacy browser data gateway and fake document uploads are absent", async () => {
  const index = await read("public/site/index.html");
  const price = await read("public/site/price.html");
  const military = await read("public/site/military.html");
  const cart = await read("public/site/assets/cart.js");
  for (const page of [index, price, military]) {
    assert.doesNotMatch(page, /assets\/notify\.js/);
    assert.doesNotMatch(page, /type=["']file["']/);
  }
  assert.doesNotMatch(cart, /radiologyos_applications_v1/);
});

test("production deployment refuses to migrate without a secure active administrator", async () => {
  const workflow = await read(".github/workflows/deploy.yml");
  const guard = workflow.indexOf("Verify a secure active administrator exists");
  const migrations = workflow.indexOf("Apply D1 migrations");
  assert.ok(guard > -1);
  assert.ok(migrations > guard);
  assert.match(workflow, /secure_admins/);
  assert.match(workflow, /count < 1/);
});

test("Cloudflare deployment uses custom domains only", async () => {
  const config = await read("wrangler.cloudflare.toml");
  assert.match(config, /\nworkers_dev = false\n/);
  assert.match(config, /pattern = "radiologyos\.tech", custom_domain = true/);
  assert.match(config, /pattern = "www\.radiologyos\.tech", custom_domain = true/);
  assert.doesNotMatch(config, /\n\[triggers\]\n/);
  assert.doesNotMatch(config, /\ncrons\s*=/);
});
