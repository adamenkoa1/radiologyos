import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("staff booking surfaces never bypass patient contact controls with direct wa.me links", async () => {
  const staffRoot = new URL("../app/staff/", import.meta.url);
  const entries = await readdir(staffRoot, { recursive:true });
  for (const entry of entries) {
    if (!/\.(?:tsx?|jsx?)$/.test(entry)) continue;
    const source = await readFile(new URL(entry, staffRoot), "utf8");
    assert.doesNotMatch(source, /https:\/\/wa\.me\//, `direct WhatsApp link in app/staff/${entry}`);
  }
});

test("dashboard patient message actions open the controlled booking drawer", async () => {
  const dashboard = await read("app/staff/dashboard/page.tsx");
  assert.doesNotMatch(dashboard, /const waLink/);
  assert.doesNotMatch(dashboard, /href=\{waLink/);
  const safeButtons = dashboard.match(/onClick=\{\(\)=>setOpenId\((?:b|item)\.id\)\}>Повідомити<\/button>/g) || [];
  assert.equal(safeButtons.length, 3, "pending, needs-call and undelivered actions must use the safe drawer");

  const drawer = await read("app/staff/booking-drawer.tsx");
  assert.match(drawer, /fetch\("\/api\/staff\/notify"/);
  assert.match(drawer, /bookingId: b\.id/);
});

test("intake has no direct patient messaging URL", async () => {
  const intake = await read("app/staff/intake/page.tsx");
  assert.doesNotMatch(intake, /wa\.me/);
  assert.doesNotMatch(intake, /className="intakeWa"/);
  assert.match(intake, /\/staff\/patients\?phone=/);
});
