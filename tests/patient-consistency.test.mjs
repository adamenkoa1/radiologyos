// Чиста логіка виявлення суперечностей між джерелами даних пацієнта.

import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeName, namesDiverge, mergeSafetyFields,
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

test("duplicatePhoneFindings groups members by phone and only fires for >=2 (medium)", () => {
  const out = duplicatePhoneFindings([
    { phoneNormalized: "380501112233", patientId: "a".repeat(32), displayName: "Іван", birthDate: "1990-01-01" },
    { phoneNormalized: "380501112233", patientId: "b".repeat(32), displayName: "Петро", birthDate: "1985-02-02" },
    { phoneNormalized: "380509998877", patientId: "c".repeat(32), displayName: "Соло", birthDate: "" }, // сам-один — не знахідка
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].kind, "duplicate_phone");
  assert.equal(out[0].severity, "medium");
  assert.equal(out[0].patientId, "");
  assert.equal(out[0].members.length, 2);
  assert.match(out[0].title, /2 карток/);
});

test("mergeSafetyFields never loses a contrast/do-not-contact flag or an allergy note", () => {
  const survivor = { patientId: "a".repeat(32), contrastAlert: 0, doNotContact: 0, allergyNote: "", telegramChatId: "" };
  const absorbed = [
    { patientId: "b".repeat(32), contrastAlert: 1, doNotContact: 0, allergyNote: "Йод", telegramChatId: "999" },
    { patientId: "c".repeat(32), contrastAlert: 0, doNotContact: 1, allergyNote: "Йод", telegramChatId: "" },
  ];
  const merged = mergeSafetyFields(survivor, absorbed);
  assert.equal(merged.contrastAlert, 1);   // з поглинутої
  assert.equal(merged.doNotContact, 1);    // з поглинутої
  assert.equal(merged.allergyNote, "Йод"); // дедуп однакових нотаток
  assert.equal(merged.telegramChatId, "999"); // головна порожня → беремо з поглинутої

  const two = mergeSafetyFields(
    { patientId: "a".repeat(32), contrastAlert: 0, doNotContact: 0, allergyNote: "Латекс", telegramChatId: "111" },
    [{ patientId: "b".repeat(32), contrastAlert: 0, doNotContact: 0, allergyNote: "Йод", telegramChatId: "222" }],
  );
  assert.equal(two.allergyNote, "Латекс / Йод"); // різні — обидві збережено
  assert.equal(two.telegramChatId, "111");       // головна має свій — лишаємо
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
    ...duplicatePhoneFindings([
      { phoneNormalized: "3", patientId: "a".repeat(32), displayName: "A", birthDate: "" },
      { phoneNormalized: "3", patientId: "b".repeat(32), displayName: "B", birthDate: "" },
    ]),
  ];
  const sorted = sortFindings(mixed);
  assert.deepEqual(sorted.map((f) => f.severity), ["high", "medium", "low"]);
  assert.deepEqual(countFindings(mixed), { high: 1, medium: 1, low: 1, total: 3 });
});
