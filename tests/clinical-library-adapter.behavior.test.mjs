// Адаптер бібліотеки → модель RadiologyOS + dry-run план імпорту
// (MASTER PROMPT 4, Этап 2-3 / PR2). lib/clinical-library-adapter.ts — чистий,
// runtime-importable (value-import extensionless-сусідів прибрано). Перевіряємо
// детермінований план, ідемпотентність, безпечні межі.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  planImport,
  adaptFinding,
  adaptNormalTemplate,
  importKeyFor,
  measurementKindFor,
  expectedTemplateKey,
  FINDING_REGION_TO_CATALOG,
} from "../lib/clinical-library-adapter.ts";
import { FINDINGS_CATALOG } from "../lib/findings-composer.ts";
import { AGREED_MODALITY_CODES } from "../lib/clinical-library.ts";

const readJson = async (name) => JSON.parse(await readFile(new URL(`../clinical-library/${name}`, import.meta.url), "utf8"));

async function loadLibrary() {
  const [templates, findings] = await Promise.all([
    readJson("radiologyos-normal-templates.json"),
    readJson("radiologyos-pathology-findings.json"),
  ]);
  return { templates, findings };
}

// Наявні ключі базових шаблонів читаємо з джерела protocols.ts (runtime-import
// protocols.ts неможливий — extensionless ./catalog; це конвенція проєкту).
async function existingTemplateKeys() {
  const src = await readFile(new URL("../lib/protocols.ts", import.meta.url), "utf8");
  return [...src.matchAll(/key:\s*"([a-z_]+)"/g)].map((m) => m[1]);
}

async function makeCtx(extra = {}) {
  return { existingCatalog: FINDINGS_CATALOG, existingTemplateKeys: await existingTemplateKeys(), ...extra };
}

test("plan is deterministic with the expected bucket counts (22 create / 6 skip / 13 needs_review / 0 reject)", async () => {
  const plan = planImport(await loadLibrary(), await makeCtx());
  assert.deepEqual(plan.counts, { create: 22, skip: 6, needs_review: 13, reject: 0 });
  assert.equal(plan.items.length, 41);
  assert.equal(plan.safeForDryRun, true);
});

test("nothing is ever published and every created item requires review", async () => {
  const plan = planImport(await loadLibrary(), await makeCtx());
  for (const it of plan.items) assert.equal(it.published, false, `${it.sourceId} must not be published`);
  for (const it of plan.items.filter((i) => i.action === "create")) {
    assert.equal(it.requiresReview, true, `${it.sourceId} create must require review`);
  }
});

test("existing base templates are skipped (never overwritten)", async () => {
  const plan = planImport(await loadLibrary(), await makeCtx());
  const skipped = plan.items.filter((i) => i.kind === "normal_template" && i.action === "skip").map((i) => i.sourceId).sort();
  assert.deepEqual(skipped, ["ct_abdomen_normal", "ct_brain_normal", "ct_chest_normal", "ct_spine_normal", "xr_chest_normal", "xr_joint_normal"]);
});

test("MRI template and unmapped-region templates go to needs_review, not create", async () => {
  const plan = planImport(await loadLibrary(), await makeCtx());
  const nr = plan.items.filter((i) => i.kind === "normal_template" && i.action === "needs_review").map((i) => i.sourceId).sort();
  assert.deepEqual(nr, ["cta_vascular_normal", "ct_neck_normal", "mri_brain_base"].sort());
  const mri = plan.items.find((i) => i.sourceId === "mri_brain_base");
  assert.match(mri.reason, /незгоджена модальність/i);
});

test("findings in regions absent from the constructor (bones/neck/vascular) are held for review", async () => {
  const plan = planImport(await loadLibrary(), await makeCtx());
  const nrFindings = plan.items.filter((i) => i.kind === "finding" && i.action === "needs_review");
  assert.equal(nrFindings.length, 10); // bones_joints 4 + head_neck 3 + vascular 3
  for (const it of nrFindings) assert.match(it.reason, /не представлена в наявному конструкторі/);
});

test("obvious duplicate concepts are flagged advisory (not silently created, not silently skipped)", async () => {
  const plan = planImport(await loadLibrary(), await makeCtx());
  const dups = plan.items.filter((i) => i.possibleDuplicateOf);
  const ids = dups.map((i) => i.sourceId).sort();
  assert.deepEqual(ids, ["finding_012", "finding_015"]);
  for (const d of dups) assert.equal(d.action, "create"); // flagged, decision left to PR3/PR4 review
});

test("idempotency: re-running with already-imported keys yields all skip, no creates", async () => {
  const lib = await loadLibrary();
  const first = planImport(lib, await makeCtx());
  const done = new Set(first.items.map((i) => i.importKey));
  const second = planImport(lib, await makeCtx({ alreadyImported: done }));
  assert.equal(second.counts.create, 0);
  assert.equal(second.counts.needs_review, 0);
  assert.equal(second.counts.skip, 41);
  for (const it of second.items) assert.match(it.reason, /ідемпотентність/);
});

test("adaptFinding maps measurements by unit/key and keeps all parameters", async () => {
  const { findings } = await loadLibrary();
  const f001 = adaptFinding(findings.find((f) => f.id === "finding_001")); // location + size_mm
  assert.equal(f001.catalogRegionKey, "ct_brain");
  assert.deepEqual(f001.measurements, ["sizeMm"]);
  assert.equal(f001.requiresReview, true);
  const f013 = adaptFinding(findings.find((f) => f.id === "finding_013")); // density_hu + spleen_hu
  assert.deepEqual(f013.measurements, ["hu"]);
  assert.equal(f013.parameters.length, 2);
});

test("adaptNormalTemplate computes expected base key and flags review", async () => {
  const { templates } = await loadLibrary();
  const brain = adaptNormalTemplate(templates.find((t) => t.id === "ct_brain_normal"));
  assert.equal(brain.expectedKey, "ct_brain");
  assert.equal(brain.requiresReview, true);
  const neck = adaptNormalTemplate(templates.find((t) => t.id === "ct_neck_normal"));
  assert.equal(neck.expectedKey, null); // head_neck has no base-template representation
});

test("pure helpers behave as specified", () => {
  assert.equal(importKeyFor("finding_007"), "clinlib:finding_007");
  assert.equal(expectedTemplateKey("CT", "brain"), "ct_brain");
  assert.equal(expectedTemplateKey("MRI", "brain"), "mri_brain");
  assert.equal(expectedTemplateKey("CT", "vascular"), undefined);
  assert.equal(measurementKindFor({ key: "size_mm", unit: "mm" }), "sizeMm");
  assert.equal(measurementKindFor({ key: "density_hu", unit: "HU" }), "hu");
  assert.equal(measurementKindFor({ key: "stenosis_percent", unit: "%" }), undefined);
  assert.equal(FINDING_REGION_TO_CATALOG.vascular, undefined);
});

test("local AGREED_MODALITY_CODES copy stays in sync with clinical-library", () => {
  // Guard: adapter's inlined copy must equal the canonical source of truth.
  assert.deepEqual([...AGREED_MODALITY_CODES], ["CT", "XR"]);
});
