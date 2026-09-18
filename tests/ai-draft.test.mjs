import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("AI library exposes a deterministic draft engine behind a stable contract", async () => {
  const source = await read("lib/ai.ts");
  for (const fn of [
    "collectDeviations", "heuristicDraft", "buildDraftPrompt", "generateProtocolDraft",
  ]) assert.match(source, new RegExp(`export function ${fn}`));
  // Draft is explicitly not a diagnosis.
  assert.match(source, /export const AI_DISCLAIMER/);
  assert.match(source, /Не є медичним висновком чи діагнозом/);
  // Single swap point for a future LLM provider.
  assert.match(source, /buildDraftPrompt/);
  assert.match(source, /return heuristicDraft\(document, context\)/);
});

test("AI draft API guards generation and audits it", async () => {
  const route = await read("app/api/staff/ai/protocol-draft/route.ts");
  assert.match(route, /requireOrgContext\(request, db\)/); // tenant-scoped доступ
  assert.match(route, /canManageProtocols\(member\.role\)/);
  assert.match(route, /sanitizeDocument\(/);
  assert.match(route, /generateProtocolDraft\(/);
  assert.match(route, /INSERT INTO booking_events \(organization_id, booking_id, action, details, actor\)/);
  assert.match(route, /\.bind\(ctx\.organizationId, bookingId,/);
  assert.match(route, /ai_draft_generated/);
  assert.doesNotMatch(route, /CREATE\s+TABLE/i);
  assert.doesNotMatch(route, /ALTER\s+TABLE/i);
});

test("protocol editor wires the AI assistant with a review disclaimer", async () => {
  const page = await read("app/staff/protocols/page.tsx");
  assert.match(page, /generateProtocolDraft|generateDraft/);
  assert.match(page, /\/api\/staff\/ai\/protocol-draft/);
  assert.match(page, /aiDraft\.disclaimer/);
  assert.match(page, /applyDraft/);
});
