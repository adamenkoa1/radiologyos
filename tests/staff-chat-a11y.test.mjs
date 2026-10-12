// /staff/chat (контакт-центр) — зрілий модуль із суворою ідентифікацією
// (patient/legacy/shared-phone reply-gating; клінічна безпека — НЕ чіпати).
// Резилієнс: loadConversations/openConversation/reply з try/catch/finally;
// role=alert на помилках, role=status на delivery-банерах; пошук має aria-label.
// Закрито a11y-прогалини: канальні фільтри → aria-pressed; елементи списку →
// aria-current; плейсхолдер завантаження списку → role=status; інпут відповіді
// → aria-label.

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const page = readFileSync(new URL("../app/staff/chat/page.tsx", import.meta.url), "utf8");

test("chat channel filters expose aria-pressed, list items aria-current", () => {
  assert.match(page, /<button key=\{value\} type="button" aria-pressed=\{channel === value\}/);
  assert.match(page, /aria-current=\{active\?\.conversationKey === c\.conversationKey \? "true" : undefined\}/);
});

test("chat loading placeholder announced and reply input labelled", () => {
  assert.match(page, /\{!loaded \? <p className="empty" role="status" aria-live="polite">Завантаження…<\/p>/);
  assert.match(page, /aria-label="Відповідь пацієнту у WhatsApp"/);
});

test("chat clinical reply-gating preserved (regression guard)", () => {
  // Блокування відповіді для shared-phone/legacy-ambiguous — не послаблювати.
  assert.match(page, /const canReplyWhatsApp = !!active && replyChannels\.includes\("whatsapp"\) && !activeSharedPhone && !activeLegacyAmbiguous/);
});
