import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("intake never presents phone-matched bookings as one patient's clinical history", async () => {
  const page = await read("app/staff/intake/page.tsx");

  assert.doesNotMatch(page, /digits\(b\.phone\)\s*===\s*ph/);
  assert.doesNotMatch(page, /Попередні дослідження цього пацієнта[^\n]*номер(?:ом)? телефону/i);
  assert.doesNotMatch(page, /Перше звернення цього пацієнта \(за номером телефону\)/);
  assert.match(page, /Історію не визначаємо за номером телефону/);
  assert.match(page, /\/staff\/patients\?phone=/);
});
