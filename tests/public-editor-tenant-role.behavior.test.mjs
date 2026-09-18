import assert from "node:assert/strict";
import test from "node:test";
import { callWorker, jsonRequest, seedStaffSession, withD1 } from "./helpers/d1.mjs";

async function setMembershipRole(db, email, role, organizationId = 1) {
  await db.prepare(
    "UPDATE memberships SET role = ?, active = 1 WHERE organization_id = ? AND member_email = ?"
  ).bind(role, organizationId, email).run();
}

const siteGet = (cookie) => jsonRequest("/api/staff/site", undefined, { method:"GET", headers:{ cookie } });
const sitePut = (cookie, brandTitle = "Updated") => jsonRequest(
  "/api/staff/site",
  { content:{ brandTitle } },
  { method:"PUT", headers:{ cookie } },
);
const structureGet = (cookie) => jsonRequest("/api/staff/structure", undefined, { method:"GET", headers:{ cookie } });
const structurePut = (cookie) => jsonRequest(
  "/api/staff/structure",
  { structure:{}, siteContent:{ brandTitle:"Structure update" } },
  { method:"PUT", headers:{ cookie } },
);

test("stale global admin cannot edit public content after membership downgrade", async () => {
  await withD1(async (db) => {
    const email = "stale-site-admin@example.com";
    const cookie = await seedStaffSession(db, { email, role:"admin" });
    await setMembershipRole(db, email, "radiologist");

    assert.equal((await callWorker(siteGet(cookie), db)).status, 403);
    assert.equal((await callWorker(sitePut(cookie, "Denied stale admin"), db)).status, 403);

    const structure = await callWorker(structureGet(cookie), db);
    assert.equal(structure.status, 200, "org1 staff may read the shared structure editor");
    assert.equal((await structure.json()).canEdit, false);
    assert.equal((await callWorker(structurePut(cookie), db)).status, 403);

    const saved = await db.prepare("SELECT value FROM app_settings WHERE key = 'site_content'").first();
    assert.doesNotMatch(String(saved?.value || ""), /Denied stale admin/);
  });
});

test("secondary tenant staff cannot read or mutate the legacy-global public editor", async () => {
  await withD1(async (db) => {
    await db.prepare("INSERT INTO organizations (id, slug, name, active) VALUES (2, 'public-two', 'Public Two', 1)").run();
    const email = "org2-site-admin@example.com";
    const cookie = await seedStaffSession(db, { email, role:"admin", organizationId:2 });

    assert.equal((await callWorker(siteGet(cookie), db)).status, 403);
    assert.equal((await callWorker(sitePut(cookie, "Denied org2"), db)).status, 403);
    assert.equal((await callWorker(structureGet(cookie), db)).status, 403);
    assert.equal((await callWorker(structurePut(cookie), db)).status, 403);

    const saved = await db.prepare("SELECT value FROM app_settings WHERE key = 'site_content'").first();
    assert.doesNotMatch(String(saved?.value || ""), /Denied org2/);
  });
});

test("org1 membership admin is authoritative even when global staff role is non-admin", async () => {
  await withD1(async (db) => {
    const email = "membership-site-admin@example.com";
    const cookie = await seedStaffSession(db, { email, role:"radiologist" });
    await setMembershipRole(db, email, "admin");

    const site = await callWorker(siteGet(cookie), db);
    assert.equal(site.status, 200);
    assert.equal((await site.json()).staff.role, "admin");

    const structure = await callWorker(structureGet(cookie), db);
    assert.equal(structure.status, 200);
    const body = await structure.json();
    assert.equal(body.staff.role, "admin");
    assert.equal(body.canEdit, true);
  });
});

test("public editor routes use tenant membership and explicit primary-tenant guards", async () => {
  const { readFile } = await import("node:fs/promises");
  for (const path of ["../app/api/staff/site/route.ts", "../app/api/staff/structure/route.ts"]) {
    const source = await readFile(new URL(path, import.meta.url), "utf8");
    assert.match(source, /requireOrgContext\(request, db\)/, path);
    assert.doesNotMatch(source, /requireStaff\(request, db\)/, path);
    assert.match(source, /PRIMARY_ORGANIZATION_ID = 1/, path);
    assert.match(source, /ctx\.organizationId !== PRIMARY_ORGANIZATION_ID/, path);
  }
});
