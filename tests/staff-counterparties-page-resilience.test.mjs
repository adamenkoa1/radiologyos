// Сторінка контрагентів має переживати мережевий збій збереження (показати
// помилку, а не мовчазний no-op) і озвучувати статуси скрінрідером.

import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const read = (p) => readFile(new URL(`../${p}`, import.meta.url), "utf8");

test("saving a counterparty is guarded by the shared useSubmit hook", async () => {
  const page = await read("app/staff/counterparties/page.tsx");
  // resilience comes from the shared hook, not a hand-written try/catch per page
  assert.match(page, /import \{ useSubmit \} from "\.\.\/\.\.\/hooks\/use-submit"/);
  // the hook's onError surfaces a network throw instead of a silent no-op
  assert.match(page, /useSubmit\(\(\)=>setNotice\("⚠ Не вдалося зберегти/);
  // the fetch runs inside run(), which guards re-entry and resets busy
  assert.match(page, /async function save[\s\S]*?await run\(async\(\)=>\{/);
  // reload after a successful save is best-effort, so it cannot masquerade as a save failure
  assert.match(page, /await load\(\)\.catch\(\(\)=>\{\}\);/);
  // the hand-rolled busy state is gone — busy now comes from the hook
  assert.doesNotMatch(page, /setBusy\(/);
});

test("counterparty status and error messages carry screen-reader roles", async () => {
  const page = await read("app/staff/counterparties/page.tsx");
  assert.match(page, /className="financeError" role="alert">\{error\}/);
  // the single notice element toggles role/aria-live by its ⚠ prefix
  assert.match(page, /role=\{notice\.startsWith\("⚠"\)\?"alert":"status"\}/);
  assert.match(page, /aria-live=\{notice\.startsWith\("⚠"\)\?"assertive":"polite"\}/);
});
