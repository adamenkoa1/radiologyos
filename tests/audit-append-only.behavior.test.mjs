import assert from "node:assert/strict";
import test from "node:test";
import { withD1 } from "./helpers/d1.mjs";

test("security audit history is physically append-only in D1", async () => {
  await withD1(async (db) => {
    const inserted = await db.prepare(
      `INSERT INTO security_audit_log
        (organization_id, actor_email, action, resource, target_id, details_json)
       VALUES (1, 'doctor@example.com', 'protocol_viewed', 'protocol', '42', '{"version":1}')`
    ).run();
    const id = Number(inserted.meta.last_row_id);
    assert.ok(id > 0);

    await assert.rejects(
      db.prepare("UPDATE security_audit_log SET action='rewritten' WHERE id=?").bind(id).run(),
      /append-only/i,
    );
    await assert.rejects(
      db.prepare("DELETE FROM security_audit_log WHERE id=?").bind(id).run(),
      /append-only/i,
    );

    const row = await db.prepare(
      "SELECT organization_id AS organizationId, actor_email AS actorEmail, action, resource, target_id AS targetId, details_json AS detailsJson FROM security_audit_log WHERE id=?"
    ).bind(id).first();
    assert.equal(row.organizationId, 1);
    assert.equal(row.actorEmail, "doctor@example.com");
    assert.equal(row.action, "protocol_viewed");
    assert.equal(row.resource, "protocol");
    assert.equal(row.targetId, "42");
    assert.equal(row.detailsJson, '{"version":1}');
  });
});

test("0048 declares update and delete guards for the audit ledger", async () => {
  const { readFile } = await import("node:fs/promises");
  const sql = await readFile(new URL("../drizzle/0048_security_audit_append_only.sql", import.meta.url), "utf8");
  assert.match(sql, /BEFORE UPDATE ON `security_audit_log`/);
  assert.match(sql, /BEFORE DELETE ON `security_audit_log`/);
  assert.match(sql, /RAISE\(ABORT, 'security audit log is append-only'\)/);
});
