import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { callWorker, jsonRequest, seedStaffSession, withD1 } from "./helpers/d1.mjs";

async function setMembershipRole(db, email, role, organizationId = 1) {
  await db.prepare(
    "UPDATE memberships SET role = ?, active = 1 WHERE organization_id = ? AND member_email = ?"
  ).bind(role, organizationId, email).run();
}

async function getProfile(db, cookie) {
  return callWorker(
    jsonRequest("/api/staff/profile", undefined, { method:"GET", headers:{ cookie } }),
    db,
  );
}

async function linkPersonnel(db, email, overrides = {}) {
  const value = {
    id:`personnel-${email}`,
    organizationId:1,
    lastName:"Профільний",
    firstName:"Працівник",
    patronymic:"Тестович",
    displayName:"Профільний Працівник Тестович",
    dateOfBirth:"1985-01-02",
    militaryRank:"Сержант",
    positionTitle:"Рентгенолаборант",
    ...overrides,
  };
  await db.prepare(
    `INSERT INTO personnel_records
      (id, organization_id, account_email, last_name, first_name, patronymic,
       display_name, date_of_birth, military_rank, position_title,
       personal_phone, alternate_email, active, created_by, updated_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', '', 1, 'test', 'test')`
  ).bind(
    value.id, value.organizationId, email, value.lastName, value.firstName, value.patronymic,
    value.displayName, value.dateOfBirth, value.militaryRank, value.positionTitle,
  ).run();
  return value;
}

test("self-profile returns the active tenant membership role, not the legacy global identity role", async () => {
  await withD1(async (db) => {
    const cases = [
      { email:"profile-system@example.com", role:"organization_admin" },
      { email:"profile-head@example.com", role:"department_head" },
      { email:"profile-rad@example.com", role:"radiologist" },
    ];

    for (const item of cases) {
      const cookie = await seedStaffSession(db, { email:item.email, role:"admin", displayName:"Profile User" });
      await setMembershipRole(db, item.email, item.role);

      const response = await getProfile(db, cookie);
      assert.equal(response.status, 200, `${item.role} must be able to read their own profile`);
      const body = await response.json();
      assert.equal(body.profile.email, item.email);
      assert.equal(body.profile.role, item.role);

      const identity = await db.prepare("SELECT role FROM staff_members WHERE email = ?").bind(item.email).first();
      assert.equal(identity.role, "admin", "test keeps legacy global identity role different from membership role");
    }
  });
});

test("self-service updates personal data and date of birth but never self-promotes position or role", async () => {
  await withD1(async (db) => {
    const email = "profile-update@example.com";
    const cookie = await seedStaffSession(db, { email, role:"admin", displayName:"Before" });
    await setMembershipRole(db, email, "organization_admin");
    await db.prepare(
      `UPDATE staff_members SET phone = ?, position_title = ?, military_rank = ? WHERE email = ?`
    ).bind("380501234567", "Системний адміністратор", "Сержант", email).run();
    await linkPersonnel(db, email, {
      positionTitle:"Системний адміністратор",
      militaryRank:"Сержант",
    });

    const response = await callWorker(
      jsonRequest("/api/staff/profile", {
        lastName:"Системний",
        firstName:"Адміністратор",
        patronymic:"Тестович",
        contactEmail:"self@example.com",
        dateOfBirth:"1986-03-04",
        positionTitle:"Самопризначений начальник",
        militaryRank:"Полковник",
        role:"admin",
      }, { method:"PATCH", headers:{ cookie } }),
      db,
    );
    assert.equal(response.status, 200);

    const stored = await db.prepare(
      `SELECT display_name AS displayName, phone, contact_email AS contactEmail,
        position_title AS positionTitle, military_rank AS militaryRank, role
       FROM staff_members WHERE email = ?`
    ).bind(email).first();
    assert.equal(stored.displayName, "Системний Адміністратор Тестович");
    assert.equal(stored.phone, "380501234567");
    assert.equal(stored.contactEmail, "self@example.com");
    assert.equal(stored.positionTitle, "Системний адміністратор");
    assert.equal(stored.militaryRank, "Сержант");
    assert.equal(stored.role, "admin", "self-service must never rewrite the legacy global authorization role");

    const personnel = await db.prepare(
      `SELECT display_name AS displayName, date_of_birth AS dateOfBirth,
        alternate_email AS alternateEmail, position_title AS positionTitle,
        military_rank AS militaryRank
       FROM personnel_records WHERE organization_id = 1 AND account_email = ?`
    ).bind(email).first();
    assert.equal(personnel.displayName, "Системний Адміністратор Тестович");
    assert.equal(personnel.dateOfBirth, "1986-03-04");
    assert.equal(personnel.alternateEmail, "self@example.com");
    assert.equal(personnel.positionTitle, "Системний адміністратор");
    assert.equal(personnel.militaryRank, "Сержант");

    const after = await getProfile(db, cookie);
    assert.equal(after.status, 200);
    const body = await after.json();
    assert.equal(body.profile.role, "organization_admin");
    assert.equal(body.profile.dateOfBirth, "1986-03-04");
    assert.equal(body.profile.hasPersonnelRecord, true);
    assert.equal(body.profile.positionTitle, "Системний адміністратор");

    const audit = await db.prepare(
      `SELECT organization_id AS organizationId, action, details_json AS detailsJson
       FROM security_audit_log WHERE actor_email = ? AND action='profile_update'
       ORDER BY id DESC LIMIT 1`
    ).bind(email).first();
    assert.equal(audit.organizationId, 1);
    assert.equal(audit.action, "profile_update");
    assert.match(String(audit.detailsJson), /dateOfBirthChanged/);
    assert.doesNotMatch(String(audit.detailsJson), /1986-03-04|Системний|self@example|380501234567/);
  });
});

test("date of birth cannot be written without a linked personnel card", async () => {
  await withD1(async (db) => {
    const email = "profile-unlinked@example.com";
    const cookie = await seedStaffSession(db, { email, role:"radiographer", displayName:"Unlinked" });

    const response = await callWorker(
      jsonRequest("/api/staff/profile", { dateOfBirth:"1990-05-06" }, { method:"PATCH", headers:{ cookie } }),
      db,
    );
    assert.equal(response.status, 409);
    assert.match(String((await response.json()).error), /Кадрова картка/);
  });
});

test("profile route uses tenant-scoped personnel data and excludes privileged self-service fields", async () => {
  const route = await readFile(new URL("../app/api/staff/profile/route.ts", import.meta.url), "utf8");
  const tenant = await readFile(new URL("../lib/tenant.ts", import.meta.url), "utf8");

  assert.match(route, /requireSelfServiceOrgContext\(request, db\)/);
  assert.match(route, /p\.organization_id = \?/);
  assert.match(route, /p\.account_email = s\.email/);
  assert.match(route, /date_of_birth AS dateOfBirth/);
  assert.match(route, /personal_phone = COALESCE/);
  assert.match(route, /date_of_birth = COALESCE/);
  assert.match(route, /profile:[\s\S]*role: ctx\.role/);
  assert.doesNotMatch(route, /body\.positionTitle/);
  assert.doesNotMatch(route, /body\.militaryRank/);
  assert.doesNotMatch(route, /body\.role/);
  assert.match(tenant, /SELF_SERVICE_ROLES/);
  assert.match(tenant, /requireSelfServiceOrgContext/);
  assert.match(tenant, /resolveOrgContext\(request, db, SELF_SERVICE_ROLES\)/);
});

test("personal cabinet exposes phone login, birth date and password controls from the profile menu", async () => {
  const [page, shell] = await Promise.all([
    readFile(new URL("../app/staff/profile/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/staff/workspace-shell.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(page, /Особистий кабінет персоналу/);
  assert.match(page, /Логін: номер телефону/);
  assert.match(page, /name="dateOfBirth" type="date"/);
  assert.match(page, /Пароль \/ PIN-код/);
  assert.match(page, /Службові повноваження не можна змінити/);
  assert.match(shell, /href="\/staff\/profile">Особистий кабінет/);
});
