import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { mapRows, normalizeImportDate, parseCsv } from "../lib/patient-import.ts";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("parseCsv handles quotes, embedded commas and CRLF", () => {
  const rows = parseCsv('a,b,c\r\n1,"x, y",3\r\n');
  assert.deepEqual(rows, [["a", "b", "c"], ["1", "x, y", "3"]]);
});

test("parseCsv auto-detects a semicolon delimiter", () => {
  const rows = parseCsv("a;b\n1;2");
  assert.deepEqual(rows, [["a", "b"], ["1", "2"]]);
});

test("normalizeImportDate accepts ISO and DD.MM.YYYY", () => {
  assert.equal(normalizeImportDate("1990-05-21"), "1990-05-21");
  assert.equal(normalizeImportDate("21.05.1990"), "1990-05-21");
  assert.equal(normalizeImportDate("garbage"), "");
});

test("mapRows maps flexible headers, patient_id, builds ПІБ and flags bad rows", () => {
  const exactId = "a".repeat(32);
  const csv = "patient_id,Прізвище,Імʼя,Телефон,Дата народження,Email\n"
    + `${exactId},Іваненко,Іван,+380971112233,21.05.1990,a@b.co\n`
    + ",,,+380971112233,,\n" // без імені → помилка
    + ",Петренко,Петро,,1985-01-01,\n"; // без телефону → помилка
  const { records, errors } = mapRows(parseCsv(csv));
  assert.equal(records.length, 1);
  assert.equal(records[0].patientId, exactId);
  assert.equal(records[0].displayName, "Іваненко Іван");
  assert.equal(records[0].phone, "+380971112233");
  assert.equal(records[0].birthDate, "1990-05-21");
  assert.equal(errors.length, 2);
});

test("mapRows rejects a file without required columns", () => {
  const { errors } = mapRows(parseCsv("колонка1,колонка2\nx,y"));
  assert.ok(errors.some((e) => /Телефон|імен/i.test(e.error)));
});

test("import API validates each row and uses exact patient_id instead of phone upsert", async () => {
  const route = await read("app/api/staff/patients/import/route.ts");
  assert.match(route, /canManageBookings\(member\.role\)/);
  assert.match(route, /sanitizeProfile\(raw\)/);
  assert.match(route, /WHERE organization_id = \? AND patient_id = \?/);
  assert.match(route, /INSERT INTO patient_profiles/);
  assert.doesNotMatch(route, /ON CONFLICT\(organization_id, phone_normalized\)/);
  assert.match(route, /db\.batch\(/);
  assert.match(route, /MAX_ROWS/);
});

test("import page explains append-only rows without patient_id and offers an exact-id template", async () => {
  const page = await read("app/staff/patients/import/page.tsx");
  assert.match(page, /parseCsv|mapRows/);
  assert.match(page, /patient_id,Прізвище/);
  assert.match(page, /телефон не є ідентифікатором пацієнта/i);
  assert.match(page, /буде створена <b>нова<\/b> картка/);
  assert.match(page, /patients-template\.csv/);
  assert.match(page, /\/api\/staff\/patients\/import/);
  const list = await read("app/staff/patients/page.tsx");
  assert.match(list, /\/staff\/patients\/import/);
});
