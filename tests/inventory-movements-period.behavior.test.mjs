// Регістр рухів запасів (/staff/inventory, вкладка «Рухи»): серверний фільтр
// періоду Від/До на created_at, і сторінка форматує дату руху через fmtDate
// (а не виводить сирий timestamp).

import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { callWorker, jsonRequest, seedStaffSession, withD1 } from "./helpers/d1.mjs";

const postInventory = (db,cookie,body) => callWorker(jsonRequest("/api/staff/inventory",body,{headers:{cookie}}),db);
const inventoryGet = (db,cookie,search="") => callWorker(new Request(`http://localhost/api/staff/inventory${search}`,{headers:{cookie}}),db);

test("movements register can be scoped by a server-side period", async () => {
  await withD1(async (db) => {
    const admin = await seedStaffSession(db,{email:"mov@example.com",role:"admin",organizationId:1});
    const create = await postInventory(db,admin,{action:"create_item",name:"Контраст 350",category:"contrast",unit:"фл",minStock:2});
    const {id:itemId} = await create.json();
    assert.equal((await postInventory(db,admin,{action:"receive",itemId,quantity:5,lotNumber:"LOT-P"})).status,201);

    const all = await (await inventoryGet(db,admin)).json();
    assert.ok(all.movements.length >= 1, "рух є без фільтра");
    assert.deepEqual(all.movementsPeriod,{from:"",to:""});

    const past = await (await inventoryGet(db,admin,"?to=2000-12-31")).json();
    assert.equal(past.movements.length,0,"рух сьогодні не потрапляє в діапазон до 2000 р.");
    assert.deepEqual(past.movementsPeriod,{from:"",to:"2000-12-31"});

    const future = await (await inventoryGet(db,admin,"?from=2100-01-01")).json();
    assert.equal(future.movements.length,0);

    const wide = await (await inventoryGet(db,admin,"?from=2026-01-01&to=2026-12-31")).json();
    assert.ok(wide.movements.length >= 1);
  });
});

test("inventory page formats the movement date and offers a period filter", async () => {
  const page = await readFile(new URL("../app/staff/inventory/page.tsx",import.meta.url),"utf8");
  assert.match(page,/fmtDate\(m\.createdAt\)/);
  assert.doesNotMatch(page,/<td>\{m\.createdAt\}<\/td>/);
  assert.match(page,/aria-label="Рухи: період від"/);
  assert.match(page,/aria-label="Рухи: період до"/);
  assert.match(page,/movFrom && movTo && movFrom > movTo/);
});
