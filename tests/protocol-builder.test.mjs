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
  for (const column of ["signed_by", "signed_at", "signed_version"]) {
    assert.match(schema, new RegExp(column));
  }
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
  assert.match(source, /вкажіть його номер/);
  assert.match(source, /повинен містити висновок/);

  const lifecycle = await read("lib/protocol-lifecycle.ts");
  assert.match(lifecycle, /signed: "Підписаний"/);
  assert.match(lifecycle, /sanitizeLifecycleDocument/);
  assert.match(lifecycle, /status === "signed" \? "ready"/);
});

test("template pool covers the department's high-volume studies", async () => {
  const source = await read("lib/protocols.ts");
  for (const k of ["ct_sinuses", "ct_spine", "ct_urography", "xray_abdomen", "xray_spine", "xray_sinuses"]) {
    assert.match(source, new RegExp(`key: "${k}"`), `template ${k} present`);
  }
  const genericAt = source.indexOf('key: "generic"');
  for (const k of ["ct_chest", "ct_brain", "ct_abdomen", "xray_chest", "xray_bone", "fluoro_chest",
    "ct_sinuses", "ct_spine", "ct_urography", "xray_abdomen", "xray_spine", "xray_sinuses"]) {
    const at = source.indexOf(`key: "${k}"`);
    assert.ok(at >= 0 && at < genericAt, `${k} declared before generic`);
  }
  for (const r of ['return "ct_sinuses"', 'return "ct_spine"', 'return "ct_urography"', 'return "xray_abdomen"', 'return "xray_spine"', 'return "xray_sinuses"']) {
    assert.ok(source.includes(r), `routing ${r} present`);
  }
});

test("protocol API guards writes, signing and delivery without runtime DDL", async () => {
  const route = await read("app/api/staff/protocols/route.ts");
  assert.match(route, /requireOrgContext\(request, db\)/);
  assert.match(route, /canManageProtocols\(member\.role\)/);
  assert.match(route, /canSignProtocols\(member\.role\)/);
  assert.match(route, /sanitizeLifecycleDocument\(body\)/);
  assert.match(route, /existing\.status !== "signed"/);
  assert.match(route, /protocol_signed/);
  assert.match(route, /protocol_issued/);
  assert.match(route, /INSERT INTO protocol_revisions/);
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

test("protocol editor guards unsaved work and exposes sign-then-issue actions", async () => {
  const page = await read("app/staff/protocols/page.tsx");
  assert.match(page, /function selectBooking/);
  assert.match(page, /незбережені зміни/);
  assert.match(page, /setDirty/);
  assert.match(page, /bookingLoading/);
  assert.match(page, /Завантаження протоколу…/);
  assert.match(page, /protocolToc/);
  assert.match(page, /заповнено \$\{completeness\.filled\}\/\$\{completeness\.total\}/);
  assert.match(page, /#protocol-conclusion/);
  assert.match(page, /Підписати протокол/);
  assert.match(page, /Видати пацієнту/);
  assert.match(page, /clinicalLocked/);
  assert.match(page, /staff\?\.role === "radiologist" && doc\?\.status === "ready"/);
  assert.doesNotMatch(page, /Лікар-рентгенолог: \{booking\.assignedRadiologistEmail/);
  assert.match(page, /function patchDoc/);
});
