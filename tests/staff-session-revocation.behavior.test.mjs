import assert from "node:assert/strict";
import test from "node:test";
import { callWorker, jsonRequest, seedStaffSession, withD1 } from "./helpers/d1.mjs";

test("disabling the final active membership revokes that identity's sessions", async () => {
  await withD1(async (db) => {
    const phone = "380502225566";
    const email = `${phone}@phone.local`;
    await seedStaffSession(db, {
      email,
      role: "radiologist",
      displayName: "Останній Працівник Іванович",
      organizationId: 1,
    });
    await db.prepare(
      `UPDATE staff_members SET
         phone = ?, display_name = 'Останній Працівник Іванович',
         last_name = 'Останній', first_name = 'Працівник', patronymic = 'Іванович',
         contact_email = 'last@example.com', military_rank = 'капітан',
         position_title = 'лікар-рентгенолог'
       WHERE email = ?`,
    ).bind(phone, email).run();

    const adminCookie = await seedStaffSession(db, {
      email: "final-membership-admin@example.com",
      role: "admin",
      organizationId: 1,
    });

    const response = await callWorker(jsonRequest(
      "/api/staff/members",
      {
        phone: `+${phone}`,
        lastName: "Останній",
        firstName: "Працівник",
        patronymic: "Іванович",
        contactEmail: "last@example.com",
        militaryRank: "капітан",
        positionTitle: "лікар-рентгенолог",
        role: "radiologist",
        active: false,
      },
      { headers: { cookie: adminCookie } },
    ), db);
    assert.equal(response.status, 201);

    const membership = await db.prepare(
      "SELECT active FROM memberships WHERE organization_id = 1 AND member_email = ?",
    ).bind(email).first();
    assert.equal(membership.active, 0);

    const victimSessions = await db.prepare(
      "SELECT COUNT(*) AS n FROM staff_sessions WHERE email = ?",
    ).bind(email).first();
    assert.equal(victimSessions.n, 0);

    const adminSessions = await db.prepare(
      "SELECT COUNT(*) AS n FROM staff_sessions WHERE email = 'final-membership-admin@example.com'",
    ).first();
    assert.equal(adminSessions.n, 1);
  });
});
