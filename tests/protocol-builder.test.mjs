import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("protocol migration creates the document table and backfills existing protocols", async () => {
  const migration = await read("drizzle/0005_protocol_documents.sql");
  assert.match(migration, /CREATE TABLE IF NOT EXISTS `protocols`/);
  for (const column of [
    "template_key", "method", "sections_json", "findings",
    "conclusion", "recommendations", "number", "status", "version", "author_email",
  ]) assert.match(migration, new RegExp(`\\\`${column}\\\``));
  assert.match(migration, /CREATE INDEX IF NOT EXISTS `protocols_status_idx`/);
  assert.match(migration, /INSERT OR IGNORE INTO `protocols`/);

  const journal = JSON.parse(await read("drizzle/meta/_journal.json"));
  assert.ok(journal.entries.some((entry) => entry.tag === "0005_protocol_documents"));

  const schema = await read("db/schema.ts");
  assert.match(schema, /export const protocols = sqliteTable\("protocols"/);
});

test("protocol library ships structured templates for every modality", async () => {
  const source = await read("lib/protocols.ts");
  for (const key of ["ct_chest", "ct_brain", "ct_abdomen", "xray_chest", "xray_bone", "fluoro_chest", "generic"]) {
    assert.match(source, new RegExp(`key: "${key}"`));
  }
  for (const fn of [
    "protocolTemplateByKey", "suggestTemplateKey", "normalDocument",
    "renderProtocolText", "sanitizeDocument", "bookingProtocolStatus",
  ]) assert.match(source, new RegExp(`export function ${fn}`));
  // Ready/issued protocols must carry a number and a conclusion.
  assert.match(source, /вкажіть його номер/);
  assert.match(source, /повинен містити висновок/);
});

test("protocol API guards writes and never defines schema at runtime", async () => {
  const route = await read("app/api/staff/protocols/route.ts");
  assert.match(route, /requireOrgContext\(request, db\)/);
  assert.match(route, /canManageProtocols\(member\.role\)/);
  assert.match(route, /sanitizeDocument\(body\)/);
  assert.match(route, /INSERT INTO booking_events/);
  assert.match(route, /protocol_document_saved/);
  assert.doesNotMatch(route, /CREATE\s+TABLE/i);
  assert.doesNotMatch(route, /ALTER\s+TABLE/i);
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

test("protocol builder page renders inside the staff workspace", async () => {
  const response = await renderPath("/staff/protocols");
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /Конструктор протоколів/);
  assert.match(html, /Оберіть дослідження зі списку/);
});

test("protocol editor guards unsaved work, shows a table of contents and loading state", async () => {
  const { readFile } = await import("node:fs/promises");
  const page = await readFile(new URL("../app/staff/protocols/page.tsx", import.meta.url), "utf8");
  // Захист незбережених змін при перемиканні протоколу.
  assert.match(page, /function selectBooking/);
  assert.match(page, /незбережені зміни/);
  assert.match(page, /setDirty/);
  // Стан завантаження картки, а не оманливий плейсхолдер.
  assert.match(page, /bookingLoading/);
  assert.match(page, /Завантаження протоколу…/);
  // Зміст протоколу з переходами по секціях + заповненість.
  assert.match(page, /protocolToc/);
  assert.match(page, /заповнено \$\{completeness\.filled\}\/\$\{completeness\.total\}/);
  assert.match(page, /#protocol-conclusion/);
  // Друк: підпис лікаря — рядок для підпису, а не email.
  assert.doesNotMatch(page, /Лікар-рентгенолог: \{booking\.assignedRadiologistEmail/);
  // Єдиний патч документа замість повторюваного setDoc.
  assert.match(page, /function patchDoc/);
});
