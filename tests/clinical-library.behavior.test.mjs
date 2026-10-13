// Аудит клінічної бібліотеки протоколів (MASTER PROMPT 4, Этап 0 / PR1).
// lib/clinical-library.ts — чистий модуль без імпорту ./protocols чи БД, тож
// runtime-import безпечний. JSON-файли бібліотеки читаємо з диска й НЕЗАЛЕЖНО
// (не довіряючи маніфесту) переобчислюємо прямі підрахунки та інваріанти.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { auditLibrary, scanForPatientData, extractPlaceholders, AGREED_MODALITY_CODES } from "../lib/clinical-library.ts";

const readJson = async (name) =>
  JSON.parse(await readFile(new URL(`../clinical-library/${name}`, import.meta.url), "utf8"));

async function loadInput() {
  const [manifest, templates, findings, rules, examples] = await Promise.all([
    readJson("radiologyos-protocol-library.json"),
    readJson("radiologyos-normal-templates.json"),
    readJson("radiologyos-pathology-findings.json"),
    readJson("radiologyos-clinical-rules.json"),
    readJson("radiologyos-template-examples.json"),
  ]);
  return { manifest, templates, findings, rules, examples };
}

test("direct counts re-derived from files (not the manifest): 10 templates, 31 findings, 8 rules, 3 synthetic examples", async () => {
  const report = auditLibrary(await loadInput());
  assert.equal(report.counts.normalTemplates, 10);
  assert.equal(report.counts.findings, 31);
  assert.equal(report.counts.rules, 8);
  assert.equal(report.counts.syntheticExamplesExcluded, 3);
});

test("manifest counts agree with the direct recount", async () => {
  const report = auditLibrary(await loadInput());
  assert.equal(report.manifestMatches, true);
});

test("no patient data is detected in any template or finding text", async () => {
  const report = auditLibrary(await loadInput());
  assert.equal(report.patientDataDetected, false);
  const withPii = report.issues.filter((i) => i.code === "patient_data_detected");
  assert.equal(withPii.length, 0);
});

test("all record IDs are unique within and across sets", async () => {
  const report = auditLibrary(await loadInput());
  assert.equal(report.idsUnique, true);
});

test("non-agreed modality (MRI) is flagged needs_review, never import_ready", async () => {
  const report = auditLibrary(await loadInput());
  const mri = report.verdicts.find((v) => v.id === "mri_brain_base");
  assert.ok(mri, "mri_brain_base verdict present");
  assert.equal(mri.modality, "MRI");
  assert.equal(mri.readiness, "needs_review");
  assert.ok(mri.reasons.some((r) => /Незгоджена модальність/.test(r)));
  // Жоден запис не повинен бути import_ready у PR1 (усі draft_unvalidated).
  assert.equal(report.readinessCounts.import_ready, 0);
});

test("agreed modalities (CT, XR) are needs_review only because records are draft_unvalidated", async () => {
  const report = auditLibrary(await loadInput());
  const ct = report.verdicts.find((v) => v.id === "ct_brain_normal");
  assert.equal(ct.modality, "CT");
  assert.equal(ct.readiness, "needs_review");
  assert.ok(ct.reasons.some((r) => /draft_unvalidated/.test(r)));
  assert.ok(!ct.reasons.some((r) => /Незгоджена модальність/.test(r)));
  assert.deepEqual([...AGREED_MODALITY_CODES], ["CT", "XR"]);
});

test("every record classified; readiness totals sum to 41 (10+31)", async () => {
  const report = auditLibrary(await loadInput());
  assert.equal(report.verdicts.length, 41);
  const sum = report.readinessCounts.import_ready + report.readinessCounts.needs_review + report.readinessCounts.rejected;
  assert.equal(sum, 41);
  assert.equal(report.readinessCounts.rejected, 0);
});

test("all finding placeholders are backed by a declared parameter (no undefined placeholders)", async () => {
  const report = auditLibrary(await loadInput());
  const undef = report.issues.filter((i) => /Невизначені плейсхолдери/.test(i.message));
  assert.equal(undef.length, 0);
});

test("library is safe for a future dry-run (no errors, no patient data) — NOT a production-import permission", async () => {
  const report = auditLibrary(await loadInput());
  assert.equal(report.safeForDryRun, true);
  assert.equal(report.issues.some((i) => i.severity === "error"), false);
});

test("scanForPatientData catches obvious PII patterns", () => {
  assert.deepEqual(scanForPatientData("Контакт: ivan@example.com"), ["email"]);
  assert.deepEqual(scanForPatientData("тел +38 067 123 45 67"), ["phone"]);
  assert.ok(scanForPatientData("пацієнт Іваненко І.І.").includes("named_patient"));
  assert.deepEqual(scanForPatientData("У {location} визначається ділянка розміром {size_mm} мм."), []);
});

test("extractPlaceholders returns template variable names", () => {
  assert.deepEqual(extractPlaceholders("На рівні {level} випинання до {size_mm} мм"), ["level", "size_mm"]);
  assert.deepEqual(extractPlaceholders("без змінних"), []);
});

test("synthetic patient examples are excluded from records (handled separately, never imported)", async () => {
  const { examples } = await loadInput();
  // Приклади — тестові фікстури, НЕ записи бібліотеки. Переконуємось, що жоден
  // приклад не потрапляє у verdicts (тобто не трактується як реальний шаблон).
  const report = auditLibrary(await loadInput());
  const exampleIds = new Set(examples.map((e) => e.id));
  const leaked = report.verdicts.filter((v) => exampleIds.has(v.id));
  assert.equal(leaked.length, 0);
  assert.equal(report.counts.syntheticExamplesExcluded, examples.length);
});
