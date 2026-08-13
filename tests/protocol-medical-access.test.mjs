import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("protocol document, revisions and booking mutations are tenant scoped", async () => {
  const route = await read("app/api/staff/protocols/route.ts");
  assert.match(route, /FROM bookings WHERE id = \? AND organization_id = \? LIMIT 1/);
  assert.match(route, /FROM protocols WHERE booking_id = \? AND organization_id = \? LIMIT 1/);
  assert.match(route, /FROM protocol_revisions WHERE booking_id = \? AND organization_id = \?/);
  assert.match(route, /WHERE organization_id = \? AND number = \? AND booking_id != \?/);
  assert.match(route, /\(organization_id, booking_id, template_key/);
  assert.match(route, /INSERT INTO protocol_revisions[\s\S]*\(organization_id, booking_id, version/);
  assert.match(route, /WHERE id = \? AND organization_id = \?/);
  assert.match(route, /INSERT INTO booking_events \(organization_id, booking_id/);
});

test("protocol access and lifecycle writes are security audited with tenant attribution", async () => {
  const route = await read("app/api/staff/protocols/route.ts");
  assert.match(route, /organizationId: ctx\.organizationId,[\s\S]*action: "protocol_viewed"/);
  assert.match(route, /action: document\.status === "issued" \? "protocol_issued" : "protocol_saved"/);
});

test("patient can only read an issued tenant protocol and the access is audited without PII actor data", async () => {
  const route = await read("app/api/my-protocol/route.ts");
  assert.match(route, /WHERE organization_id = \? AND code = \? AND phone_normalized = \?/);
  assert.match(route, /WHERE organization_id = \? AND booking_id = \? AND status = 'issued'/);
  assert.match(route, /actorEmail: "patient_session"/);
  assert.match(route, /action: "patient_protocol_viewed"/);
  assert.match(route, /organizationId: session\.organizationId/);
});

test("migration repairs protocol ownership and tenant-scopes immutable revisions", async () => {
  const migration = await read("drizzle/0034_protocol_medical_access_scope.sql");
  assert.match(migration, /UPDATE `protocols`[\s\S]*FROM `bookings`/);
  assert.match(migration, /ALTER TABLE `protocol_revisions` ADD COLUMN `organization_id`/);
  assert.match(migration, /protocol_revisions_org_booking_idx/);
  assert.match(migration, /protocols_org_number_idx/);
  assert.match(migration, /WHERE `action` = 'protocol_document_saved'/);
});
