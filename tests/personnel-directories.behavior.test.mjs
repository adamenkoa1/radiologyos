// Кадрові довідники (посади/звання): tenant-scoped CRUD через
// /api/staff/personnel/directories, права — адміністратор або керівник
// підрозділу, ізоляція по організації. Значення для org 1 засіяні міграцією 0120.

import assert from "node:assert/strict";
import test from "node:test";
import { withD1, callWorker, seedStaffSession } from "./helpers/d1.mjs";

const ENDPOINT = "https://radiologyos.tech/api/staff/personnel/directories";
const get = (db, cookie) => callWorker(new Request(ENDPOINT, { headers:{ cookie } }), db);
const post = (db, cookie, body) => callWorker(new Request(ENDPOINT, { method:"POST", headers:{ cookie, "content-type":"application/json" }, body:JSON.stringify(body) }), db);
const patch = (db, cookie, body) => callWorker(new Request(ENDPOINT, { method:"PATCH", headers:{ cookie, "content-type":"application/json" }, body:JSON.stringify(body) }), db);

test("seeded positions and ranks are listed for org 1", async () => {
  await withD1(async (db) => {
    const cookie = await seedStaffSession(db, { email:"hr@example.com", role:"admin", organizationId:1 });
    const res = await get(db, cookie);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(body.positions.some((row) => row.name === "Лікар-рентгенолог"), "seeded position present");
    assert.ok(body.ranks.some((row) => row.name === "Сержант"), "seeded rank present");
  });
});

test("a manager can add, rename and hide a directory value", async () => {
  await withD1(async (db) => {
    const cookie = await seedStaffSession(db, { email:"head@example.com", role:"department_head", organizationId:1 });
    const created = await post(db, cookie, { kind:"position", name:"Інженер" });
    assert.equal(created.status, 201);
    const id = (await created.json()).id;
    assert.ok(Number.isInteger(id));
    // duplicate name is rejected
    assert.equal((await post(db, cookie, { kind:"position", name:"Інженер" })).status, 409);
    // rename
    assert.equal((await patch(db, cookie, { kind:"position", id, name:"Інженер-технолог" })).status, 200);
    // soft-hide (active → 0), never a hard delete
    assert.equal((await patch(db, cookie, { kind:"position", id, active:0 })).status, 200);
    const body = await (await get(db, cookie)).json();
    const row = body.positions.find((item) => item.id === id);
    assert.equal(row.name, "Інженер-технолог");
    assert.equal(row.active, 0);
  });
});

test("an unknown kind or empty name is rejected", async () => {
  await withD1(async (db) => {
    const cookie = await seedStaffSession(db, { email:"hr2@example.com", role:"admin", organizationId:1 });
    assert.equal((await post(db, cookie, { kind:"nope", name:"X" })).status, 400);
    assert.equal((await post(db, cookie, { kind:"position", name:"   " })).status, 400);
  });
});

test("non-manager roles cannot read or write personnel directories", async () => {
  await withD1(async (db) => {
    const cookie = await seedStaffSession(db, { email:"rad@example.com", role:"radiographer", organizationId:1 });
    assert.equal((await get(db, cookie)).status, 403);
    assert.equal((await post(db, cookie, { kind:"position", name:"Хтось" })).status, 403);
  });
});

test("directory values are tenant-scoped", async () => {
  await withD1(async (db) => {
    await db.prepare("INSERT INTO organizations (id, slug, name, active) VALUES (2, 'org-b', 'Б', 1)").run();
    const cookieA = await seedStaffSession(db, { email:"a@example.com", role:"admin", organizationId:1 });
    const cookieB = await seedStaffSession(db, { email:"b@example.com", role:"admin", organizationId:2 });
    const id = (await (await post(db, cookieA, { kind:"rank", name:"Прапорщик" })).json()).id;
    const bodyB = await (await get(db, cookieB)).json();
    assert.ok(!bodyB.ranks.some((row) => row.name === "Прапорщик"), "org B must not see org A value");
    // org B cannot patch org A's record
    assert.equal((await patch(db, cookieB, { kind:"rank", id, name:"Змінено" })).status, 404);
  });
});
