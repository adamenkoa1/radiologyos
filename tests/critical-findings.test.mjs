// Критичні знахідки — чиста логіка статусів і санітизації.

import assert from "node:assert/strict";
import test from "node:test";
import {
  isCriticalStatus, sanitizeNote, sanitizeVia, canTransition, CRITICAL_STATUS_LABELS,
} from "../lib/critical-findings.ts";

test("isCriticalStatus впізнає лише валідні статуси", () => {
  assert.equal(isCriticalStatus("open"), true);
  assert.equal(isCriticalStatus("communicated"), true);
  assert.equal(isCriticalStatus("resolved"), true);
  assert.equal(isCriticalStatus("done"), false);
});

test("sanitizeNote/sanitizeVia обрізають і тримають межі", () => {
  assert.equal(sanitizeNote("  крововилив  "), "крововилив");
  assert.equal(sanitizeNote("a".repeat(2000)).length, 1000);
  assert.equal(sanitizeVia("  телефон  "), "телефон");
  assert.equal(sanitizeVia("x".repeat(200)).length, 80);
});

test("canTransition: лише вперед open→communicated→resolved", () => {
  assert.equal(canTransition("open", "communicated"), true);
  assert.equal(canTransition("open", "resolved"), true);
  assert.equal(canTransition("communicated", "resolved"), true);
  assert.equal(canTransition("communicated", "open"), false);
  assert.equal(canTransition("resolved", "open"), false);
});

test("є людські підписи статусів", () => {
  assert.equal(CRITICAL_STATUS_LABELS.open, "Потребує доведення");
  assert.equal(CRITICAL_STATUS_LABELS.communicated, "Доведено");
});
