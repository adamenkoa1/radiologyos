// SEO-аудит: доступ (management-контекст) і форма відповіді на живих
// сервісних сторінках із lib/seo-service-pages.

import assert from "node:assert/strict";
import test from "node:test";
import { withD1, callWorker, jsonRequest, seedStaffSession } from "./helpers/d1.mjs";

const get = (db, cookie) =>
  callWorker(jsonRequest("/api/staff/reports/seo", undefined, { method: "GET", headers: { cookie } }), db);

test("адміністратор бачить аудит: score, лічильники, сторінки", async () => {
  await withD1(async (db) => {
    const admin = await seedStaffSession(db, { email: "boss@example.com", role: "admin", organizationId: 1 });
    const res = await get(db, admin);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(body.summary);
    assert.ok(body.summary.pages > 0, "має бути кілька публічних сторінок");
    assert.ok(typeof body.summary.score === "number");
    assert.ok(body.summary.score >= 0 && body.summary.score <= 100);
    assert.ok(Array.isArray(body.issues));
    assert.equal(body.pages.length, body.summary.pages);
    assert.ok(body.rules && body.rules["title-duplicate"]);
  });
});

test("завідувач відділення теж має доступ", async () => {
  await withD1(async (db) => {
    const head = await seedStaffSession(db, { email: "head@example.com", role: "department_head", organizationId: 1 });
    assert.equal((await get(db, head)).status, 200);
  });
});

test("реєстратор не має доступу до аудиту (не management)", async () => {
  await withD1(async (db) => {
    const reg = await seedStaffSession(db, { email: "reg@example.com", role: "registrar", organizationId: 1 });
    assert.equal((await get(db, reg)).status, 403);
  });
});
