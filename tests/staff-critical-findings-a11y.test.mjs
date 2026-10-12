// /staff/critical-findings — ургентні знахідки з фіксацією «донесено ким/коли».
// Зрілий модуль: act/load з try/catch/finally (екран доступу + net-error
// «Повторити»; actionError role=alert). Закрито a11y-прогалини:
//  • плейсхолдер завантаження не оголошувався (role=status);
//  • інпут «як доведено» мав лише placeholder (WCAG 4.1.2).

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const page = readFileSync(new URL("../app/staff/critical-findings/page.tsx", import.meta.url), "utf8");

test("critical-findings: loading placeholder announced, communicate input labelled", () => {
  assert.match(page, /<p className="empty" role="status" aria-live="polite">Завантаження…<\/p>/);
  assert.match(page, /<input aria-label="Як доведено критичну знахідку \(канал зв'язку\)"/);
});

test("critical-findings: resilience + access/net-error screens preserved (regression guard)", () => {
  assert.match(page, /async function act\([\s\S]*?\} catch \{[\s\S]*?setActionError\("Мережа недоступна[\s\S]*?\} finally \{[\s\S]*?setBusy\(false\)/);
  assert.match(page, /className="staffError" role="alert">\{actionError\}/);
  assert.match(page, /netError && !findings\.length \?/);
});
