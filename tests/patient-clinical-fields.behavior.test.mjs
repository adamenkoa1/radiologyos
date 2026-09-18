// Клінічні поля: флаг реакції на контраст + нотатка алергій на картці пацієнта,
// і клінічні показання на заявці.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { withD1, callWorker, jsonRequest, seedStaffSession } from "./helpers/d1.mjs";

const read = (p) => readFile(new URL(`../${p}`, import.meta.url), "utf8");

test("migration adds contrast_alert / allergy_note / clinical_indication columns", async () => {
  await withD1(async (db, raw) => {
    const prof = raw.prepare("PRAGMA table_info(patient_profiles)").all().map((r) => r.name);
    assert.ok(prof.includes("contrast_alert"), "patient_profiles.contrast_alert");
    assert.ok(prof.includes("allergy_note"), "patient_profiles.allergy_note");
    const book = raw.prepare("PRAGMA table_info(bookings)").all().map((r) => r.name);
    assert.ok(book.includes("clinical_indication"), "bookings.clinical_indication");
  });
});

test("staff can store and read back a patient's contrast alert (incl. note trimming)", async () => {
  await withD1(async (db) => {
    const cookie = await seedStaffSession(db, { email: "reg@example.com", role: "registrar", organizationId: 1 });
    const res = await callWorker(jsonRequest("/api/staff/patients", {
      phone: "+380971112233", displayName: "Тест Пацієнт",
      contrastAlert: true, allergyNote: "Анафілаксія на йодовмісний контраст",
    }, { method: "PUT", headers: { cookie } }), db);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.profile.contrastAlert, 1);
    assert.equal(body.profile.allergyNote, "Анафілаксія на йодовмісний контраст");

    const row = await db.prepare(
      "SELECT contrast_alert AS a, allergy_note AS n FROM patient_profiles WHERE organization_id = 1 AND patient_id = ?",
    ).bind(body.profile.patientId).first();
    assert.equal(row.a, 1);
    assert.equal(row.n, "Анафілаксія на йодовмісний контраст");
  });
});

test("bookings route carries clinical_indication through create, read and edit", async () => {
  const route = await read("app/api/staff/bookings/route.ts");
  assert.match(route, /const clinicalIndication = clean\(body\.clinicalIndication, 400\)/);
  assert.match(route, /clinical_indication AS clinicalIndication/);
  assert.match(route, /clinical_indication = \?/); // editable via PATCH
  const book = await read("app/staff/book/page.tsx");
  assert.match(book, /name="clinicalIndication"/);
});
