import assert from "node:assert/strict";
import test from "node:test";
import { listOrgStudies } from "../lib/tenant-repo.ts";
import { withD1 } from "./helpers/d1.mjs";

function ctx(role, email, organizationId = 1) {
  return {
    organizationId,
    slug: organizationId === 1 ? "org1" : `org${organizationId}`,
    organizationName: `Org ${organizationId}`,
    role,
    member: { email, displayName: email, role },
  };
}

async function addBooking(db, {
  organizationId = 1,
  code,
  time,
  radiologist = "",
  radiographer = "",
}) {
  await db.prepare(
    `INSERT INTO bookings
      (organization_id, code, name, phone, service, service_code, equipment_id,
       duration_minutes, desired_date, desired_time,
       assigned_radiologist_email, assigned_radiographer_email)
     VALUES (?, ?, ?, '+380500000000', 'CT', 'CT-HEAD', 'ct', 30, '2026-09-01', ?, ?, ?)`
  ).bind(organizationId, code, `Patient ${code}`, time, radiologist, radiographer).run();
}

const codes = (rows) => rows.map((row) => row.code).sort();

test("study registry exposes only assigned studies to radiologists and radiographers", async () => {
  await withD1(async (db) => {
    await db.prepare("INSERT INTO organizations (id, slug, name, active) VALUES (2, 'other-studies', 'Other', 1)").run();

    await addBooking(db, { code:"ASSIGNED-A", time:"09:00", radiologist:"rad-a@example.com", radiographer:"lab-a@example.com" });
    await addBooking(db, { code:"ASSIGNED-B", time:"10:00", radiologist:"rad-b@example.com", radiographer:"lab-b@example.com" });
    await addBooking(db, { code:"UNASSIGNED", time:"11:00" });
    await addBooking(db, { organizationId:2, code:"FOREIGN", time:"12:00", radiologist:"rad-a@example.com", radiographer:"lab-a@example.com" });

    const radiologist = await listOrgStudies(db, ctx("radiologist", "rad-a@example.com"));
    assert.deepEqual(codes(radiologist), ["ASSIGNED-A"]);

    const radiographer = await listOrgStudies(db, ctx("radiographer", "lab-b@example.com"));
    assert.deepEqual(codes(radiographer), ["ASSIGNED-B"]);

    const admin = await listOrgStudies(db, ctx("admin", "admin@example.com"));
    assert.deepEqual(codes(admin), ["ASSIGNED-A", "ASSIGNED-B", "UNASSIGNED"]);

    const registrar = await listOrgStudies(db, ctx("registrar", "registrar@example.com"));
    assert.deepEqual(codes(registrar), ["ASSIGNED-A", "ASSIGNED-B", "UNASSIGNED"]);
  });
});

test("study repository source makes assignment scope part of the query", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(new URL("../lib/tenant-repo.ts", import.meta.url), "utf8");
  assert.match(source, /ctx\.role === "radiologist"/);
  assert.match(source, /b\.assigned_radiologist_email = \?/);
  assert.match(source, /ctx\.role === "radiographer"/);
  assert.match(source, /b\.assigned_radiographer_email = \?/);
  assert.match(source, /WHERE b\.organization_id = \?\$\{assignment\.sql\}/);
});
