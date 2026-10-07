// Спільний хук мутацій useSubmit має за побудовою закривати три режими збою,
// які аудит стійкості /staff знаходив у рукописних submit-хендлерах:
// подвійний сабміт, мовчазний збій і «залиплий» busy.

import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const read = (p) => readFile(new URL(`../${p}`, import.meta.url), "utf8");

test("useSubmit guards re-entry, always resets busy, and routes throws to onError", async () => {
  const src = await read("app/hooks/use-submit.ts");
  // synchronous re-entry guard via ref → no double-submit
  assert.match(src, /const inFlight = useRef\(false\)/);
  assert.match(src, /if \(inFlight\.current\) return;/);
  assert.match(src, /inFlight\.current = true;/);
  // exposes busy for the UI
  assert.match(src, /setBusy\(true\)/);
  assert.match(src, /return \{ busy, run \}/);
  // a throw is routed to onError instead of escaping unhandled → no silent failure
  assert.match(src, /catch \(error\) \{[\s\S]*?onError\?\.\(error\);/);
  // busy and the in-flight flag are always reset → no stuck busy
  assert.match(src, /finally \{[\s\S]*?inFlight\.current = false;[\s\S]*?setBusy\(false\);/);
});
