import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("the public homepage combines hospital information, services and booking", async () => {
  const page = await read("app/page.tsx");
  for (const marker of [
    "hospital-emblem.jpg",
    "Кабінети й обладнання",
    "hospitalDepartment",
    "totalStudies2025",
    "siteContent.milTitle",
    "siteContent.civTitle",
    "Онлайн-запис",
    "Кабінет пацієнта",
  ]) assert.match(page, new RegExp(marker));
  assert.doesNotMatch(page, /className="hospitalStats"/);
  assert.match(page, /\/api\/department-profile/);
  assert.match(page, /\/api\/site-content/);
});

test("public booking collects phone, email and result delivery preference", async () => {
  const page = await read("app/page.tsx");
  const route = await read("app/api/site-booking/route.ts");
  assert.match(page, /name="phone"/);
  assert.match(page, /name="email"[^>]+required/);
  assert.match(page, /name="resultDelivery"/);
  assert.match(route, /Спосіб отримання результату:/);
});
