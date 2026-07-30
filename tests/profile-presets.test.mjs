import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PROFILE_DESCRIPTIONS, PROFILE_TYPES, profilePresetFlags } from "../lib/org-profile.ts";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

// Кожен профіль має опис і повний пресет прапорців.
test("every profile has a description and a full preset", () => {
  for (const p of PROFILE_TYPES) {
    assert.ok(PROFILE_DESCRIPTIONS[p] && PROFILE_DESCRIPTIONS[p].length > 10, `${p} description`);
    const preset = profilePresetFlags(p);
    // Пресет визначає значення для КОЖНОЇ можливості (deny-by-default → false).
    assert.equal(typeof preset.dicom_pacs, "boolean");
    assert.equal(typeof preset.contrast, "boolean");
  }
  // Пресети відрізняються за профілем.
  assert.equal(profilePresetFlags("private_ct").contrast, true);
  assert.equal(profilePresetFlags("hospital_radiology").contrast, false);
  assert.equal(profilePresetFlags("private_ct").nszu, false);
  assert.equal(profilePresetFlags("hospital_radiology").nszu, true);
});

// API підтримує застосування пресета й віддає опис/пресет.
test("org-profile API supports preset application and exposes description", async () => {
  const route = await read("app/api/staff/org-profile/route.ts");
  assert.match(route, /applyPreset\?: boolean/);
  assert.match(route, /profilePresetFlags\(profileType\)/);
  assert.match(route, /profileDescription: PROFILE_DESCRIPTIONS\[profile\.profileType\]/);
  assert.match(route, /presetFlags: profilePresetFlags/);
});

// Сторінка показує опис профілю та кнопку застосування пресета.
test("organization page shows description and apply-preset button", async () => {
  const page = await read("app/staff/organization/page.tsx");
  assert.match(page, /profileDescription/);
  assert.match(page, /applyPreset:true/);
  assert.match(page, /orgPresetButton/);
});
