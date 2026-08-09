import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("build emits a no-cache rule for the public /site so updates show at once", async () => {
  // dist/client/_headers збирається білдом (див. scripts/build-verified.sh).
  const headers = await read("dist/client/_headers");
  // Хешовані ассети — вічний immutable-кеш.
  assert.match(headers, /\/assets\/\*\s+Cache-Control: public, max-age=31536000, immutable/);
  // Публічний сайт без кеш-хешів — revalidate, щоб деплой було видно одразу.
  assert.match(headers, /\/site\/\*\s+Cache-Control: no-cache/);
});

test("build script appends the /site rule after vinext build", async () => {
  const script = await read("scripts/build-verified.sh");
  assert.match(script, /dist\/client\/_headers/);
  assert.match(script, /\/site\/\*\\n\s+Cache-Control: no-cache/);
});
