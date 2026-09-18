import assert from "node:assert/strict";
import test from "node:test";
import { callWorker, seedStaffSession, withD1 } from "./helpers/d1.mjs";

const PACS_ENV = { OUTBOUND_ALLOWED_HOSTS: "pacs.example.test" };

function request(cookie) {
  return new Request("http://localhost/api/staff/integrations/health", {
    headers:{ cookie },
  });
}

test("integration health reports readiness without exposing PACS or MWL secrets", async () => {
  await withD1(async (db) => {
    const cookie = await seedStaffSession(db, { email:"admin@health.test", role:"admin" });
    await db.prepare(
      `UPDATE pacs_settings SET
        dicomweb_base_url = ?, viewer_base_url = ?, ae_title = 'RADIOLOGY', enabled = 1,
        notes = 'secret operational note', updated_by = 'admin@health.test', updated_at = CURRENT_TIMESTAMP
       WHERE organization_id = 1`
    ).bind("https://pacs.example.test/dicomweb", "https://viewer.example.test/ohif").run();
    await db.prepare(
      `INSERT INTO mwl_bridge_tokens
        (organization_id, token_hash, active, created_by, created_at, rotated_at, last_used_at)
       VALUES (1, 'super-secret-token-hash', 1, 'admin@health.test', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
    ).run();

    const previousFetch = globalThis.fetch;
    globalThis.fetch = async (url) => {
      assert.match(String(url), /^https:\/\/pacs\.example\.test\/dicomweb\/studies\?limit=1$/);
      return new Response("[]", { status:200, headers:{ "content-type":"application/dicom+json" } });
    };
    try {
      const response = await callWorker(request(cookie), db, PACS_ENV);
      assert.equal(response.status, 200);
      const body = await response.json();
      assert.equal(body.overall, "operational");
      assert.equal(body.pacs.state, "operational");
      assert.equal(body.pacs.autoLinkReady, true);
      assert.equal(body.mwl.state, "operational");
      assert.equal(body.mwl.ready, true);
      const serialized = JSON.stringify(body);
      for (const forbidden of [
        "pacs.example.test", "viewer.example.test", "super-secret-token-hash", "secret operational note",
      ]) assert.equal(serialized.includes(forbidden), false);
    } finally {
      globalThis.fetch = previousFetch;
    }
  });
});

test("integration health degrades PACS safely when the remote endpoint is unreachable", async () => {
  await withD1(async (db) => {
    const cookie = await seedStaffSession(db, { email:"admin2@health.test", role:"admin" });
    await db.prepare(
      `UPDATE pacs_settings SET
        dicomweb_base_url = 'https://pacs.example.test/dicomweb', enabled = 1,
        updated_by = 'admin2@health.test', updated_at = CURRENT_TIMESTAMP
       WHERE organization_id = 1`
    ).run();

    const previousFetch = globalThis.fetch;
    globalThis.fetch = async () => { throw new Error("offline"); };
    try {
      const response = await callWorker(request(cookie), db, PACS_ENV);
      assert.equal(response.status, 200);
      const body = await response.json();
      assert.equal(body.pacs.state, "unreachable");
      assert.equal(body.pacs.autoLinkReady, false);
      assert.equal(body.overall, "attention_required");
    } finally {
      globalThis.fetch = previousFetch;
    }
  });
});
