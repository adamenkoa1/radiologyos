import assert from "node:assert/strict";
import test from "node:test";
import { callWorker, jsonRequest, seedStaffSession, withD1 } from "./helpers/d1.mjs";

const ALLOWED_ENV = {
  OUTBOUND_ALLOWED_HOSTS: "pacs.example.com,viewer.example.com",
};

async function saveSettings(db, cookie, viewerBaseUrl, env = ALLOWED_ENV) {
  return callWorker(jsonRequest("/api/staff/imaging/settings", {
    dicomwebBaseUrl: "https://pacs.example.com/dicom-web",
    viewerBaseUrl,
    aeTitle: "RADTEST",
    enabled: true,
    notes: "viewer policy",
  }, { method: "PUT", headers: { cookie } }), db, env);
}

test("PACS viewer URL must use HTTPS and an explicitly allowlisted host", async () => {
  await withD1(async (db) => {
    const cookie = await seedStaffSession(db, {
      email: "viewer-policy-admin@example.com",
      role: "admin",
    });

    const allowed = await saveSettings(
      db,
      cookie,
      "https://viewer.example.com/viewer/{study}",
    );
    assert.equal(allowed.status, 200);
    const allowedBody = await allowed.json();
    assert.equal(allowedBody.settings.viewerBaseUrl, "https://viewer.example.com/viewer/{study}");

    const external = await saveSettings(
      db,
      cookie,
      "https://untrusted.example.net/viewer/{study}",
    );
    assert.equal(external.status, 400);
    assert.match((await external.json()).error, /переглядача.*політикою/i);

    const insecure = await saveSettings(
      db,
      cookie,
      "http://viewer.example.com/viewer/{study}",
    );
    assert.equal(insecure.status, 400);
    assert.match((await insecure.json()).error, /переглядача.*політикою/i);

    const stored = await db.prepare(
      `SELECT viewer_base_url AS viewerBaseUrl, dicomweb_base_url AS dicomwebBaseUrl
       FROM pacs_settings WHERE organization_id = 1 LIMIT 1`,
    ).first();
    assert.equal(stored.viewerBaseUrl, "https://viewer.example.com/viewer/{study}");
    assert.equal(stored.dicomwebBaseUrl, "https://pacs.example.com/dicom-web");
  });
});

test("viewer and DICOMweb hosts are independently allowlisted", async () => {
  await withD1(async (db) => {
    const cookie = await seedStaffSession(db, {
      email: "viewer-policy-split@example.com",
      role: "admin",
    });

    const missingViewerHost = await saveSettings(
      db,
      cookie,
      "https://viewer.example.com/viewer",
      { OUTBOUND_ALLOWED_HOSTS: "pacs.example.com" },
    );
    assert.equal(missingViewerHost.status, 400);

    const row = await db.prepare(
      "SELECT viewer_base_url AS viewerBaseUrl FROM pacs_settings WHERE organization_id = 1 LIMIT 1",
    ).first();
    assert.equal(String(row?.viewerBaseUrl || ""), "");
  });
});
