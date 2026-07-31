import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { auditLabel } from "../lib/audit.ts";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("auditLabel maps known codes and falls back to the raw code", () => {
  assert.equal(auditLabel("login"), "Вхід у систему");
  assert.equal(auditLabel("login_failed"), "Невдала спроба входу");
  assert.equal(auditLabel("schedule_update"), "Змінено графік і слоти");
  assert.equal(auditLabel("unknown_code_xyz"), "unknown_code_xyz");
});

test("audit() swallows write errors so it never breaks the main action", async () => {
  const { audit } = await import("../lib/audit.ts");
  const throwingDb = { prepare() { throw new Error("no such table: security_audit_log"); } };
  // Не повинно кинути — навіть якщо БД падає.
  await audit(throwingDb, { organizationId: 1, actorEmail: "a@b.c", action: "login", resource: "auth" });
});

test("logSecurityEvent writes org-scoped rows with all columns", async () => {
  const { logSecurityEvent } = await import("../lib/audit.ts");
  let bound = null;
  const db = { prepare(sql) { return { bind(...args) { bound = { sql, args }; return { async run() {} }; } }; } };
  await logSecurityEvent(db, { organizationId: 7, actorEmail: "x@y.z", action: "logout", resource: "auth", targetId: 42, details: { a: 1 } });
  assert.match(bound.sql, /INSERT INTO security_audit_log/);
  assert.match(bound.sql, /organization_id/);
  assert.equal(bound.args[0], 7);            // organization_id
  assert.equal(bound.args[1], "x@y.z");      // actor_email
  assert.equal(bound.args[2], "logout");     // action
  assert.equal(bound.args[4], "42");         // target_id → string
});

test("migration 0023 creates the security_audit_log table and index", async () => {
  const sql = await read("drizzle/0023_security_audit_log.sql");
  assert.match(sql, /CREATE TABLE IF NOT EXISTS `security_audit_log`/);
  assert.match(sql, /`organization_id` integer NOT NULL DEFAULT 1/);
  assert.match(sql, /CREATE INDEX IF NOT EXISTS `security_audit_created_idx`/);
});

test("audit API is admin-only and org-scoped", async () => {
  const route = await read("app/api/staff/audit/route.ts");
  assert.match(route, /requireOrgContext/);
  assert.match(route, /ctx\.role !== "admin"/);
  assert.match(route, /listAuditEvents\(db, ctx\.organizationId/);
});

test("sensitive actions are wired to the audit log", async () => {
  const login = await read("app/api/staff/login/route.ts");
  assert.match(login, /action: "login_failed"/);
  assert.match(login, /action: "login"/);
  const logout = await read("app/api/staff/logout/route.ts");
  assert.match(logout, /action: "logout"/);
  const schedule = await read("app/api/staff/schedule/route.ts");
  assert.match(schedule, /action: "schedule_update"/);
  const settings = await read("app/api/staff/settings/route.ts");
  assert.match(settings, /action: "settings_update"/);
  const org = await read("app/api/staff/org-profile/route.ts");
  assert.match(org, /action: "org_profile_update"/);
  const members = await read("app/api/staff/members/route.ts");
  assert.match(members, /action: existing \? "member_role" : "member_add"/);
});

test("audit page and nav are wired", async () => {
  const page = await read("app/staff/audit/page.tsx");
  assert.match(page, /active="audit"/);
  assert.match(page, /\/api\/staff\/audit/);
  const shell = await read("app/staff/workspace-shell.tsx");
  assert.match(shell, /href:"\/staff\/audit"/);
});
