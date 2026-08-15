import assert from "node:assert/strict";
import test from "node:test";
import { callWorker, jsonRequest, seedStaffSession, withD1 } from "./helpers/d1.mjs";

async function addOrganizationTwo(db) {
  await db.prepare(
    "INSERT INTO organizations (id, slug, name, active) VALUES (2, 'staff-two', 'Staff Two', 1)",
  ).run();
}

const sharedProfile = {
  lastName: "Спільний",
  firstName: "Працівник",
  patronymic: "Іванович",
  contactEmail: "shared@example.com",
  militaryRank: "капітан",
  positionTitle: "лікар-рентгенолог",
};

async function seedSharedIdentity(db, phone = "380502225577") {
  const email = `${phone}@phone.local`;
  await seedStaffSession(db, {
    email,
    role: "radiologist",
    displayName: `${sharedProfile.lastName} ${sharedProfile.firstName} ${sharedProfile.patronymic}`,
    organizationId: 1,
  });
  await db.prepare(
    `UPDATE staff_members SET
       phone = ?, display_name = ?, last_name = ?, first_name = ?, patronymic = ?,
       contact_email = ?, military_rank = ?, position_title = ?, password_hash = ?
     WHERE email = ?`,
  ).bind(
    phone,
    `${sharedProfile.lastName} ${sharedProfile.firstName} ${sharedProfile.patronymic}`,
    sharedProfile.lastName,
    sharedProfile.firstName,
    sharedProfile.patronymic,
    sharedProfile.contactEmail,
    sharedProfile.militaryRank,
    sharedProfile.positionTitle,
    "original-shared-hash",
    email,
  ).run();
  return { email, phone };
}

async function org2AdminCookie(db) {
  return seedStaffSession(db, {
    email: "org2-admin@example.com",
    role: "admin",
    organizationId: 2,
  });
}

function memberBody(phone, overrides = {}) {
  return {
    phone: `+${phone}`,
    ...sharedProfile,
    role: "registrar",
    active: true,
    ...overrides,
  };
}

test("secondary tenant cannot overwrite another tenant staff identity, PIN, or sessions", async () => {
  await withD1(async (db) => {
    await addOrganizationTwo(db);
    const victim = await seedSharedIdentity(db);
    const adminCookie = await org2AdminCookie(db);

    const response = await callWorker(jsonRequest(
      "/api/staff/members",
      memberBody(victim.phone, {
        lastName: "Захоплений",
        positionTitle: "чужа посада",
        password: "654321",
      }),
      { headers: { cookie: adminCookie } },
    ), db);
    assert.equal(response.status, 409);

    const identity = await db.prepare(
      `SELECT last_name AS lastName, position_title AS positionTitle, password_hash AS passwordHash
       FROM staff_members WHERE email = ?`,
    ).bind(victim.email).first();
    assert.equal(identity.lastName, sharedProfile.lastName);
    assert.equal(identity.positionTitle, sharedProfile.positionTitle);
    assert.equal(identity.passwordHash, "original-shared-hash");

    const sessionCount = await db.prepare(
      "SELECT COUNT(*) AS n FROM staff_sessions WHERE email = ?",
    ).bind(victim.email).first();
    assert.equal(sessionCount.n, 1);

    const foreignMembership = await db.prepare(
      "SELECT role, active FROM memberships WHERE organization_id = 2 AND member_email = ?",
    ).bind(victim.email).first();
    assert.equal(foreignMembership, null);

    const ownerMembership = await db.prepare(
      "SELECT role, active FROM memberships WHERE organization_id = 1 AND member_email = ?",
    ).bind(victim.email).first();
    assert.equal(ownerMembership.role, "radiologist");
    assert.equal(ownerMembership.active, 1);
  });
});

test("shared identity may attach and change only its local membership without global logout", async () => {
  await withD1(async (db) => {
    await addOrganizationTwo(db);
    const victim = await seedSharedIdentity(db, "380502225588");
    const adminCookie = await org2AdminCookie(db);

    const attach = await callWorker(jsonRequest(
      "/api/staff/members",
      memberBody(victim.phone),
      { headers: { cookie: adminCookie } },
    ), db);
    assert.equal(attach.status, 201);

    const changeLocalAccess = await callWorker(jsonRequest(
      "/api/staff/members",
      memberBody(victim.phone, { role: "radiographer", active: false }),
      { headers: { cookie: adminCookie } },
    ), db);
    assert.equal(changeLocalAccess.status, 201);

    const org1 = await db.prepare(
      "SELECT role, active FROM memberships WHERE organization_id = 1 AND member_email = ?",
    ).bind(victim.email).first();
    const org2 = await db.prepare(
      "SELECT role, active FROM memberships WHERE organization_id = 2 AND member_email = ?",
    ).bind(victim.email).first();
    assert.equal(org1.role, "radiologist");
    assert.equal(org1.active, 1);
    assert.equal(org2.role, "radiographer");
    assert.equal(org2.active, 0);

    const identity = await db.prepare(
      `SELECT last_name AS lastName, position_title AS positionTitle, password_hash AS passwordHash
       FROM staff_members WHERE email = ?`,
    ).bind(victim.email).first();
    assert.equal(identity.lastName, sharedProfile.lastName);
    assert.equal(identity.positionTitle, sharedProfile.positionTitle);
    assert.equal(identity.passwordHash, "original-shared-hash");

    const sessionCount = await db.prepare(
      "SELECT COUNT(*) AS n FROM staff_sessions WHERE email = ?",
    ).bind(victim.email).first();
    assert.equal(sessionCount.n, 1);
  });
});

test("single-tenant identity can still update its profile and reset PIN", async () => {
  await withD1(async (db) => {
    await addOrganizationTwo(db);
    const phone = "380502225599";
    const email = `${phone}@phone.local`;
    await seedStaffSession(db, { email, role: "radiographer", organizationId: 2 });
    await db.prepare(
      `UPDATE staff_members SET phone = ?, last_name = 'Старий', first_name = 'Профіль',
       display_name = 'Старий Профіль', position_title = 'лаборант', password_hash = 'old-hash'
       WHERE email = ?`,
    ).bind(phone, email).run();
    const adminCookie = await org2AdminCookie(db);

    const response = await callWorker(jsonRequest(
      "/api/staff/members",
      {
        phone: `+${phone}`,
        lastName: "Новий",
        firstName: "Профіль",
        patronymic: "",
        contactEmail: "",
        militaryRank: "",
        positionTitle: "старший лаборант",
        role: "radiographer",
        active: true,
        password: "123456",
      },
      { headers: { cookie: adminCookie } },
    ), db);
    assert.equal(response.status, 201);

    const identity = await db.prepare(
      `SELECT last_name AS lastName, position_title AS positionTitle, password_hash AS passwordHash
       FROM staff_members WHERE email = ?`,
    ).bind(email).first();
    assert.equal(identity.lastName, "Новий");
    assert.equal(identity.positionTitle, "старший лаборант");
    assert.notEqual(identity.passwordHash, "old-hash");
    assert.match(identity.passwordHash, /^pbkdf2\$sha256\$/);

    const sessionCount = await db.prepare(
      "SELECT COUNT(*) AS n FROM staff_sessions WHERE email = ?",
    ).bind(email).first();
    assert.equal(sessionCount.n, 0);
  });
});
