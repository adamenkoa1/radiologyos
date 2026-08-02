import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("the public homepage combines hospital information, services and booking", async () => {
  const page = await read("public/site/index.html");
  for (const marker of [
    "scSlogan",
    "scAbout",
    "Досвід, підтверджений щоденною практикою",
    "29 700",
    "16 500",
    "10 400",
    "2 800",
    "80 досліджень щодня",
    "Військовослужбовцям",
    "Цивільним особам",
    "Дослідження та вартість",
    "Режим роботи",
    "scPhoneLink",
    "tel:\\+380972808899",
    "Номер скопійовано",
    "homeTariffs",
    "/staff/login",
  ]) assert.match(page, new RegExp(marker));
  assert.doesNotMatch(page, /scLogo|brand-logo/);
  assert.match(page, /\/api\/site-content/);
  assert.match(page, /\/api\/department-profile/);
  assert.match(page, /Екстрені дослідження для військовослужбовців/);
  const contentDefaults = await read("public/site/assets/department.js");
  assert.match(contentDefaults, /08:30–17:30/);
  assert.match(contentDefaults, /Досвід, якому можна довіряти/);
});

test("public booking collects a complete identity and assigns a free visit time", async () => {
  const page = await read("public/site/index.html");
  const route = await read("app/api/site-booking/route.ts");
  assert.match(page, /id="patientPhone"/);
  assert.match(page, /id="patientDob"/);
  assert.match(page, /Прізвище, ім’я та по батькові/);
  assert.match(page, /id="patientCategory"/);
  assert.doesNotMatch(page, /id="desiredDate"|id="desiredTime"/);
  assert.match(route, /assignEarliestAppointments\(/);
  assert.match(route, /Спосіб отримання результату:/);
});
