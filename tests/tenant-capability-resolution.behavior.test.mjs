import assert from "node:assert/strict";
import test from "node:test";
import {
  requireManagementOrgContext,
  requireOrgContext,
  requireSelfServiceOrgContext,
  requireSystemOrgContext,
} from "../lib/tenant.ts";
import { seedStaffSession, withD1 } from "./helpers/d1.mjs";

async function addOrganization(db, id, slug, name) {
  await db.prepare(
    "INSERT INTO organizations (id, slug, name, active) VALUES (?, ?, ?, 1)",
  ).bind(id, slug, name).run();
}

async function addMembership(db, organizationId, email, role) {
  await db.prepare(
    "INSERT INTO memberships (organization_id, member_email, role, active) VALUES (?, ?, ?, 1)",
  ).bind(organizationId, email, role).run();
}

function authenticatedRequest(cookie) {
  return new Request("http://localhost/api/staff/context-test", {
    headers: { cookie },
  });
}

test("tenant context selects the first active membership allowed by each capability", async () => {
  await withD1(async (db) => {
    const email = "multi-capability@example.com";
    const cookie = await seedStaffSession(db, {
      email,
      role: "department_head",
      organizationId: 1,
      displayName: "Multi Capability",
    });
    await addOrganization(db, 2, "medical-two", "Medical Two");
    await addOrganization(db, 3, "system-three", "System Three");
    await addMembership(db, 2, email, "radiologist");
    await addMembership(db, 3, email, "organization_admin");

    const request = authenticatedRequest(cookie);

    const management = await requireManagementOrgContext(request, db);
    assert.equal(management?.organizationId, 1);
    assert.equal(management?.role, "department_head");

    const medical = await requireOrgContext(request, db);
    assert.equal(medical?.organizationId, 2);
    assert.equal(medical?.role, "radiologist");

    const system = await requireSystemOrgContext(request, db);
    assert.equal(system?.organizationId, 3);
    assert.equal(system?.role, "organization_admin");

    const selfService = await requireSelfServiceOrgContext(request, db);
    assert.equal(selfService?.organizationId, 1);
    assert.equal(selfService?.role, "department_head");
  });
});

test("capability resolution still denies when no active membership has an allowed role", async () => {
  await withD1(async (db) => {
    const email = "management-only@example.com";
    const cookie = await seedStaffSession(db, {
      email,
      role: "department_head",
      organizationId: 1,
    });

    const medical = await requireOrgContext(authenticatedRequest(cookie), db);
    assert.equal(medical, null);
  });
});
