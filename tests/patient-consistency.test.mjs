// Чиста логіка виявлення суперечностей між джерелами даних пацієнта.

import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeName, namesDiverge,
  staleContactFindings, duplicatePhoneFindings, linkableBookingFindings, nameDivergenceFindings,
  sortFindings, countFindings,
} from "../lib/patient-consistency.ts";

test("normalizeName strips punctuation/case and collapses spaces", () => {
  assert.equal(normalizeName("  Іваненко  Іван "), "іваненко іван");
  assert.equal(normalizeName("Петренко-Сидоренко, О.В."), "петренко сидоренко о в");
});

test("namesDiverge ignores word order and punctuation, flags real differences", () => {
  assert.equal(namesDiverge("Іваненко Іван", "Іван Іваненко"), false); // порядок
  assert.equal(namesDiverge("Іваненко І.", "іваненко і"), false); // пунктуація/регістр
  assert.equal(namesDiverge("Іваненко Іван", "Петренко Іван"), true);
  assert.equal(namesDiverge("Іваненко Іван", ""), false); // нема що звіряти
  assert.equal(namesDiverge("Іваненко Іван", "Іваненко Іван Петрович"), true); // зайвий токен
});

test("staleContactFindings marks a booking whose phone differs from the linked card (high)", () => {
  const out = staleContactFindings([{
    bookingId: 5, code: "RD-1", bookingName: "Іван", bookingPhone: "380501112233",
    patientId: "a".repeat(32), displayName: "Іваненко Іван", profilePhone: "380509998877",
  }]);
  assert.equal(out.length, 1);
  assert.equal(out[0].kind, "stale_contact");
  assert.equal(out[0].severity, "high");
  assert.equal(out[0].bookingId, 5);
  assert.match(out[0].detail, /380501112233/);
  assert.match(out[0].detail, /380509998877/);
});

test("duplicatePhoneFindings marks a phone shared by several cards (medium)", () => {
  const out = duplicatePhoneFindings([{ phoneNormalized: "380501112233", count: 2, names: "Іван | Петро" }]);
  assert.equal(out[0].kind, "duplicate_phone");
  assert.equal(out[0].severity, "medium");
  assert.equal(out[0].patientId, "");
  assert.match(out[0].title, /2 карток/);
});

test("linkableBookingFindings suggests linking an unlinked booking (low)", () => {
  const out = linkableBookingFindings([{
    bookingId: 9, code: "RD-2", bookingName: "Петро", phoneNormalized: "380501112233",
    patientId: "b".repeat(32), displayName: "Петренко Петро",
  }]);
  assert.equal(out[0].kind, "linkable_booking");
  assert.equal(out[0].severity, "low");
  assert.equal(out[0].patientId, "b".repeat(32));
});

test("nameDivergenceFindings only fires when normalized names actually differ", () => {
  const rows = [
    { bookingId: 1, code: "RD-3", bookingName: "Іван Іваненко", patientId: "c".repeat(32), displayName: "Іваненко Іван", phoneNormalized: "380501112233" }, // порядок — не розбіжність
    { bookingId: 2, code: "RD-4", bookingName: "Петро Петренко", patientId: "d".repeat(32), displayName: "Сидоренко Петро", phoneNormalized: "380502223344" }, // прізвище інше
  ];
  const out = nameDivergenceFindings(rows);
  assert.equal(out.length, 1);
  assert.equal(out[0].bookingId, 2);
  assert.equal(out[0].severity, "medium");
});

test("sortFindings orders high → medium → low; countFindings tallies", () => {
  const mixed = [
    ...linkableBookingFindings([{ bookingId: 1, code: "L", bookingName: "", phoneNormalized: "1", patientId: "x", displayName: "X" }]),
    ...staleContactFindings([{ bookingId: 2, code: "S", bookingName: "", bookingPhone: "1", patientId: "y", displayName: "Y", profilePhone: "2" }]),
    ...duplicatePhoneFindings([{ phoneNormalized: "3", count: 2, names: "A | B" }]),
  ];
  const sorted = sortFindings(mixed);
  assert.deepEqual(sorted.map((f) => f.severity), ["high", "medium", "low"]);
  assert.deepEqual(countFindings(mixed), { high: 1, medium: 1, low: 1, total: 3 });
});
