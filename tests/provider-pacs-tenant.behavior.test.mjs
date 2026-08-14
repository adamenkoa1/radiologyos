import assert from "node:assert/strict";
import test from "node:test";
import { withD1 } from "./helpers/d1.mjs";

const PACS_QUERY =
  "SELECT enabled, viewer_base_url AS viewer, dicomweb_base_url AS dicomweb FROM pacs_settings WHERE organization_id = ? LIMIT 1";

test("PACS settings query isolates readiness by organization", async () => {
  await withD1(async (db) => {
    await db.prepare("INSERT INTO organizations (id, slug, name, active) VALUES (2, 'provider-two', 'Provider Two', 1)").run();
    await db.prepare("DELETE FROM pacs_settings").run();
    await db.prepare(
      `INSERT INTO pacs_settings
        (organization_id, dicomweb_base_url, viewer_base_url, ae_title, enabled, notes, updated_by)
       VALUES
        (1, 'https://pacs-one.example/dicomweb', 'https://pacs-one.example/viewer', 'ORG1', 1, '', 'test'),
        (2, '', '', 'ORG2', 0, '', 'test')`
    ).run();

    const one = await db.prepare(PACS_QUERY).bind(1).first();
    assert.equal(one.enabled, 1);
    assert.equal(one.viewer, "https://pacs-one.example/viewer");
    assert.equal(one.dicomweb, "https://pacs-one.example/dicomweb");

    const two = await db.prepare(PACS_QUERY).bind(2).first();
    assert.equal(two.enabled, 0);
    assert.equal(two.viewer, "");
    assert.equal(two.dicomweb, "");
  });
});

test("provider resolver uses the tenant-scoped PACS query", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(new URL("../lib/providers/index.ts", import.meta.url), "utf8");
  assert.match(source, /FROM pacs_settings WHERE organization_id = \? LIMIT 1/);
  assert.match(source, /\.bind\(ctx\.organizationId\)/);
  assert.doesNotMatch(source, /FROM pacs_settings WHERE id = 1/);
});
