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
      db.prepare("UPDATE bookings SET protocol_number='OTHER' WHERE id=? AND organization_id=1")
        .bind(bookingId).run(),
      /projection mismatch/i,
    );

    await db.prepare("UPDATE protocols SET status='issued' WHERE booking_id=? AND organization_id=1")
      .bind(bookingId).run();
    booking = await db.prepare(`SELECT protocol_status AS status, protocol_number AS number,
      protocol_ready_at AS readyAt, protocol_issued_at AS issuedAt
      FROM bookings WHERE id=? AND organization_id=1`).bind(bookingId).first();
    assert.equal(booking.status, "issued");
    assert.equal(booking.number, "CT-2026-001");
    assert.ok(booking.readyAt);
    assert.ok(booking.issuedAt);
  });
});

test("lifecycle migration repairs orphan projections without fabricating clinical documents", async () => {
  const migration = await read("drizzle/0044_protocol_lifecycle_projection.sql");
  assert.match(migration, /protocol_projection_repaired/);
  assert.match(migration, /system:migration-0044/);
  assert.match(migration, /SET protocol_number = '',[\s\S]*protocol_status = 'not_started'/);
  assert.match(migration, /protocols_project_booking_insert/);
  assert.match(migration, /protocols_project_booking_update/);
  assert.match(migration, /bookings_protocol_projection_guard/);
  assert.match(migration, /RAISE\(ABORT, 'booking protocol projection mismatch'\)/);
});
