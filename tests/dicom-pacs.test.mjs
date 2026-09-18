import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("DICOM migration creates imaging and PACS settings tables", async () => {
  const migration = await read("drizzle/0007_dicom_pacs.sql");
  assert.match(migration, /CREATE TABLE IF NOT EXISTS `imaging_studies`/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS `pacs_settings`/);
  for (const column of ["accession_number", "study_instance_uid", "study_status", "dicomweb_base_url", "viewer_base_url"]) {
    assert.match(migration, new RegExp(`\\\`${column}\\\``));
  }
  assert.match(migration, /INSERT OR IGNORE INTO `pacs_settings` \(`id`\) VALUES \(1\)/);

  const journal = JSON.parse(await read("drizzle/meta/_journal.json"));
  assert.ok(journal.entries.some((entry) => entry.tag === "0007_dicom_pacs"));

  const schema = await read("db/schema.ts");
  assert.match(schema, /export const imagingStudies = sqliteTable\("imaging_studies"/);
  assert.match(schema, /export const pacsSettings = sqliteTable\("pacs_settings"/);
});

test("DICOM library validates identifiers and builds DICOMweb URLs", async () => {
  const source = await read("lib/dicom.ts");
  for (const fn of [
    "isValidDicomUid", "isValidAccession", "qidoSeriesUrl", "wadoStudyUrl",
    "viewerUrl", "parseQidoSeries", "sanitizeImagingStudy", "sanitizePacsSettings",
  ]) assert.match(source, new RegExp(`export function ${fn}`));
  // QIDO parser reads the SeriesInstanceUID and Modality DICOM tags.
  assert.match(source, /0020000E/);
  assert.match(source, /00080060/);
  // Viewer supports both a {study} placeholder and the OHIF query convention.
  assert.match(source, /StudyInstanceUIDs=/);
});

test("imaging API guards medical writes while PACS settings use system authority", async () => {
  const route = await read("app/api/staff/imaging/route.ts");
  const settingsRoute = await read("app/api/staff/imaging/settings/route.ts");
  assert.match(route, /requireOrgContext\(request, db\)/);
  assert.match(route, /canManageImaging\(member\.role\)/);
  assert.match(route, /sanitizeImagingStudy\(/);
  assert.match(route, /imaging_linked/);
  assert.match(route, /safeOutboundUrl\(/);
  assert.match(route, /fetchLimited\(/);
  assert.match(route, /canAccessBooking\(/);
  assert.match(settingsRoute, /requireSystemOrgContext\(request, db\)/);
  assert.match(settingsRoute, /canManageSystem\(ctx\.member\.role\)/);
  assert.match(settingsRoute, /sanitizePacsSettings\(/);
  for (const source of [route, settingsRoute]) {
    assert.doesNotMatch(source, /CREATE\s+TABLE/i);
    assert.doesNotMatch(source, /ALTER\s+TABLE/i);
  }
});

async function renderPath(path) {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(
    new Request(`http://localhost${path}`, { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("imaging page renders inside the staff workspace", async () => {
  const response = await renderPath("/staff/imaging");
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /Знімки та DICOM/);
  assert.match(html, /Оберіть дослідження зі списку/);
});
