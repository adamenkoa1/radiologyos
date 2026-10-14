// Блоки редактора #3 (направлення/клінічні відомості) і #13 (історія версій)
// у /staff/protocols (PR-E1). Endpoint by-id повертає клінічні поля + ревізії
// (реальний D1); сторінка їх відображає (інспекція джерела).

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { callWorker, jsonRequest, seedStaffSession, withD1 } from "./helpers/d1.mjs";

const read = (p) => readFile(new URL(`../${p}`, import.meta.url), "utf8");

async function seedBooking(db) {
  const r = await db.prepare(`INSERT INTO bookings
    (organization_id,code,name,phone,phone_normalized,date_of_birth,service,service_code,equipment_id,
     duration_minutes,desired_date,desired_time,patient_category,payment_status,status,performed_at,
     clinical_indication,referral,referral_type,referral_number,assigned_radiologist_email)
    VALUES (1,'EDBLK-1','Пацієнт Тест','+380501234567','380501234567','1980-01-02','КТ ОГК','ct-chest','ct',30,
      '2026-09-26','09:00','civilian','pending','completed','2026-09-26T09:05:00',
      'підозра на пневмонію','paper_referral','paper_referral','НАПР-123','doc@example.com')`).run();
  return Number(r.meta.last_row_id);
}

test("by-id endpoint returns referral/clinical fields for block #3", async () => {
  await withD1(async (db) => {
    const admin = await seedStaffSession(db, { email: "admin@example.com", role: "admin", organizationId: 1 });
    const id = await seedBooking(db);
    const res = await callWorker(new Request(`http://localhost/api/staff/protocols?bookingId=${id}`, { headers: { cookie: admin } }), db);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.booking.clinicalIndication, "підозра на пневмонію");
    assert.equal(data.booking.referralNumber, "НАПР-123");
    assert.equal(data.booking.dateOfBirth, "1980-01-02");
    assert.ok(Array.isArray(data.revisions), "revisions array returned");
  });
});

test("by-id endpoint returns revision history after a save (block #13)", async () => {
  await withD1(async (db) => {
    const doc = await seedStaffSession(db, { email: "doc@example.com", role: "radiologist", organizationId: 1 });
    const id = await seedBooking(db);
    const put = await callWorker(jsonRequest("/api/staff/protocols", {
      bookingId: id, baseVersion: 0, templateKey: "generic", method: "КТ", sections: {},
      findings: "опис", conclusion: "висновок", recommendations: "", number: "P-1", status: "draft",
    }, { method: "PUT", headers: { cookie: doc } }), db);
    assert.equal(put.status, 200, await put.text());
    const res = await callWorker(new Request(`http://localhost/api/staff/protocols?bookingId=${id}`, { headers: { cookie: doc } }), db);
    const data = await res.json();
    assert.ok(data.revisions.length >= 1, "at least one revision after save");
    assert.equal(data.revisions[0].version, 1);
  });
});

test("editor renders block #3 (referral/clinical) and block #13 (revision history)", async () => {
  const page = await read("app/staff/protocols/page.tsx");
  assert.match(page, /className="protocolReferralBlock"/);
  assert.match(page, /Направлення та клінічні відомості/);
  assert.match(page, /booking\.clinicalIndication/);
  assert.match(page, /className="protocolRevisions"/);
  assert.match(page, /revisions\.map\(\(r\)=>/);
  // openBooking зберігає ревізії з відповіді endpoint.
  assert.match(page, /setRevisions\(Array\.isArray\(data\.revisions\)/);
});
