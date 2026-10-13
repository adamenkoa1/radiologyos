// Рендер чернетки імпортованої знахідки (MP4 PR3). lib/clinical-library-finding.ts
// — чистий, runtime-importable. Перевіряємо заповнення шаблону, захист від
// напів-порожніх абзаців і форматування чисел.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { renderLibraryFinding, activeParameters } from "../lib/clinical-library-finding.ts";

const findings = JSON.parse(await readFile(new URL("../clinical-library/radiologyos-pathology-findings.json", import.meta.url), "utf8"));
const byId = (id) => findings.find((f) => f.id === id);

test("fills description and conclusion from parameter values", () => {
  const r = renderLibraryFinding(byId("finding_001"), { location: "лівій тім'яній частці", size_mm: 12 });
  assert.equal(r.ok, true);
  assert.equal(r.description, "У лівій тім'яній частці визначається ділянка кістозно-гліозних змін розміром 12 мм.");
  assert.equal(r.conclusion, "КТ-ознаки локальних кістозно-гліозних змін у лівій тім'яній частці.");
});

test("refuses to render with a missing required parameter (no half-empty paragraph)", () => {
  const r = renderLibraryFinding(byId("finding_001"), { location: "", size_mm: 12 });
  assert.equal(r.ok, false);
  assert.deepEqual(r.missing, ["location"]);
  // жодного {плейсхолдера} не витікає
});

test("formats numbers with comma decimals and a true minus sign", () => {
  const r = renderLibraryFinding(byId("finding_013"), { density_hu: -12.5, spleen_hu: 48 });
  assert.equal(r.ok, true);
  assert.match(r.description, /−12,5 HU/);
  assert.match(r.description, /48 HU/);
});

test("accepts numeric strings for number parameters", () => {
  const r = renderLibraryFinding(byId("finding_020"), { level: "L4–L5", size_mm: "9" });
  assert.equal(r.ok, true);
  assert.match(r.description, /9 мм|до 9/);
});

test("activeParameters returns only placeholders actually used in the templates", () => {
  const active = activeParameters(byId("finding_019")).map((p) => p.key).sort();
  assert.deepEqual(active, ["level", "morphology", "size_mm"]);
});

test("every library finding renders when all required params are provided (no undefined placeholders survive)", () => {
  for (const f of findings) {
    const values = {};
    for (const p of f.parameters) values[p.key] = p.type === "number" ? 5 : "тест";
    const r = renderLibraryFinding(f, values);
    assert.equal(r.ok, true, `${f.id} should render`);
    assert.doesNotMatch(r.description, /\{[a-z0-9_]+\}/, `${f.id} description has leftover placeholder`);
    assert.doesNotMatch(r.conclusion, /\{[a-z0-9_]+\}/, `${f.id} conclusion has leftover placeholder`);
  }
});
