import assert from "node:assert/strict";
import test from "node:test";
import { resolveProviders } from "../lib/providers/index.ts";
import { withD1 } from "./helpers/d1.mjs";

function ctx(organizationId) {
  return {
    organizationId,
    slug: `org-${organizationId}`,
    organizationName: `Org ${organizationId}`,
    role: "admin",
    member: { email:`admin${organizationId}@example.com`, displayName:`Admin ${organizationId}`, role:"admin" },
  };
}

test("provider PACS readiness is resolved from the active tenant only", async () => {
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

    const one = await resolveProviders(db, ctx(1));
    assert.equal(one.pacs.enabled, true);
    assert.deepEqual(one.pacs.describe(), {
      enabled:true,
      viewerConfigured:true,
      dicomwebConfigured:true,
    });

    const two = await resolveProviders(db, ctx(2));
    assert.equal(two.pacs.enabled, false);
    assert.deepEqual(two.pacs.describe(), {
      enabled:false,
      viewerConfigured:false,
      dicomwebConfigured:false,
    });
  });
});

test("provider resolver never hard-codes the first PACS row", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(new URL("../lib/providers/index.ts", import.meta.url), "utf8");
  assert.match(source, /FROM pacs_settings WHERE organization_id = \? LIMIT 1/);
  assert.match(source, /\.bind\(ctx\.organizationId\)/);
  assert.doesNotMatch(source, /FROM pacs_settings WHERE id = 1/);
});
