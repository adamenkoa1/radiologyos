import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("service config supports optional name/description overrides that fall back to the catalog", async () => {
  const config = await read("lib/service-config.ts");
  // Optional wording overrides on the config record.
  assert.match(config, /title\?: string;/);
  assert.match(config, /description\?: string;/);
  // Validated with length caps.
  assert.match(config, /Некоректна назва для послуги/);
  assert.match(config, /Некоректний опис для послуги/);
  // Sanitised: trimmed, capped, and dropped when empty (so empty ⇒ catalog default).
  assert.match(config, /source\.title\.trim\(\)\.slice\(0, TITLE_MAX\)/);
  assert.match(config, /source\.description\.trim\(\)\.slice\(0, DESCRIPTION_MAX\)/);
  assert.match(config, /\.\.\.\(title \? \{ title \} : \{\}\)/);
  assert.match(config, /\.\.\.\(description \? \{ description \} : \{\}\)/);
  // configuredService spreads the config over the catalog service, so a present
  // override wins and an absent one keeps the catalog wording.
  assert.match(config, /return \{ \.\.\.service, \.\.\.row \};/);
});

test("public tariff endpoint and price page carry the effective name/description", async () => {
  const route = await read("app/api/tariffs/route.ts");
  assert.match(route, /titles\[service\.code\] = service\.title/);
  assert.match(route, /descriptions\[service\.code\] = service\.description/);
  assert.match(route, /Response\.json\(\{ prices, titles, descriptions \}/);

  const price = await read("public/site/price.html");
  assert.match(price, /titles=\(d&&d\.titles\)/);
  assert.match(price, /titleEl\.textContent=titles\[code\]/);
  assert.match(price, /helpEl\.textContent=descs\[code\]/);
  // The add-to-cart button is rebuilt so the drawer label/estimate stay in sync.
  assert.match(price, /btn\.setAttribute\('onclick','addToCart/);
});

test("the staff services panel exposes editable name and description fields", async () => {
  const page = await read("app/staff/services/page.tsx");
  assert.match(page, /Назва \(публічна\)/);
  assert.match(page, /Що входить \(опис\)/);
  assert.match(page, /change\(row\.code, "title", event\.target\.value\)/);
  assert.match(page, /change\(row\.code, "description", event\.target\.value\)/);
  // Placeholders show the catalog default so the admin sees what they override.
  assert.match(page, /placeholder=\{service\.title\}/);
  assert.match(page, /placeholder=\{service\.description\}/);
});
