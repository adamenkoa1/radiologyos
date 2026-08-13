import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("PACS configuration changes are audited to the signed-in tenant", async () => {
  const route = await read("app/api/staff/imaging/settings/route.ts");
  assert.match(route, /await audit\(db,/);
  assert.match(route, /organizationId: ctx\.organizationId/);
  assert.match(route, /action: "pacs_update"/);
  assert.match(route, /resource: "pacs_settings"/);
  assert.doesNotMatch(route, /details:[^}]*dicomwebBaseUrl|details:[^}]*viewerBaseUrl/s);
});
