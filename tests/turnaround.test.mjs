// TAT-розрахунок: дельти в годинах, медіани, розбивка за модальністю й лікарем.
import assert from "node:assert/strict";
import test from "node:test";
import { computeTurnaround } from "../lib/turnaround.ts";

function row(over) {
  return {
    equipmentId: "ct", radiologistEmail: "doc@x", signedBy: "doc@x",
    performedAt: "", readyAt: "", signedAt: "", issuedAt: "", ...over,
  };
}

test("computeTurnaround: години, медіани, лічильники", () => {
  const rows = [
    // performed 10:00 → ready 12:00 → signed 14:00 → issued 16:00 : sign 4h, issue 6h
    row({ performedAt: "2026-09-20T10:00:00", readyAt: "2026-09-20T12:00:00", signedAt: "2026-09-20T14:00:00", issuedAt: "2026-09-20T16:00:00" }),
    // performed 08:00 → signed 10:00 (2h), issued 08:00+? none
    row({ equipmentId: "xray", performedAt: "2026-09-20 08:00:00", signedAt: "2026-09-20 10:00:00" }),
    // виконано, але не підписано
    row({ equipmentId: "xray", performedAt: "2026-09-20T09:00:00" }),
  ];
  const r = computeTurnaround(rows);
  assert.equal(r.overall.performed, 3);
  assert.equal(r.overall.signed, 2);
  assert.equal(r.overall.issued, 1);
  assert.equal(r.overall.signMedianH, 3); // медіана [4,2] = 3
  assert.equal(r.overall.issueMedianH, 6);
  // модальності: xray має 2 виконаних, ct 1 → xray перша за сортуванням
  assert.equal(r.byModality[0].equipmentId, "xray");
  assert.equal(r.byModality[0].stats.performed, 2);
  assert.equal(r.byModality[0].stats.signed, 1);
});

test("computeTurnaround: некоректні/від'ємні дати відкидаються", () => {
  const rows = [
    row({ performedAt: "2026-09-20T14:00:00", signedAt: "2026-09-20T10:00:00" }), // signed раніше performed → відкинути
    row({ performedAt: "погана-дата", signedAt: "2026-09-20T10:00:00" }),
  ];
  const r = computeTurnaround(rows);
  assert.equal(r.overall.signed, 2); // обидва мають signedAt → лічильник рахує
  assert.equal(r.overall.signMedianH, null); // але жодної валідної дельти
  assert.equal(r.byRadiologist.length, 0); // немає валідних дельт → лікарів немає
});

test("computeTurnaround: розбивка за лікарем (signedBy)", () => {
  const rows = [
    row({ signedBy: "a@x", performedAt: "2026-09-20T10:00:00", signedAt: "2026-09-20T12:00:00" }),
    row({ signedBy: "a@x", performedAt: "2026-09-20T10:00:00", signedAt: "2026-09-20T16:00:00" }),
    row({ signedBy: "b@x", performedAt: "2026-09-20T10:00:00", signedAt: "2026-09-20T13:00:00" }),
  ];
  const r = computeTurnaround(rows);
  assert.equal(r.byRadiologist[0].email, "a@x");
  assert.equal(r.byRadiologist[0].signed, 2);
  assert.equal(r.byRadiologist[0].signMedianH, 4); // медіана [2,6]
});
