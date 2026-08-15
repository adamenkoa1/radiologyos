import assert from "node:assert/strict";
import test from "node:test";
import { callWorker, jsonRequest, seedStaffSession, withD1 } from "./helpers/d1.mjs";

async function addOrganization(db, id, slug, name) {
  await db.prepare(
    "INSERT INTO organizations (id, slug, name, active) VALUES (?, ?, ?, 1)",
  ).bind(id, slug, name).run();
}

async function addMembership(db, organizationId, email, role = "admin") {
  await db.prepare(
    `INSERT INTO memberships (organization_id, member_email, role, active)
     VALUES (?, ?, ?, 1)`,
  ).bind(organizationId, email, role).run();
}

async function seedBooking(db, organizationId, code) {
  const result = await db.prepare(
    `INSERT INTO bookings
      (organization_id, code, name, phone, service, service_code, equipment_id,
       desired_date, desired_time, patient_category, status, performed_at)
     VALUES (?, ?, 'Пацієнт', '+380501112233', 'КТ ОГК', '403', 'ct',
       '2026-08-20', '10:00', 'civilian', 'completed', '2026-08-20T10:30:00')`,
  ).bind(organizationId, code).run();
  return Number(result.meta.last_row_id);
}

test("PACS settings are isolated by organization", async () => {
  await withD1(async (db) => {
    await addOrganization(db, 2, "second-clinic", "Second Clinic");

    const cookie1 = await seedStaffSession(db, { email: "admin-one@example.com", role: "admin", withMembership: false });
    const cookie2 = await seedStaffSession(db, { email: "admin-two@example.com", role: "admin", withMembership: false });
    await addMembership(db, 1, "admin-one@example.com");
    await addMembership(db, 2, "admin-two@example.com");

    const put1 = await callWorker(jsonRequest("/api/staff/imaging/settings", {
      dicomwebBaseUrl: "https://pacs-one.example.com/dicom-web",
      viewerBaseUrl: "https://viewer-one.example.com/viewer",
      aeTitle: "RADONE",
      enabled: true,
      notes: "org one",
    }, { method: "PUT", headers: { cookie: cookie1 } }), db, {
      OUTBOUND_ALLOWED_HOSTS: "pacs-one.example.com",
    });
    assert.equal(put1.status, 200);

    const put2 = await callWorker(jsonRequest("/api/staff/imaging/settings", {
      dicomwebBaseUrl: "https://pacs-two.example.com/dicom-web",
      viewerBaseUrl: "https://viewer-two.example.com/viewer",
      aeTitle: "RADTWO",
      enabled: true,
      notes: "org two",
    }, { method: "PUT", headers: { cookie: cookie2 } }), db, {
      OUTBOUND_ALLOWED_HOSTS: "pacs-two.example.com",
    });
    assert.equal(put2.status, 200);

    const get1 = await callWorker(jsonRequest("/api/staff/imaging/settings", undefined, {
      method: "GET", headers: { cookie: cookie1 },
    }), db);
    const get2 = await callWorker(jsonRequest("/api/staff/imaging/settings", undefined, {
      method: "GET", headers: { cookie: cookie2 },
    }), db);
    assert.equal(get1.status, 200);
    assert.equal(get2.status, 200);
    const body1 = await get1.json();
    const body2 = await get2.json();
    assert.equal(body1.settings.aeTitle, "RADONE");
    assert.equal(body2.settings.aeTitle, "RADTWO");
    assert.equal(body1.settings.notes, "org one");
    assert.equal(body2.settings.notes, "org two");

    const rows = await db.prepare(
      "SELECT organization_id AS organizationId, ae_title AS aeTitle FROM pacs_settings ORDER BY organization_id",
    ).all();
    assert.deepEqual(rows.results.map((row) => [row.organizationId, row.aeTitle]), [[1, "RADONE"], [2, "RADTWO"]]);
  });
});

test("imaging linkage and audit events cannot cross tenant scope", async () => {
  await withD1(async (db) => {
    await addOrganization(db, 2, "second-clinic", "Second Clinic");
    const cookie1 = await seedStaffSession(db, { email: "image-one@example.com", role: "admin", withMembership: false });
    const cookie2 = await seedStaffSession(db, { email: "image-two@example.com", role: "admin", withMembership: false });
    await addMembership(db, 1, "image-one@example.com");
    await addMembership(db, 2, "image-two@example.com");

    const booking1 = await seedBooking(db, 1, "IMG-ORG-1");
    const booking2 = await seedBooking(db, 2, "IMG-ORG-2");

    // This test covers tenant scoping only. A supplied StudyInstanceUID now
    // requires PACS-backed identity verification and is covered by the dedicated
    // DICOM link-verification tests; manual metadata may still be tenant-scoped.
    const link2 = await callWorker(jsonRequest("/api/staff/imaging", {
      bookingId: booking2,
      accessionNumber: "ACC-ORG-2",
      modality: "CT",
      studyStatus: "available",
      studyDatetime: "2026-08-20T10:30:00",
    }, { method: "PUT", headers: { cookie: cookie2 } }), db);
    assert.equal(link2.status, 200);

    const foreignRead = await callWorker(jsonRequest(`/api/staff/imaging?bookingId=${booking2}`, undefined, {
      method: "GET", headers: { cookie: cookie1 },
    }), db);
    assert.equal(foreignRead.status, 403);

    const ownRead = await callWorker(jsonRequest(`/api/staff/imaging?bookingId=${booking2}`, undefined, {
      method: "GET", headers: { cookie: cookie2 },
    }), db);
    assert.equal(ownRead.status, 200);
    const ownBody = await ownRead.json();
    assert.equal(ownBody.study.accessionNumber, "ACC-ORG-2");

    const org1Worklist = await callWorker(jsonRequest("/api/staff/imaging", undefined, {
      method: "GET", headers: { cookie: cookie1 },
    }), db);
    assert.equal(org1Worklist.status, 200);
    const worklistBody = await org1Worklist.json();
    assert.equal(worklistBody.worklist.some((row) => row.id === booking2), false);
    assert.equal(worklistBody.worklist.some((row) => row.id === booking1), true);

    const event = await db.prepare(
      `SELECT organization_id AS organizationId FROM booking_events
       WHERE booking_id = ? AND action = 'imaging_linked' ORDER BY id DESC LIMIT 1`,
    ).bind(booking2).first();
    assert.equal(event.organizationId, 2);
  });
});
