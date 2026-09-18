import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const page = fs.readFileSync("app/staff/personnel/radiation-review-queue/page.tsx", "utf8");
const complianceRoute = fs.readFileSync("app/api/staff/personnel/radiation-compliance/route.ts", "utf8");
const directories = fs.readFileSync("app/staff/directories/page.tsx", "utf8");

test("radiation review queue reuses the canonical compliance projection", () => {
  assert.match(page, /\/api\/staff\/personnel\/radiation-compliance\?asOf=/);
  assert.match(page, /record\.summaryState === "review"/);
  assert.match(page, /scopeReviewReasons/);
  assert.match(page, /baseReviewReasons/);
  assert.match(page, /policyReviewReasons/);
  assert.match(page, /reviewReasons/);
  assert.doesNotMatch(page, /\/api\/staff\/personnel\/radiation-review-queue/);
  assert.doesNotMatch(page, /method:\s*["'](?:POST|PUT|PATCH|DELETE)["']/);
});

test("queue exposes reason filters without turning neutral scope into an alert", () => {
  assert.match(page, /type QueueFilter = "all" \| "scope" \| "base" \| "policy"/);
  assert.match(page, /filter === "scope"/);
  assert.match(page, /filter === "base"/);
  assert.match(page, /filter === "policy"/);
  assert.match(page, /`out_of_scope` сюди не потрапляє автоматично/);
  assert.match(page, /Це не alert, не юридичний висновок і не operational gate/);
  assert.match(page, /не застосовує дозові пороги/);
  assert.doesNotMatch(page, /закрити review|підтвердити порушення|заблокувати роботу/i);
});

test("canonical compliance endpoint remains manager-only and read-only", () => {
  assert.match(complianceRoute, /role === "admin" \|\| role === "department_head"/);
  assert.match(complianceRoute, /personnel_radiation_compliance_viewed/);
  assert.match(complianceRoute, /summaryState = monitoringScopeState === "out_of_scope"/);
  assert.match(complianceRoute, /scopeReviewReasons/);
  assert.match(complianceRoute, /policyReviewReasons/);
  assert.doesNotMatch(complianceRoute, /export async function (POST|PUT|PATCH|DELETE)/);
  assert.doesNotMatch(complianceRoute, /pacs_settings|imaging_studies|bookings/);
});

test("review queue is discoverable from staff directories", () => {
  assert.match(directories, /Черга review ДІВ/);
  assert.match(directories, /\/staff\/personnel\/radiation-review-queue/);
  assert.match(directories, /без alerts, дозових порогів або operational enforcement/);
});
