import assert from "node:assert/strict";
import test from "node:test";
import { callWorker, seedStaffSession, withD1 } from "./helpers/d1.mjs";

function reportsRequest(cookie, path = "/api/staff/reports") {
  return new Request(`http://localhost${path}`, { headers:{ cookie } });
}

test("reports expose only current-tenant export history and staff options", async () => {
  await withD1(async (db) => {
    const cookie = await seedStaffSession(db, { email:"org1-admin@reports.test", role:"admin", displayName:"Org One Admin" });
    // Resolve the signed-in admin into org 1 before adding another tenant.
    let response = await callWorker(reportsRequest(cookie), db);
    assert.equal(response.status, 200);

    await db.prepare("INSERT INTO organizations (id, slug, name, active) VALUES (2, 'reports-org2', 'Reports Org 2', 1)").run();
    await db.prepare(
      `INSERT INTO staff_members (email, display_name, role, active)
       VALUES ('org2-secret@reports.test', 'ORG2 SECRET STAFF', 'admin', 1)`
    ).run();
    await db.prepare(
      `INSERT INTO memberships (organization_id, member_email, role, active)
       VALUES (2, 'org2-secret@reports.test', 'admin', 1)`
    ).run();

    await db.prepare(
      `INSERT INTO report_exports
        (organization_id, requested_by, report_type, filters_json, columns_json, format, row_count, contains_personal_data)
       VALUES
        (1, 'org1-admin@reports.test', 'summary', '{}', '[]', 'xlsx', 1, 0),
        (2, 'org2-secret@reports.test', 'ORG2-SECRET-REPORT', '{}', '[]', 'xlsx', 999, 1)`
    ).run();

    response = await callWorker(reportsRequest(cookie), db);
    assert.equal(response.status, 200);
    const body = await response.json();
    const serialized = JSON.stringify(body);

    assert.equal(body.exportHistory.length, 1);
    assert.equal(body.exportHistory[0].requestedBy, "org1-admin@reports.test");
    assert.equal(body.filterOptions.staff.some((row) => row.email === "org1-admin@reports.test"), true);
    assert.equal(body.filterOptions.staff.some((row) => row.email === "org2-secret@reports.test"), false);
    for (const forbidden of ["ORG2 SECRET STAFF", "ORG2-SECRET-REPORT", "org2-secret@reports.test"]) {
      assert.equal(serialized.includes(forbidden), false, `reports leaked ${forbidden}`);
    }

    const audit = await db.prepare(
      `SELECT organization_id AS organizationId FROM security_audit_log
       WHERE action = 'report_viewed' AND actor_email = ? ORDER BY id DESC LIMIT 1`
    ).bind("org1-admin@reports.test").first();
    assert.equal(Number(audit?.organizationId), 1);
  });
});

test("report export audit is owned by the signed-in organization", async () => {
  await withD1(async (db) => {
    const cookie = await seedStaffSession(db, { email:"export-admin@reports.test", role:"admin" });
    // Establish org 1 membership through the normal server path.
    const initial = await callWorker(reportsRequest(cookie), db);
    assert.equal(initial.status, 200);

    const response = await callWorker(reportsRequest(cookie, "/api/staff/reports/export"), db);
    assert.equal(response.status, 200);

    const audit = await db.prepare(
      `SELECT organization_id AS organizationId FROM security_audit_log
       WHERE action = 'report_exported' AND actor_email = ? ORDER BY id DESC LIMIT 1`
    ).bind("export-admin@reports.test").first();
    assert.equal(Number(audit?.organizationId), 1);

    const exportRow = await db.prepare(
      `SELECT organization_id AS organizationId FROM report_exports
       WHERE requested_by = ? ORDER BY id DESC LIMIT 1`
    ).bind("export-admin@reports.test").first();
    assert.equal(Number(exportRow?.organizationId), 1);
  });
});
