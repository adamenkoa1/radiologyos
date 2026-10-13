// AI-провайдер-абстракція + інваріанти безпеки AI (MASTER PROMPT 3, E5/E4).
// Перевірка через інспекцію джерела (lib/ai-provider.ts і lib/ai.ts імпортують
// lib/protocols.ts, який у рантаймі тягне extensionless "./catalog" — тож
// рантайм-імпорт під сирим ранером неможливий; це конвенція тестів AI в проєкті,
// як у ai-draft.test.mjs). Фіксуємо саме властивості безпеки.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (p) => readFile(new URL(`../${p}`, import.meta.url), "utf8");

test("provider abstraction exposes heuristic, mock and disabled providers + resolver", async () => {
  const src = await read("lib/ai-provider.ts");
  for (const sym of ["export type AiProvider", "heuristicAiProvider", "mockAiProvider", "disabledAiProvider", "export function resolveAiProvider"]) {
    assert.match(src, new RegExp(sym.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

test("no provider makes network calls; external is absent and off by default (E4.10)", async () => {
  const src = await read("lib/ai-provider.ts");
  // Жодних мережевих викликів у модулі.
  assert.doesNotMatch(src, /\bfetch\s*\(|XMLHttpRequest|https?:\/\//);
  // Усі провайдери позначені external:false; резолвер не повертає зовнішнього.
  assert.doesNotMatch(src, /external:\s*true/);
  assert.match(src, /name === "mock"\) return mockAiProvider/);
  assert.match(src, /name === "heuristic"\) return heuristicAiProvider/);
  // Fail-safe: невідоме/off → disabled.
  assert.match(src, /return disabledAiProvider/);
});

test("disabled provider yields no draft so the constructor keeps working without AI (E4.9)", async () => {
  const src = await read("lib/ai-provider.ts");
  assert.match(src, /name: "disabled",\s*\n\s*available: false/);
  assert.match(src, /ok: false, provider: "disabled", reason: "AI-функції вимкнено"/);
});

test("context sanitizer caps size and strips identifiers + injection (pre-egress guard)", async () => {
  const src = await read("lib/ai-provider.ts");
  assert.match(src, /AI_CONTEXT_MAX_CHARS/);
  assert.match(src, /export function sanitizeAiContext/);
  assert.match(src, /\[вилучено\]/); // phone/email/long-id redaction
  assert.match(src, /previous\|above\|prior/); // prompt-injection neutralization
  assert.match(src, /slice\(0, AI_CONTEXT_MAX_CHARS\)/);
});

test("the ten AI safety invariants are declared", async () => {
  const src = await read("lib/ai-provider.ts");
  assert.match(src, /export const AI_INVARIANTS/);
  for (const phrase of ["не підписує", "не видає результати", "не змінює підписані", "не вигадує", "приймається або відхиляється", "журналюються в аудиті", "конструктор працює без змін", "затвердженої конфігурації"]) {
    assert.match(src, new RegExp(phrase));
  }
});

test("existing AI draft route still forces draft status, never signs/issues, and audits (E4.1-4.4, 4.8)", async () => {
  const route = await read("app/api/staff/ai/protocol-draft/route.ts");
  assert.match(route, /status\s*:\s*["']draft["']|status:\s*"draft"/);
  assert.doesNotMatch(route, /status\s*:\s*["'](signed|issued)["']/);
  assert.doesNotMatch(route, /protocol_signed|protocol_issued/);
  assert.match(route, /ai_draft_generated/); // audites the AI operation
});

test("AI remains review-gated in the editor: drafts are inserted only on explicit doctor action", async () => {
  const page = await read("app/staff/protocols/page.tsx");
  // AI-чернетка застосовується лише через явні кнопки «Вставити…», не авто.
  assert.match(page, /applyDraft\("conclusion"\)|applyDraft\("all"\)/);
  assert.match(page, /aiDraft\.disclaimer/);
});
