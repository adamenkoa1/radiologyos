import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  SITE_CONTENT_DEFAULTS,
  parseSiteContent,
  sanitizeSiteContent,
} from "../lib/site-content.ts";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("sanitizeSiteContent clamps text, coerces published and keeps defaults", () => {
  const out = sanitizeSiteContent({ brandTitle: "  Нова назва  ", published: 0, unknown: "x" });
  assert.equal(out.brandTitle, "Нова назва"); // trimmed
  assert.equal(out.published, false); // coerced from falsy
  assert.equal(out.brandSubtitle, SITE_CONTENT_DEFAULTS.brandSubtitle); // missing → default
  assert.ok(!("unknown" in out)); // unknown fields dropped
  const long = sanitizeSiteContent({ brandTitle: "x".repeat(500) });
  assert.ok(long.brandTitle.length <= 120); // max length enforced
});

test("published defaults to true when unset", () => {
  assert.equal(sanitizeSiteContent({}).published, true);
});

test("parseSiteContent returns defaults for empty or invalid JSON", () => {
  assert.deepEqual(parseSiteContent(""), SITE_CONTENT_DEFAULTS);
  assert.deepEqual(parseSiteContent("{bad json"), SITE_CONTENT_DEFAULTS);
  assert.equal(parseSiteContent(JSON.stringify({ phone: "+380 44 000" })).phone, "+380 44 000");
});

test("admin site route is admin-only and persists to app_settings", async () => {
  const route = await read("app/api/staff/site/route.ts");
  assert.match(route, /member\.role !== "admin"/);
  assert.match(route, /setSetting\(db, SITE_CONTENT_KEY/);
  assert.match(route, /sanitizeSiteContent\(body\.content\)/);
});

test("public site-content endpoint returns merged content", async () => {
  const route = await read("app/api/site-content/route.ts");
  assert.match(route, /parseSiteContent\(/);
  assert.match(route, /cache-control.*no-store/);
});

test("editor page and nav item exist", async () => {
  const page = await read("app/staff/site/page.tsx");
  assert.match(page, /\/api\/staff\/site/);
  assert.match(page, /active="site"/);
  assert.match(page, /published/);
  const shell = await read("app/staff/workspace-shell.tsx");
  assert.match(shell, /href:"\/staff\/site"/);
  assert.match(shell, /"site"/); // section in the union
});

test("landing pulls storefront config from the API and gates on published", async () => {
  const html = await read("public/site/index.html");
  assert.match(html, /fetch\('\/api\/site-content'/);
  assert.match(html, /c\.published===false/); // draft → placeholder
  assert.match(html, /id="scSlogan"/);
  assert.match(html, /id="scAbout"/);
});
