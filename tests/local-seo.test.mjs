import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("public NAP resolves from the editable site_content source", async () => {
  const profile = await read("lib/public-profile.ts");
  assert.match(profile, /SITE_CONTENT_KEY/);
  assert.match(profile, /parseSiteContent/);
  assert.match(profile, /brandTitle/);
  assert.match(profile, /brandSubtitle/);
  assert.match(profile, /content\.phone/);
  assert.match(profile, /content\.address/);
  assert.match(profile, /content\.workHours/);
  assert.doesNotMatch(profile, /\+380 97 280 88 99/);
  assert.doesNotMatch(profile, /Полуботка, 40/);
});

test("local SEO component emits MedicalClinic JSON-LD and visible NAP from one profile", async () => {
  const component = await read("app/components/public-local-seo.tsx");
  assert.match(component, /publicOrganizationProfile\(\)/);
  assert.match(component, /"@type": "MedicalClinic"/);
  assert.match(component, /"@type": "PostalAddress"/);
  assert.match(component, /profile\.telephone/);
  assert.match(component, /profile\.address/);
  assert.match(component, /profile\.openingHours/);
  assert.match(component, /application\/ld\+json/);
  assert.match(component, /Контактна інформація відділення/);
});

test("all public diagnostic landing routes render dynamic local SEO identity", async () => {
  for (const path of [
    "app/ct/[[...slug]]/page.tsx",
    "app/xray/page.tsx",
    "app/fluorography/page.tsx",
  ]) {
    const route = await read(path);
    assert.match(route, /dynamic = "force-dynamic"/);
    assert.match(route, /PublicLocalSeo/);
  }
});

test("patient and staff surfaces remain excluded from the public schema component", async () => {
  const component = await read("app/components/public-local-seo.tsx");
  assert.doesNotMatch(component, /patient|booking|protocol|staff/i);
});
