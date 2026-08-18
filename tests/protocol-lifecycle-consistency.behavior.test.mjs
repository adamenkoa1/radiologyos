import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { withD1 } from "./helpers/d1.mjs";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

async function addBooking(db, code = "PROTO-LIFECYCLE-1") {
  const result = await db.prepare(`INSERT INTO bookings
    (organization_id,code,name,phone,service,desired_date,desired_time,protocol_status,protocol_number)
    VALUES (1,?,'Patient','+380000000001','CT','2026-08-14','10:00','not_started','')`
  ).bind(code).run();
  return Number(result.meta.last_row_id);
}

test("protocol document is the authoritative projection for booking protocol state", async () => {
  await withD1(async (db) => {
    const bookingId = await addBooking(db);

    await assert.rejects(
      db.prepare("UPDATE bookings SET protocol_status='issued', protocol_number='FAKE-1' WHERE id=? AND organization_id=1")
        .bind(bookingId).run(),
      /projection mismatch/i,
    );

    let booking = await db.prepare(`SELECT protocol_status AS status, protocol_number AS number,
      protocol_ready_at AS readyAt, protocol_issued_at AS issuedAt
      FROM bookings WHERE id=? AND organization_id=1`).bind(bookingId).first();
    assert.equal(booking.status, "not_started");
    assert.equal(booking.number, "");

    await db.prepare(`INSERT INTO protocols
      (organization_id,booking_id,number,status,updated_by)
      VALUES (1,?,'','draft','doctor@example.com')`).bind(bookingId).run();

    booking = await db.prepare(`SELECT protocol_status AS status, protocol_number AS number
      FROM bookings WHERE id=? AND organization_id=1`).bind(bookingId).first();
    assert.equal(booking.status, "in_progress");
    assert.equal(booking.number, "");

    await assert.rejects(
      db.prepare("UPDATE bookings SET protocol_status='ready', protocol_number='CT-2026-001' WHERE id=? AND organization_id=1")
        .bind(bookingId).run(),
      /projection mismatch/i,
    );

    await db.prepare("UPDATE protocols SET status='ready', number='CT-2026-001' WHERE booking_id=? AND organization_id=1")
      .bind(bookingId).run();
    booking = await db.prepare(`SELECT protocol_status AS status, protocol_number AS number,
      protocol_ready_at AS readyAt, protocol_issued_at AS issuedAt
      FROM bookings WHERE id=? AND organization_id=1`).bind(bookingId).first();
    assert.equal(booking.status, "ready");
    assert.equal(booking.number, "CT-2026-001");
    assert.ok(booking.readyAt);
    assert.equal(booking.issuedAt, "");

    await assert.rejects(
      db.prepare("UPDATE protocols SET status='issued' WHERE booking_id=? AND organization_id=1")
        .bind(bookingId).run(),
      /protocol_issue_requires_signed_transition|signature state mismatch/i,
    );

    await db.prepare(
      `UPDATE protocols
       SET status='signed', signed_by='doctor@example.com', signed_at=CURRENT_TIMESTAMP, signed_version=version
       WHERE booking_id=? AND organization_id=1`
    ).bind(bookingId).run();
    booking = await db.prepare(`SELECT protocol_status AS status, protocol_number AS number,
      protocol_ready_at AS readyAt, protocol_issued_at AS issuedAt
      FROM bookings WHERE id=? AND organization_id=1`).bind(bookingId).first();
    assert.equal(booking.status, "ready", "signed protocol remains ready in the legacy booking projection");
    assert.equal(booking.number, "CT-2026-001");
    assert.ok(booking.readyAt);
    assert.equal(booking.issuedAt, "");

    await assert.rejects(
      db.prepare("UPDATE protocols SET number='OTHER' WHERE booking_id=? AND organization_id=1")
        .bind(bookingId).run(),
      /signed protocol content is immutable/i,
    );
    await assert.rejects(
      db.prepare("UPDATE protocols SET status='ready' WHERE booking_id=? AND organization_id=1")
        .bind(bookingId).run(),
      /signed protocol status is immutable|signature state mismatch/i,
    );

    const issued = await db.prepare(
      "UPDATE protocols SET status='issued' WHERE booking_id=? AND organization_id=1 AND status='signed'"
    ).bind(bookingId).run();
    assert.equal(Number(issued.meta.changes), 1);

    booking = await db.prepare(`SELECT protocol_status AS status, protocol_number AS number,
      protocol_ready_at AS readyAt, protocol_issued_at AS issuedAt
      FROM bookings WHERE id=? AND organization_id=1`).bind(bookingId).first();
    assert.equal(booking.status, "issued");
    assert.equal(booking.number, "CT-2026-001");
    assert.ok(booking.readyAt);
    assert.ok(booking.issuedAt);

    const duplicateIssue = await db.prepare(
      "UPDATE protocols SET status='issued' WHERE booking_id=? AND organization_id=1 AND status='signed'"
    ).bind(bookingId).run();
    assert.equal(Number(duplicateIssue.meta.changes), 0, "a repeated issue attempt must not create a second transition");

    const issueEvents = await db.prepare(
      "SELECT action, actor FROM booking_events WHERE organization_id=1 AND booking_id=? AND action='protocol_issued'"
    ).bind(bookingId).all();
    assert.equal(issueEvents.results.length, 1, "D1 must record exactly one issue event for one signed -> issued transition");
    assert.equal(issueEvents.results[0].actor, "doctor@example.com");
  });
});

test("lifecycle migrations protect projection and explicit signing semantics", async () => {
  const projectionMigration = await read("drizzle/0044_protocol_lifecycle_projection.sql");
  assert.match(projectionMigration, /protocol_projection_repaired/);
  assert.match(projectionMigration, /system:migration-0044/);
  assert.match(projectionMigration, /SET protocol_number = '',[\s\S]*protocol_status = 'not_started'/);

  const signingMigration = await read("drizzle/0049_protocol_signing_lifecycle.sql");
  assert.match(signingMigration, /signed_by/);
  assert.match(signingMigration, /signed_at/);
  assert.match(signingMigration, /signed_version/);
  assert.match(signingMigration, /system:legacy-issued/);
  assert.match(signingMigration, /protocol_signature_migrated/);
  assert.match(signingMigration, /WHEN 'signed' THEN 'ready'/);
  assert.match(signingMigration, /protocols_signed_content_immutable/);
  assert.match(signingMigration, /protocols_signed_status_guard/);
  assert.match(signingMigration, /RAISE\(ABORT, 'signed protocol content is immutable'\)/);
  assert.match(signingMigration, /bookings_protocol_projection_guard/);
  assert.match(signingMigration, /RAISE\(ABORT, 'booking protocol projection mismatch'\)/);

  const issueMigration = await read("drizzle/0055_protocol_issue_transition_audit.sql");
  assert.match(issueMigration, /WHEN OLD\.status = 'signed' AND NEW\.status = 'issued'/);
  assert.match(issueMigration, /'protocol_issued'/);

  const route = await read("app/api/staff/protocols/route.ts");
  assert.match(route, /Number\(issued\.meta\.changes \|\| 0\) !== 1/);
  assert.doesNotMatch(
    route,
    /INSERT INTO booking_events[^\n]*protocol_issued/,
    "the API must not append issue events independently of the actual D1 state transition",
  );
});
