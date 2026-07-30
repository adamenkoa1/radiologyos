import assert from "node:assert/strict";
import test from "node:test";
import { normalizeUkrainianPhone } from "../lib/phone.ts";

// Поведінковий тест нормалізації телефону: раніше normalizeUkrainianPhone
// перевірявся лише grep-ом у маршрутах, а самі гілки (380/0/9-значний) —
// ніколи не виконувались.

test("normalises the three accepted input shapes to 380XXXXXXXXX", () => {
  assert.equal(normalizeUkrainianPhone("380972808899"), "380972808899"); // повний
  assert.equal(normalizeUkrainianPhone("0972808899"), "380972808899");   // з нуля
  assert.equal(normalizeUkrainianPhone("972808899"), "380972808899");    // 9 цифр
});

test("strips separators, spaces and the +38 prefix before matching", () => {
  assert.equal(normalizeUkrainianPhone("+38 (097) 280-88-99"), "380972808899");
  assert.equal(normalizeUkrainianPhone("097 280 88 99"), "380972808899");
  assert.equal(normalizeUkrainianPhone(" 380972808899 "), "380972808899");
});

test("rejects inputs that do not fit any Ukrainian shape", () => {
  assert.equal(normalizeUkrainianPhone(""), "");
  assert.equal(normalizeUkrainianPhone("12345"), "");        // закоротко
  assert.equal(normalizeUkrainianPhone("38097280889"), "");  // 11 цифр — жодна гілка
  assert.equal(normalizeUkrainianPhone("3809728088990"), ""); // задовго
  assert.equal(normalizeUkrainianPhone("abcdefghi"), "");    // без цифр
});
