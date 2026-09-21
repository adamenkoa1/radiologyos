// Друкована кадрова картка: версійований, SHA-стемпований, immutable snapshot,
// відтворюваний із payload навіть після зміни картки; tenant-scoped і manager-only.

import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { withD1, callWorker, seedStaffSession } from "./helpers/d1.mjs";

async function seedCard(db, { id, org = 1, name = "Тест Іван Ігорович", position = "Рентгенолаборант", rank = "Сержант" }) {
  await db.prepare(
    `INSERT INTO personnel_records
       (id, organization_id, account_email, employment_kind, last_name, first_name, patronymic,
        display_name, date_of_birth, military_rank, position_title, active, created_by, updated_by)
     VALUES (?, ?, NULL, 'military', 'Тест', 'Іван', 'Ігорович', ?, '1990-01-01', ?, ?, 1, 'test', 'test')`,
  ).bind(id, org, name, rank, position).run();
}

const print = (db, cookie, personnelId) =>
  callWorker(new Request("https://radiologyos.tech/api/staff/personnel/print", {
    method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ personnelId }),
  }), db);

test("printing a personnel card creates a versioned SHA-stamped snapshot", async () => {
  await withD1(async (db) => {
    const cookie = await seedStaffSession(db, { email: "hr@example.com", role: "admin", organizationId: 1 });
    await seedCard(db, { id: "card-print" });
    const res = await print(db, cookie, "card-print");
    assert.equal(res.status, 200);
    const { snapshot, payload } = await res.json();
    assert.equal(snapshot.sha256.length, 64);
    assert.equal(snapshot.templateVersion, 1);
    assert.equal(payload.record.displayName, "Тест Іван Ігорович");
    assert.equal(payload.record.positionTitle, "Рентгенолаборант");
  });
});

test("an unchanged reprint reuses the same snapshot; the stored payload stays reproducible after data changes", async () => {
  await withD1(async (db) => {
    const cookie = await seedStaffSession(db, { email: "hr2@example.com", role: "admin", organizationId: 1 });
    await seedCard(db, { id: "card-repro" });
    const first = await (await print(db, cookie, "card-repro")).json();
    // identical reprint dedups to the same immutable snapshot
    const again = await (await print(db, cookie, "card-repro")).json();
    assert.equal(again.snapshot.id, first.snapshot.id);
    // mutate the underlying record → a new snapshot captures the new state
    await db.prepare("UPDATE personnel_records SET position_title = 'Старший рентгенлаборант', display_name = 'Перейменований' WHERE id = ?").bind("card-repro").run();
    const third = await (await print(db, cookie, "card-repro")).json();
    assert.notEqual(third.snapshot.id, first.snapshot.id);
    assert.equal(third.payload.record.positionTitle, "Старший рентгенлаборант");
    // the FIRST snapshot's stored payload still reproduces the ORIGINAL state
    const stored = await db.prepare("SELECT payload_json FROM personnel_card_snapshots WHERE id = ?").bind(first.snapshot.id).first();
    const oldPayload = JSON.parse(stored.payload_json);
    assert.equal(oldPayload.record.positionTitle, "Рентгенолаборант");
    assert.equal(oldPayload.record.displayName, "Тест Іван Ігорович");
  });
});

test("card snapshots are immutable at the database level", async () => {
  await withD1(async (db, raw) => {
    const cookie = await seedStaffSession(db, { email: "hr3@example.com", role: "admin", organizationId: 1 });
    await seedCard(db, { id: "card-immut" });
    const { snapshot } = await (await print(db, cookie, "card-immut")).json();
    assert.throws(() => raw.prepare("UPDATE personnel_card_snapshots SET generated_by='tamper' WHERE id=?").run(snapshot.id), /personnel_card_snapshot_immutable/);
    assert.throws(() => raw.prepare("DELETE FROM personnel_card_snapshots WHERE id=?").run(snapshot.id), /personnel_card_snapshot_immutable/);
  });
});

test("printing is tenant-scoped and manager-only", async () => {
  await withD1(async (db) => {
    await db.prepare("INSERT INTO organizations (id, slug, name, active) VALUES (2, 'org-b', 'Б', 1)").run();
    const cookieA = await seedStaffSession(db, { email: "a@example.com", role: "admin", organizationId: 1 });
    const cookieB = await seedStaffSession(db, { email: "b@example.com", role: "admin", organizationId: 2 });
    const cookieRad = await seedStaffSession(db, { email: "rad@example.com", role: "radiographer", organizationId: 1 });
    await seedCard(db, { id: "card-a", org: 1 });
    assert.equal((await print(db, cookieB, "card-a")).status, 404); // cross-tenant
    assert.equal((await print(db, cookieRad, "card-a")).status, 403); // non-manager
    assert.equal((await print(db, cookieA, "card-a")).status, 200); // owner manager
  });
});

test("the editor links to the print page and the print page uses the print API", async () => {
  const page = await readFile(new URL("../app/staff/personnel/page.tsx", import.meta.url), "utf8");
  assert.match(page, /\/staff\/personnel\/print\?id=/);
  const printPage = await readFile(new URL("../app/staff/personnel/print/page.tsx", import.meta.url), "utf8");
  assert.match(printPage, /\/api\/staff\/personnel\/print/);
  assert.match(printPage, /financePrintVersion/);
});
