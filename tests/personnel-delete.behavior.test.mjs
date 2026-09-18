// Deleting a personnel card: allowed only when no radiation-safety history is
// attached (ON DELETE RESTRICT), tenant-scoped, and leaves the login account alone.

import assert from "node:assert/strict";
import test from "node:test";
import { withD1, callWorker, seedStaffSession } from "./helpers/d1.mjs";

async function seedCard(db, { id, org = 1 }) {
  await db.prepare(
    `INSERT INTO personnel_records
       (id, organization_id, account_email, employment_kind, last_name, first_name, patronymic,
        display_name, date_of_birth, military_rank, position_title, active, created_by, updated_by)
     VALUES (?, ?, NULL, 'military', 'Тест', 'Іван', 'Ігорович', 'Тест Іван Ігорович',
        '1990-01-01', 'солдат', 'Рентгенолаборант', 1, 'test', 'test')`,
  ).bind(id, org).run();
}

const del = (db, cookie, id) =>
  callWorker(new Request(`https://radiologyos.tech/api/staff/personnel?id=${encodeURIComponent(id)}`, {
    method: "DELETE", headers: { cookie },
  }), db);

const cardExists = async (db, id) =>
  Number((await db.prepare("SELECT COUNT(*) AS n FROM personnel_records WHERE id = ?").bind(id).first()).n) > 0;

test("a personnel card with no radiation-safety history can be deleted", async () => {
  await withD1(async (db) => {
    const cookie = await seedStaffSession(db, { email: "hr@example.com", role: "admin", organizationId: 1 });
    await seedCard(db, { id: "card-free" });
    const res = await del(db, cookie, "card-free");
    assert.equal(res.status, 200);
    assert.equal(await cardExists(db, "card-free"), false);
  });
});

test("a card carrying dosimetry history cannot be deleted (must be deactivated)", async () => {
  await withD1(async (db) => {
    const cookie = await seedStaffSession(db, { email: "hr2@example.com", role: "admin", organizationId: 1 });
    await seedCard(db, { id: "card-hist" });
    await db.prepare(
      `INSERT INTO personnel_dosimetry_records
         (id, organization_id, personnel_id, period_start, period_end, measurement_status, created_by)
       VALUES ('dose-1', 1, 'card-hist', '2026-01-01', '2026-03-31', 'measured', 'test')`,
    ).run();
    const res = await del(db, cookie, "card-hist");
    assert.equal(res.status, 409);
    assert.match((await res.json()).error, /Вимкніть картку/);
    assert.equal(await cardExists(db, "card-hist"), true, "card must survive a refused delete");
  });
});

test("a personnel card cannot be deleted across the tenant boundary", async () => {
  await withD1(async (db) => {
    await db.prepare("INSERT INTO organizations (id, slug, name, active) VALUES (2, 'org-b', 'Б', 1)").run();
    const cookieA = await seedStaffSession(db, { email: "hr-a@example.com", role: "admin", organizationId: 1 });
    await seedCard(db, { id: "card-orgb", org: 2 });
    const res = await del(db, cookieA, "card-orgb");
    assert.equal(res.status, 404);
    assert.equal(await cardExists(db, "card-orgb"), true);
  });
});
