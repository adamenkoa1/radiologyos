import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

const DRIZZLE_DIR = new URL("../drizzle/", import.meta.url);

function migrationNumber(file) {
  return Number(file.slice(0, 4));
}

async function migrationFiles() {
  return (await readdir(DRIZZLE_DIR))
    .filter((file) => /^\d{4}_.+\.sql$/.test(file))
    .sort();
}

async function apply(db, files) {
  for (const file of files) {
    const sql = await readFile(new URL(file, DRIZZLE_DIR), "utf8");
    db.exec(sql);
  }
}

function columns(db, table) {
  return db.prepare(`PRAGMA table_info(${table})`).all().map((row) => row.name);
}

test("0046 invalidates legacy phone-wide auth and Telegram bindings during upgrade", async () => {
  const files = await migrationFiles();
  const before0046 = files.filter((file) => migrationNumber(file) <= 45);
  const migration0046 = files.find((file) => migrationNumber(file) === 46);
  assert.ok(migration0046);

  const db = new DatabaseSync(":memory:");
  try {
    db.exec("PRAGMA foreign_keys = ON;");
    await apply(db, before0046);

    const booking = db.prepare(
      `INSERT INTO bookings
        (organization_id, code, name, phone, phone_normalized, date_of_birth,
         service, service_code, desired_date, desired_time)
       VALUES (1, 'RD-UPGRADE46', 'Legacy Patient', '+380501112233', '380501112233',
         '1980-01-10', 'КТ', '403', '2026-09-10', '10:00')`,
    ).run();
    assert.ok(Number(booking.lastInsertRowid) > 0);

    db.prepare(
      `INSERT INTO patient_sessions (token_hash, phone_normalized, organization_id, expires_at)
       VALUES ('legacy-session', '380501112233', 1, datetime('now', '+1 hour'))`,
    ).run();
    db.prepare(
      `INSERT INTO telegram_link_tokens (token_hash, phone_normalized, organization_id, expires_at)
       VALUES ('legacy-telegram-token', '380501112233', 1, datetime('now', '+15 minutes'))`,
    ).run();
    db.prepare(
      `INSERT INTO patient_profiles
        (organization_id, phone_normalized, display_name, telegram_chat_id, updated_by)
       VALUES (1, '380501112233', 'Legacy Patient', 'legacy-chat', 'seed')`,
    ).run();

    await apply(db, [migration0046]);

    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM patient_sessions").get().n, 0);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM telegram_link_tokens").get().n, 0);
    assert.equal(
      db.prepare("SELECT telegram_chat_id AS chat FROM patient_profiles WHERE organization_id=1 AND phone_normalized='380501112233'").get().chat,
      "",
    );
    assert.ok(columns(db, "patient_sessions").includes("identity_kind"));
    assert.ok(columns(db, "patient_sessions").includes("identity_value"));
    assert.ok(columns(db, "patient_otp_challenges").includes("identity_kind"));
    assert.ok(columns(db, "telegram_link_tokens").includes("identity_value"));
    assert.deepEqual(columns(db, "patient_telegram_identities"), [
      "organization_id", "phone_normalized", "identity_kind", "identity_value", "telegram_chat_id", "updated_at",
    ]);

    assert.throws(() => db.prepare(
      `INSERT INTO patient_sessions
        (token_hash, phone_normalized, organization_id, identity_kind, identity_value, expires_at)
       VALUES ('invented', '380501112233', 1, 'dob', '1970-01-01', datetime('now', '+1 hour'))`,
    ).run(), /identity scope invalid/i);

    db.prepare(
      `INSERT INTO patient_sessions
        (token_hash, phone_normalized, organization_id, identity_kind, identity_value, expires_at)
       VALUES ('scoped', '380501112233', 1, 'dob', '1980-01-10', datetime('now', '+1 hour'))`,
    ).run();
    assert.equal(db.prepare("SELECT identity_value FROM patient_sessions WHERE token_hash='scoped'").get().identity_value, "1980-01-10");
  } finally {
    db.close();
  }
});
