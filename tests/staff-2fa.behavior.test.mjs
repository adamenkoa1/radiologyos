// Двофакторна автентифікація персоналу: гейт на вході, самозапис (enroll),
// вимкнення й адмінське скидання — end-to-end через воркер.

import assert from "node:assert/strict";
import test from "node:test";
import { withD1, callWorker, jsonRequest, seedStaffSession } from "./helpers/d1.mjs";
import { totp, generateTotpSecret } from "../lib/totp.ts";
import { hashPassword } from "../lib/auth.ts";
import { normalizeUkrainianPhone } from "../lib/phone.ts";

const PIN = "135791";
const RAW_PHONE = "0501112233";

// Створює співробітника з логіном (телефон+PIN) і, за потреби, увімкненим 2FA.
async function seedLoginMember(db, { email, role = "admin", secret = "" } = {}) {
  await seedStaffSession(db, { email, role, organizationId: 1 });
  const phone = normalizeUkrainianPhone(RAW_PHONE);
  await db.prepare(
    "UPDATE staff_members SET phone = ?, password_hash = ?, totp_secret = ?, totp_enabled = ? WHERE email = ?"
  ).bind(phone, await hashPassword(PIN), secret, secret ? 1 : 0, email).run();
  return phone;
}

const login = (db, body) => callWorker(jsonRequest("/api/staff/login", body, { method: "POST" }), db);

test("login is gated by TOTP once 2FA is enabled", async () => {
  await withD1(async (db) => {
    const secret = generateTotpSecret();
    await seedLoginMember(db, { email: "boss@example.com", role: "admin", secret });

    // Правильний PIN без коду → просять другий фактор, сесію не видають.
    const step1 = await login(db, { phone: RAW_PHONE, password: PIN });
    assert.equal(step1.status, 200);
    assert.equal((await step1.json()).needsTotp, true);
    assert.equal(step1.headers.get("set-cookie"), null);

    // Невірний код → 401.
    const bad = await login(db, { phone: RAW_PHONE, password: PIN, totpCode: "000000" });
    assert.equal(bad.status, 401);

    // Вірний код → вхід і сесія.
    const good = await login(db, { phone: RAW_PHONE, password: PIN, totpCode: await totp(secret) });
    assert.equal(good.status, 200);
    assert.equal((await good.json()).ok, true);
    assert.match(good.headers.get("set-cookie") || "", /rid_session=/);
  });
});

test("wrong PIN still fails before any TOTP prompt (no account enumeration)", async () => {
  await withD1(async (db) => {
    await seedLoginMember(db, { email: "boss@example.com", role: "admin", secret: generateTotpSecret() });
    const res = await login(db, { phone: RAW_PHONE, password: "000000" });
    assert.equal(res.status, 401);
    const body = await res.json();
    assert.ok(!body.needsTotp); // код не пропонується, поки PIN невірний
  });
});

test("self-enrollment: begin → confirm enables 2FA; wrong confirm code is rejected", async () => {
  await withD1(async (db) => {
    const cookie = await seedStaffSession(db, { email: "reg@example.com", role: "registrar", organizationId: 1 });

    const begin = await callWorker(jsonRequest("/api/staff/2fa", { action: "begin" }, { method: "POST", headers: { cookie } }), db);
    assert.equal(begin.status, 200);
    const { secret, otpauthUri } = await begin.json();
    assert.match(secret, /^[A-Z2-7]+$/);
    assert.match(otpauthUri, /^otpauth:\/\/totp\//);

    // Поки не підтверджено — 2FA вимкнена.
    const midEnabled = await db.prepare("SELECT totp_enabled AS e FROM staff_members WHERE email = 'reg@example.com'").first();
    assert.equal(midEnabled.e, 0);

    const wrong = await callWorker(jsonRequest("/api/staff/2fa", { action: "confirm", code: "000000" }, { method: "POST", headers: { cookie } }), db);
    assert.equal(wrong.status, 400);

    const ok = await callWorker(jsonRequest("/api/staff/2fa", { action: "confirm", code: await totp(secret) }, { method: "POST", headers: { cookie } }), db);
    assert.equal(ok.status, 200);
    assert.equal((await ok.json()).enabled, true);
    const row = await db.prepare("SELECT totp_enabled AS e FROM staff_members WHERE email = 'reg@example.com'").first();
    assert.equal(row.e, 1);
  });
});

test("self-disable requires a valid current code", async () => {
  await withD1(async (db) => {
    const secret = generateTotpSecret();
    const cookie = await seedStaffSession(db, { email: "reg@example.com", role: "registrar", organizationId: 1 });
    await db.prepare("UPDATE staff_members SET totp_secret = ?, totp_enabled = 1 WHERE email = 'reg@example.com'").bind(secret).run();

    const wrong = await callWorker(jsonRequest("/api/staff/2fa", { action: "disable", code: "000000" }, { method: "POST", headers: { cookie } }), db);
    assert.equal(wrong.status, 400);

    const ok = await callWorker(jsonRequest("/api/staff/2fa", { action: "disable", code: await totp(secret) }, { method: "POST", headers: { cookie } }), db);
    assert.equal(ok.status, 200);
    const row = await db.prepare("SELECT totp_enabled AS e, totp_secret AS s FROM staff_members WHERE email = 'reg@example.com'").first();
    assert.equal(row.e, 0);
    assert.equal(row.s, "");
  });
});

test("admin can reset another member's 2FA; a non-admin cannot", async () => {
  await withD1(async (db) => {
    await seedStaffSession(db, { email: "victim@example.com", role: "registrar", organizationId: 1 });
    await db.prepare("UPDATE staff_members SET totp_secret = 'X', totp_enabled = 1 WHERE email = 'victim@example.com'").run();

    const regCookie = await seedStaffSession(db, { email: "reg@example.com", role: "registrar", organizationId: 1 });
    const denied = await callWorker(jsonRequest("/api/staff/2fa", { action: "admin_reset", email: "victim@example.com" }, { method: "POST", headers: { cookie: regCookie } }), db);
    assert.equal(denied.status, 403);
    const still = await db.prepare("SELECT totp_enabled AS e FROM staff_members WHERE email = 'victim@example.com'").first();
    assert.equal(still.e, 1); // не скинуто

    const adminCookie = await seedStaffSession(db, { email: "boss@example.com", role: "admin", organizationId: 1 });
    const ok = await callWorker(jsonRequest("/api/staff/2fa", { action: "admin_reset", email: "victim@example.com" }, { method: "POST", headers: { cookie: adminCookie } }), db);
    assert.equal(ok.status, 200);
    const row = await db.prepare("SELECT totp_enabled AS e, totp_secret AS s FROM staff_members WHERE email = 'victim@example.com'").first();
    assert.equal(row.e, 0);
    assert.equal(row.s, "");
  });
});
