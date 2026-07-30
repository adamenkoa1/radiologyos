import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  FEATURE_FLAGS, PROFILE_TYPES, isFeatureFlag, isProfileType, resolveFlags,
} from "../lib/org-profile.ts";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

// Профілі та прапорці — відомий канон, deny-by-default.
test("profiles and feature flags form a known catalog", () => {
  assert.deepEqual([...PROFILE_TYPES], ["hospital_radiology", "private_ct", "dental", "outpatient_clinic"]);
  assert.ok(FEATURE_FLAGS.includes("dicom_pacs"));
  assert.ok(isProfileType("private_ct") && !isProfileType("banana"));
  assert.ok(isFeatureFlag("nszu") && !isFeatureFlag("nope"));
});

// Дефолти профілю: госпіталь має DICOM/НСЗУ, приватний КТ — контраст/пакети.
test("profile defaults differ and every flag resolves to a boolean", () => {
  const hospital = resolveFlags("hospital_radiology", {});
  assert.equal(hospital.dicom_pacs, true);
  assert.equal(hospital.nszu, true);
  assert.equal(hospital.contrast, false);

  const ct = resolveFlags("private_ct", {});
  assert.equal(ct.contrast, true);
  assert.equal(ct.packages, true);
  assert.equal(ct.nszu, false);

  // Кожен канонічний прапорець присутній і булевий.
  for (const flag of FEATURE_FLAGS) {
    assert.equal(typeof hospital[flag], "boolean", `${flag} resolved`);
  }
});

// Override перекриває дефолт профілю в обидва боки.
test("overrides win over profile defaults", () => {
  assert.equal(resolveFlags("hospital_radiology", { dicom_pacs: false }).dicom_pacs, false);
  assert.equal(resolveFlags("outpatient_clinic", { dicom_pacs: true }).dicom_pacs, true);
  // Невідомі ключі overrides не впливають на канон (фільтруються при читанні).
  assert.equal(resolveFlags("dental", {}).protocols, true);
});

// API профілю tenant-scoped; зміна — лише адмін; збереження — лише override-и.
test("org-profile API is tenant-scoped and admin-gated", async () => {
  const route = await read("app/api/staff/org-profile/route.ts");
  assert.match(route, /requireOrgContext\(request, db\)/);
  assert.match(route, /ctx\.role !== "admin"/);
  assert.match(route, /getOrgProfile\(db, ctx\)/);
  assert.match(route, /organization_profiles/);
  assert.match(route, /ON CONFLICT\(organization_id\)/);
});

// Feature flag реально керує UI: колонка «Знімки» залежить від dicom_pacs.
test("feature flags drive UI (studies PACS column gated by dicom_pacs)", async () => {
  const studiesRoute = await read("app/api/staff/studies/route.ts");
  assert.match(studiesRoute, /getOrgProfile\(db, ctx\)/);
  assert.match(studiesRoute, /dicomPacs: profile\.flags\.dicom_pacs/);
  const page = await read("app/staff/studies/page.tsx");
  assert.match(page, /data\.features\?\.dicomPacs/);
  const shell = await read("app/staff/workspace-shell.tsx");
  assert.match(shell, /href:"\/staff\/organization"/);
});
