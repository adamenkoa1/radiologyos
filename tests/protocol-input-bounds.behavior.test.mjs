import assert from "node:assert/strict";
import test from "node:test";
import { callWorker, jsonRequest, seedStaffSession, withD1 } from "./helpers/d1.mjs";

async function addBooking(db, email) {
  const result = await db.prepare(
    `INSERT INTO bookings
      (organization_id, code, name, phone, phone_normalized, service, service_code, equipment_id,
       desired_date, desired_time, assigned_radiologist_email, performed_at)
     VALUES (1, 'BOUNDS-001', 'Bounds Patient', '+380501112233', '380501112233',
       'КТ органів грудної клітки', '408', 'ct', '2026-08-15', '10:00', ?, '2026-08-15T10:20:00')`
  ).bind(email).run();
  return Number(result.meta.last_row_id);
}

function protocolPayload(bookingId, overrides = {}) {
  return {
    bookingId,
    baseVersion: 0,
    templateKey: "generic",
    method: "КТ без внутрішньовенного контрастування",
    sections: { findings: { description: "Опис без патологічних змін." } },
    findings: "Легенева тканина без свіжих вогнищевих змін.",
    conclusion: "КТ-ознаки без гострої патології.",
    recommendations: "",
    number: `CT-${bookingId}`,
    status: "ready",
    ...overrides,
  };
}

test("protocol endpoints reject over-limit clinical text instead of silently truncating it", async () => {
  await withD1(async (db) => {
    const email = "bounds@example.com";
    const cookie = await seedStaffSession(db, { email, role: "radiologist", displayName: "Bounds Doctor" });
    const bookingId = await addBooking(db, email);

    const overlongConclusion = await callWorker(
      jsonRequest(
        "/api/staff/protocols",
        protocolPayload(bookingId, { conclusion: "X".repeat(6001) }),
        { method: "PUT", headers: { cookie } },
      ),
      db,
    );
    assert.equal(overlongConclusion.status, 400);
    assert.match(JSON.stringify(await overlongConclusion.json()), /Висновок.*6000/);

    const overlongSection = await callWorker(
      jsonRequest(
        "/api/staff/protocols",
        protocolPayload(bookingId, {
          sections: { findings: { description: "Y".repeat(2001) } },
        }),
        { method: "PUT", headers: { cookie } },
      ),
      db,
    );
    assert.equal(overlongSection.status, 400);
    assert.match(JSON.stringify(await overlongSection.json()), /Опис дослідження.*2000/);

    const overlongAiDraft = await callWorker(
      jsonRequest(
        "/api/staff/ai/protocol-draft",
        protocolPayload(bookingId, { findings: "Z".repeat(6001), status: "draft" }),
        { method: "POST", headers: { cookie } },
      ),
      db,
    );
    assert.equal(overlongAiDraft.status, 400);
    assert.match(JSON.stringify(await overlongAiDraft.json()), /Опис.*6000/);

    const protocolCount = await db.prepare(
      "SELECT COUNT(*) AS count FROM protocols WHERE organization_id=1 AND booking_id=?"
    ).bind(bookingId).first();
    assert.equal(Number(protocolCount.count), 0, "rejected content must never be partially persisted");

    const revisionCount = await db.prepare(
      "SELECT COUNT(*) AS count FROM protocol_revisions WHERE organization_id=1 AND booking_id=?"
    ).bind(bookingId).first();
    assert.equal(Number(revisionCount.count), 0, "rejected content must not create medical revisions");

    const aiEventCount = await db.prepare(
      `SELECT COUNT(*) AS count FROM booking_events
       WHERE organization_id=1 AND booking_id=? AND action='ai_draft_generated'`
    ).bind(bookingId).first();
    assert.equal(Number(aiEventCount.count), 0, "rejected AI input must not create a generated-draft event");
  });
});
