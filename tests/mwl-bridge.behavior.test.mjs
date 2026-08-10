import assert from "node:assert/strict";
import test from "node:test";
import { callWorker, jsonRequest, seedStaffSession, withD1 } from "./helpers/d1.mjs";

async function addOrganization(db, id, slug, name) {
  await db.prepare("INSERT INTO organizations (id, slug, name, active) VALUES (?, ?, ?, 1)")
    .bind(id, slug, name).run();
}

async function adminCookie(db, organizationId, email) {
  const cookie = await seedStaffSession(db, { email, role: "admin" });
  await db.prepare(
    `INSERT INTO memberships (organization_id, member_email, role, active)
     VALUES (?, ?, 'admin', 1)`,
  ).bind(organizationId, email).run();
  return cookie;
}

async function seedBooking(db, {
  organizationId = 1, code, serviceCode, equipmentId, service, status = "confirmed",
  phone = "380501112233", date = "2026-08-20", time = "10:00",
}) {
  const result = await db.prepare(
    `INSERT INTO bookings
      (organization_id, code, name, phone, phone_normalized, date_of_birth,
       service, service_code, equipment_id, desired_date, desired_time,
       patient_category, status, comment, patient_email)
     VALUES (?, ?, 'Пацієнт Тестовий Один', '+380501112233', ?, '1990-02-03',
       ?, ?, ?, ?, ?, 'civilian', ?, 'НЕ ПОВЕРТАТИ У MWL', 'private@example.com')`,
  ).bind(organizationId, code, phone, service, serviceCode, equipmentId, date, time, status).run();
  return Number(result.meta.last_row_id);
}

async function issueToken(db, cookie) {
  const response = await callWorker(jsonRequest("/api/staff/integrations/mwl-token", {}, {
    method: "POST", headers: { cookie },
  }), db);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.oneTime, true);
  assert.match(body.token, /^mwl_[A-Za-z0-9_-]+$/);
  return body.token;
}

test("admin rotates a one-time MWL token and only its hash is stored", async () => {
  await withD1(async (db) => {
    const cookie = await adminCookie(db, 1, "mwl-admin@example.com");
    const token = await issueToken(db, cookie);

    const row = await db.prepare(
      "SELECT token_hash AS tokenHash, active FROM mwl_bridge_tokens WHERE organization_id = 1",
    ).first();
    assert.equal(row.active, 1);
    assert.notEqual(row.tokenHash, token);
    assert.equal(String(row.tokenHash).length, 64);

    const status = await callWorker(jsonRequest("/api/staff/integrations/mwl-token", undefined, {
      method: "GET", headers: { cookie },
    }), db);
    assert.equal(status.status, 200);
    const statusBody = await status.json();
    assert.equal(statusBody.configured, true);
    assert.equal(statusBody.active, true);
    assert.equal("token" in statusBody, false);
  });
});

test("MWL feed is bearer-authenticated, tenant-scoped, status-filtered and PHI-minimized", async () => {
  await withD1(async (db) => {
    await addOrganization(db, 2, "other-clinic", "Other Clinic");
    const cookie1 = await adminCookie(db, 1, "mwl-one@example.com");
    const cookie2 = await adminCookie(db, 2, "mwl-two@example.com");
    const token1 = await issueToken(db, cookie1);
    await issueToken(db, cookie2);

    const ctId = await seedBooking(db, {
      code: "MWL-CT", serviceCode: "403", equipmentId: "ct", service: "КТ кісток лицевого скелета", time: "09:00",
    });
    await seedBooking(db, {
      code: "MWL-DX", serviceCode: "201", equipmentId: "xray", service: "Цифрова рентгенографія", status: "rescheduled", time: "10:00",
    });
    await seedBooking(db, {
      code: "MWL-RF", serviceCode: "301", equipmentId: "xray", service: "Рентгеноскопія з барієм", status: "scheduled", time: "11:00",
    });
    await seedBooking(db, {
      code: "MWL-CANCEL", serviceCode: "201", equipmentId: "xray", service: "Не показувати", status: "cancelled", time: "12:00",
    });
    await seedBooking(db, {
      code: "MWL-DONE", serviceCode: "403", equipmentId: "ct", service: "Не показувати", status: "completed", time: "13:00",
    });
    await seedBooking(db, {
      organizationId: 2, code: "MWL-FOREIGN", serviceCode: "403", equipmentId: "ct",
      service: "Чужа організація", time: "14:00", phone: "380671112233",
    });
    await db.prepare(
      `INSERT INTO imaging_studies
        (organization_id, booking_id, accession_number, study_status, source, updated_by)
       VALUES (1, ?, 'ACC-CUSTOM-CT', 'scheduled', 'manual', 'seed')`,
    ).bind(ctId).run();

    const noAuth = await callWorker(jsonRequest(
      "/api/integrations/mwl?from=2026-08-20&to=2026-08-20", undefined, { method: "GET" },
    ), db);
    assert.equal(noAuth.status, 401);

    const response = await callWorker(jsonRequest(
      "/api/integrations/mwl?from=2026-08-20&to=2026-08-20", undefined,
      { method: "GET", headers: { authorization: `Bearer ${token1}` } },
    ), db);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.organization.id, 1);
    assert.equal(body.count, 3);
    assert.deepEqual(body.items.map((item) => item.scheduledProcedureStepId), ["MWL-CT", "MWL-DX", "MWL-RF"]);
    assert.deepEqual(body.items.map((item) => item.modality), ["CT", "DX", "RF"]);
    assert.equal(body.items[0].accessionNumber, "ACC-CUSTOM-CT");
    assert.match(body.items[0].patientId, /^ROS-[A-F0-9]{20}$/);
    assert.equal(body.items[0].patientName, "Пацієнт Тестовий Один");
    assert.equal(body.items[0].patientBirthDate, "1990-02-03");
    const serialized = JSON.stringify(body);
    assert.doesNotMatch(serialized, /private@example\.com/);
    assert.doesNotMatch(serialized, /НЕ ПОВЕРТАТИ У MWL/);
    assert.doesNotMatch(serialized, /380501112233/);
    assert.doesNotMatch(serialized, /MWL-FOREIGN/);

    const second = await callWorker(jsonRequest(
      "/api/integrations/mwl?from=2026-08-20&to=2026-08-20&modality=CT", undefined,
      { method: "GET", headers: { authorization: `Bearer ${token1}` } },
    ), db);
    assert.equal(second.status, 200);
    const secondBody = await second.json();
    assert.equal(secondBody.count, 1);
    assert.equal(secondBody.items[0].patientId, body.items[0].patientId);
    assert.equal(secondBody.items[0].scheduledProcedureStepId, "MWL-CT");
  });
});

test("disabled token can no longer retrieve patient worklist data", async () => {
  await withD1(async (db) => {
    const cookie = await adminCookie(db, 1, "mwl-disable@example.com");
    const token = await issueToken(db, cookie);
    const disabled = await callWorker(jsonRequest("/api/staff/integrations/mwl-token", {}, {
      method: "DELETE", headers: { cookie },
    }), db);
    assert.equal(disabled.status, 200);

    const response = await callWorker(jsonRequest(
      "/api/integrations/mwl?from=2026-08-20&to=2026-08-20", undefined,
      { method: "GET", headers: { authorization: `Bearer ${token}` } },
    ), db);
    assert.equal(response.status, 401);
  });
});
