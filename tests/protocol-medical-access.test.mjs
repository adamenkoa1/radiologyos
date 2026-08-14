import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { withD1 } from "./helpers/d1.mjs";

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

test("D1 physically rejects cross-tenant protocol documents and revisions", async () => {
  await withD1(async (db) => {
    await db.prepare("INSERT INTO organizations (id,slug,name,active) VALUES (2,'other-protocol','Other',1)").run();
    const one = await db.prepare(`INSERT INTO bookings
      (organization_id,code,name,phone,service,desired_date,desired_time)
      VALUES (1,'PROTO-ONE','Patient One','+380000000001','CT','2026-08-14','10:00')`).run();
    const two = await db.prepare(`INSERT INTO bookings
      (organization_id,code,name,phone,service,desired_date,desired_time)
      VALUES (2,'PROTO-TWO','Patient Two','+380000000002','CT','2026-08-14','11:00')`).run();
    const bookingOne = Number(one.meta.last_row_id);
    const bookingTwo = Number(two.meta.last_row_id);

    await db.prepare(`INSERT INTO protocols
      (organization_id,booking_id,updated_by) VALUES (1,?,'doctor@one')`).bind(bookingOne).run();
    await db.prepare(`INSERT INTO protocol_revisions
      (organization_id,booking_id,version,template_key,saved_by)
      VALUES (1,?,1,'generic','doctor@one')`).bind(bookingOne).run();

    await assert.rejects(
      db.prepare(`INSERT INTO protocols
        (organization_id,booking_id,updated_by) VALUES (1,?,'doctor@one')`).bind(bookingTwo).run(),
      /tenant mismatch/i,
    );
    await assert.rejects(
      db.prepare(`INSERT INTO protocol_revisions
        (organization_id,booking_id,version,template_key,saved_by)
        VALUES (1,?,1,'generic','doctor@one')`).bind(bookingTwo).run(),
      /tenant mismatch/i,
    );
    await assert.rejects(
      db.prepare("UPDATE protocols SET organization_id=2 WHERE booking_id=?").bind(bookingOne).run(),
      /tenant mismatch/i,
    );
    // Revisions are now stronger than tenant-scoped: once appended, every UPDATE
    // is rejected before a cross-tenant mutation can even be evaluated.
    await assert.rejects(
      db.prepare("UPDATE protocol_revisions SET organization_id=2 WHERE booking_id=?").bind(bookingOne).run(),
      /append-only/i,
    );
  });
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

  const integrity = await read("drizzle/0043_protocol_tenant_integrity.sql");
  assert.match(integrity, /protocols_booking_tenant_insert/);
  assert.match(integrity, /protocol_revisions_booking_tenant_insert/);
  assert.match(integrity, /RAISE\(ABORT, 'protocol booking tenant mismatch'\)/);

  const schema = await read("db/schema.ts");
  assert.match(schema, /export const protocolRevisions[\s\S]*organizationId: integer\("organization_id"\)/);
  assert.match(schema, /protocol_revisions_org_booking_idx/);
  assert.match(schema, /protocols_org_number_idx/);
});
