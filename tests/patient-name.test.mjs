// Валідація ПІБ для публічного онлайн-запису: пропускає справжні імена,
// відсікає сміття («выв …»), цифри/символи й неповні ПІБ.

import assert from "node:assert/strict";
import test from "node:test";
import { isPlausibleFullName } from "../lib/patient-name.ts";

test("справжні українські ПІБ проходять", () => {
  assert.equal(isPlausibleFullName("Петренко Петро Петрович"), true);
  assert.equal(isPlausibleFullName("Дем'яненко Олексій Олексійович"), true);
  assert.equal(isPlausibleFullName("Ковтун-Іваненко Марія Богданівна"), true);
  assert.equal(isPlausibleFullName("  Шевченко   Тарас   Григорович  "), true);
});

test("латиниця (іноземні імена) теж проходить", () => {
  assert.equal(isPlausibleFullName("John Michael Smith"), true);
});

test("сміття з набору клавіш відхиляється", () => {
  assert.equal(isPlausibleFullName("выв Володимир Павлівна"), false); // «ы» — не українська
  assert.equal(isPlausibleFullName("ыва фыв цук"), false);
});

test("цифри, символи й односимвольні токени відхиляються", () => {
  assert.equal(isPlausibleFullName("Петренко Петро 123"), false);
  assert.equal(isPlausibleFullName("Петренко П. Петрович"), false); // «П» < 2 символів
  assert.equal(isPlausibleFullName("<script> alert хтось"), false);
});

test("неповне ПІБ (менше 3 токенів) відхиляється", () => {
  assert.equal(isPlausibleFullName("Петренко Петро"), false);
  assert.equal(isPlausibleFullName("Петренко"), false);
  assert.equal(isPlausibleFullName(""), false);
  assert.equal(isPlausibleFullName(null), false);
});
