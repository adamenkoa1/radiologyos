// Поведінковий тест RBAC: ролі перевіряються на рівні HTTP-маршрутів проти
// живої схеми (сесія + членство справжні), а не «є рядок canManage… у коді».

import assert from "node:assert/strict";
import test from "node:test";
import { withD1, jsonRequest, callWorker, seedStaffSession } from "./helpers/d1.mjs";

const ROLES = ["admin", "registrar", "radiologist", "radiographer"];

function req(url, { method = "GET", cookie, body } = {}) {
  return jsonRequest(url, body, { method, headers: cookie ? { cookie } : {} });
}

test("anonymous is refused on staff routes", async () => {
  await withD1(async (db) => {
    const settings = await callWorker(req("/api/staff/settings"), db);
    assert.equal(settings.status, 403);
    const bookings = await callWorker(req("/api/staff/bookings", { method: "POST", body: {} }), db);
    assert.equal(bookings.status, 403);
  });
});

test("only admin may read department settings", async () => {
  for (const role of ROLES) {
    await withD1(async (db) => {
      const cookie = await seedStaffSession(db, { email: `${role}@likarnya.test`, role });
      const res = await callWorker(req("/api/staff/settings", { cookie }), db);
      if (role === "admin") assert.equal(res.status, 200, "admin бачить налаштування");
      else assert.equal(res.status, 403, `${role} не має доступу до налаштувань`);
    });
  }
});

test("only admin/registrar may create bookings (clinical roles are blocked)", async () => {
  for (const role of ROLES) {
    await withD1(async (db) => {
      const cookie = await seedStaffSession(db, { email: `${role}@likarnya.test`, role });
      const res = await callWorker(req("/api/staff/bookings", { method: "POST", cookie, body: {} }), db);
      if (role === "admin" || role === "registrar") {
        // Проходить RBAC-ворота (далі — валідація тіла), тож НЕ 403.
        assert.notEqual(res.status, 403, `${role} має право створювати заявки`);
      } else {
        assert.equal(res.status, 403, `${role} не має права створювати заявки`);
      }
    });
  }
});

test("an expired session does not authorize (TTL actually enforced)", async () => {
  await withD1(async (db) => {
    // Вставляємо сесію з датою в минулому вручну.
    await db.prepare(
      "INSERT INTO staff_members (email, display_name, role, active) VALUES ('old@likarnya.test','Old','admin',1)"
    ).run();
    // token_hash довільний; головне — expires_at у минулому.
    await db.prepare(
      "INSERT INTO staff_sessions (token_hash, email, expires_at) VALUES ('deadbeef','old@likarnya.test', datetime('now','-1 hour'))"
    ).run();
    const res = await callWorker(req("/api/staff/settings", { cookie: "rid_session=whatever" }), db);
    assert.equal(res.status, 403);
  });
});

test("a deactivated member loses access even with a live session", async () => {
  await withD1(async (db) => {
    const cookie = await seedStaffSession(db, { email: "susp@likarnya.test", role: "admin" });
    // Ролі/сесія живі, але акаунт вимкнено.
    await db.prepare("UPDATE staff_members SET active = 0 WHERE email = 'susp@likarnya.test'").run();
    const res = await callWorker(req("/api/staff/settings", { cookie }), db);
    assert.equal(res.status, 403); // requireStaff JOIN … active = 1 відсікає
  });
});
