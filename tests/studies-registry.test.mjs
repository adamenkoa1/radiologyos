import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

// Реєстр досліджень читає лише свій tenant і несе стан машини + переходи.
test("studies API is tenant-aware and machine-aware", async () => {
  const route = await read("app/api/staff/studies/route.ts");
  assert.match(route, /requireOrgContext\(request, db\)/);
  assert.match(route, /listOrgStudies\(db, ctx\)/);
  assert.match(route, /nextStates\(/);
  assert.match(route, /stateLabel\(/);
  // Переходи пропонуються лише тим, хто веде заявки.
  assert.match(route, /canManageBookings\(/);
  // Стан/organizationId не приймаються з клієнта тут — лише читання GET.
  assert.doesNotMatch(route, /export async function (POST|PATCH|PUT|DELETE)/);
});

// Репозиторій досліджень строго фільтрує organization_id.
test("listOrgStudies filters by organization_id", async () => {
  const repo = await read("lib/tenant-repo.ts");
  assert.match(repo, /export async function listOrgStudies/);
  assert.match(repo, /WHERE b\.organization_id = \?/);
  // JOIN зі студіями теж обмежений тим самим tenant.
  assert.match(repo, /s\.organization_id = b\.organization_id/);
});

// Сторінка реєстру: shell-секція, transition-aware керування, tenant-бейдж.
test("studies page renders a transition-aware, tenant-scoped registry", async () => {
  const page = await read("app/staff/studies/page.tsx");
  assert.match(page, /active="studies"/);
  assert.match(page, /\/api\/staff\/studies/);
  // Перехід виконується через єдиний ендпойнт бронювань (canTransition на сервері).
  assert.match(page, /\/api\/staff\/bookings/);
  assert.match(page, /s\.nextStates\.map/);
  assert.match(page, /studiesOrgBadge/);
  // Лише керівники заявок бачать керування станом.
  assert.match(page, /data\.canManage/);
});

// Робочий shell інтегрує реєстр досліджень.
test("workspace shell wires the studies registry", async () => {
  const shell = await read("app/staff/workspace-shell.tsx");
  assert.match(shell, /href:"\/staff\/studies"/);
  assert.match(shell, /"studies"/); // секція у типі WorkspaceSection
});
