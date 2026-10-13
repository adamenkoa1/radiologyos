// Детермінована перевірка суперечностей опис↔висновок (MP3 E2).
// lib/protocol-contradictions.ts — чистий модуль без залежностей, тож
// імпортується в рантаймі. Перевіряємо всі 7 правил + відсутність хибних
// спрацювань на узгоджених/двобічних текстах.

import assert from "node:assert/strict";
import test from "node:test";
import { findContradictions } from "../lib/protocol-contradictions.ts";

const codes = (input) => findContradictions(input).map((c) => c.code);

test("laterality: opposite side in description vs conclusion is flagged", () => {
  assert.ok(codes({ findings: "У правій легені вогнище.", conclusion: "Зміни у лівій легені." }).includes("laterality_description_vs_conclusion"));
});
test("laterality: same side or bilateral is NOT flagged", () => {
  assert.equal(codes({ findings: "У правій легені вогнище.", conclusion: "Зміни у правій легені." }).includes("laterality_description_vs_conclusion"), false);
  assert.equal(codes({ findings: "Двобічні зміни.", conclusion: "У лівій легені." }).includes("laterality_description_vs_conclusion"), false);
});

test("gallbladder: normal in description but distension in conclusion is flagged", () => {
  assert.ok(codes({ findings: "Жовчний міхур не збільшений, конкрементів немає.", conclusion: "КТ-ознаки дистензії жовчного міхура." }).includes("gallbladder_distension_without_finding"));
});

test("ascites: present in description but denied in conclusion is flagged (and vice versa)", () => {
  assert.ok(codes({ findings: "У черевній порожнині визначається вільна рідина.", conclusion: "Вільної рідини не виявлено." }).includes("ascites_present_but_denied"));
  assert.ok(codes({ findings: "Вільної рідини немає.", conclusion: "КТ-ознаки асциту." }).includes("ascites_present_but_denied"));
});
test("ascites: consistent statements are NOT flagged", () => {
  assert.equal(codes({ findings: "Визначається асцит.", conclusion: "КТ-ознаки наявності вільної рідини." }).includes("ascites_present_but_denied"), false);
});

test("fracture level mismatch (C6 vs C7) is flagged", () => {
  const c = codes({ findings: "Перелом остистого відростка C6.", conclusion: "Перелом на рівні C7." });
  assert.ok(c.includes("fracture_level_mismatch"));
});
test("fracture same level is NOT flagged", () => {
  assert.equal(codes({ findings: "Перелом C6.", conclusion: "Перелом C6." }).includes("fracture_level_mismatch"), false);
});

test("protrusion in description but herniation in conclusion is flagged", () => {
  assert.ok(codes({ findings: "Протрузія диска L4-L5 розміром 5 мм.", conclusion: "Грижа диска L4-L5." }).includes("protrusion_called_herniation"));
});
test("herniation in both is NOT flagged as protrusion→herniation", () => {
  assert.equal(codes({ findings: "Грижа диска.", conclusion: "Грижа диска." }).includes("protrusion_called_herniation"), false);
});

test("vascular occlusion in conclusion on native CT is flagged", () => {
  assert.ok(codes({ findings: "Нативне дослідження.", conclusion: "Ознаки тромбозу ворітної вени.", contrast: "Без контрастування" }).includes("occlusion_on_native_ct"));
});
test("occlusion with IV contrast is NOT flagged", () => {
  assert.equal(codes({ findings: "", conclusion: "Ознаки тромбозу.", contrast: "Внутрішньовенне контрастування" }).includes("occlusion_on_native_ct"), false);
});

test("mm in description but same number as cm in conclusion is flagged as a unit error", () => {
  assert.ok(codes({ findings: "Утворення розміром 18 мм.", conclusion: "Утворення 18 см." }).includes("unit_mm_cm_mismatch"));
});
test("correct mm/cm (different numbers) is NOT flagged", () => {
  assert.equal(codes({ findings: "Утворення 18 мм.", conclusion: "Утворення 1,8 см." }).includes("unit_mm_cm_mismatch"), false);
});

test("clean, consistent protocol yields no contradictions", () => {
  assert.deepEqual(findContradictions({
    findings: "У правій легені визначається вогнище 8 мм.",
    conclusion: "КТ-ознаки вогнища правої легені розміром 8 мм.",
    contrast: "Без контрастування",
  }), []);
});

test("every contradiction carries a human-readable explanation (advisory, not a rewrite)", () => {
  const list = findContradictions({ findings: "У правій легені.", conclusion: "У лівій легені." });
  assert.ok(list.length > 0);
  for (const c of list) assert.ok(typeof c.message === "string" && c.message.length > 10);
});
