// Розбір CSV зі списком пацієнтів для імпорту в CRM. Чистий модуль без
// залежностей (тестований). Нормалізацію телефону й фінальну валідацію
// робить сервер через sanitizeProfile — тут лише розбір і зіставлення колонок.
// patient_id є необов'язковим: якщо вказаний — сервер оновить саме цю картку;
// якщо порожній — буде створена нова immutable identity.

export type ImportRecord = {
  patientId: string; displayName: string; phone: string; birthDate: string;
  email: string; address: string; notes: string;
};
export type ImportParse = { records: ImportRecord[]; errors: { line: number; error: string }[] };

// Гнучке зіставлення заголовків (укр / рос / англ).
const ALIASES: Record<string, string[]> = {
  patientId: ["patient_id", "patient id", "patientid", "ід пацієнта", "id пацієнта"],
  surname: ["прізвище", "фамилия", "surname", "last name", "lastname"],
  name: ["імʼя", "ім'я", "имя", "first name", "firstname", "name"],
  patronymic: ["по батькові", "отчество", "patronymic", "middle name"],
  fullname: ["піб", "фио", "повне імʼя", "повне ім'я", "full name", "пацієнт"],
  phone: ["телефон", "phone", "номер", "мобільний", "тел", "mobile"],
  dob: ["дата народження", "дата рождения", "birth date", "birthdate", "dob", "дн", "народження"],
  email: ["email", "e-mail", "пошта", "почта", "емейл"],
  address: ["адреса", "адрес", "address"],
  notes: ["нотатки", "заметки", "примітки", "notes", "comment", "коментар"],
};

function pickDelimiter(headerLine: string): string {
  const c = (headerLine.match(/,/g) || []).length;
  const s = (headerLine.match(/;/g) || []).length;
  const t = (headerLine.match(/\t/g) || []).length;
  if (t >= c && t >= s) return "\t";
  return s > c ? ";" : ",";
}

export function parseCsv(text: string, delimiter?: string): string[][] {
  const s = String(text || "").replace(/^﻿/, "");
  const delim = delimiter || pickDelimiter((s.split(/\r?\n/)[0]) || "");
  const rows: string[][] = [];
  let row: string[] = [], field = "", inQuotes = false, i = 0;
  while (i < s.length) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i++; continue;
      }
      field += c; i++; continue;
    }
    if (c === '"') { inQuotes = true; i++; continue; }
    if (c === delim) { row.push(field); field = ""; i++; continue; }
    if (c === "\r") { i++; continue; }
    if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; i++; continue; }
    field += c; i++;
  }
  row.push(field); rows.push(row);
  return rows.filter((r) => r.some((cell) => cell.trim() !== ""));
}

function normHeader(value: string): string {
  return String(value || "").trim().toLowerCase().replace(/["']/g, "");
}
function matchColumn(header: string): string | null {
  const h = normHeader(header);
  for (const [field, names] of Object.entries(ALIASES)) {
    if (names.some((n) => h === n || h.includes(n))) return field;
  }
  return null;
}

// Дата → YYYY-MM-DD з поширених форматів (ISO, DD.MM.YYYY, DD/MM/YYYY).
export function normalizeImportDate(value: string): string {
  const v = String(value || "").trim();
  if (!v) return "";
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{1,2})[.\/](\d{1,2})[.\/](\d{4})$/.exec(v);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  return "";
}

export function mapRows(rows: string[][]): ImportParse {
  const out: ImportParse = { records: [], errors: [] };
  if (!rows.length) { out.errors.push({ line: 0, error: "Порожній файл" }); return out; }
  const header = rows[0];
  const col: Record<string, number> = {};
  header.forEach((h, idx) => { const f = matchColumn(h); if (f && col[f] === undefined) col[f] = idx; });
  const has = (f: string) => col[f] !== undefined;
  if (!has("phone")) { out.errors.push({ line: 1, error: "Не знайдено колонку «Телефон»" }); return out; }
  if (!has("fullname") && !has("surname") && !has("name")) {
    out.errors.push({ line: 1, error: "Не знайдено колонку з іменем (ПІБ або Прізвище/Імʼя)" });
    return out;
  }
  const at = (r: string[], f: string) => (col[f] !== undefined ? String(r[col[f]] || "").trim() : "");

  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const displayName = (has("fullname")
      ? at(r, "fullname")
      : [at(r, "surname"), at(r, "name"), at(r, "patronymic")].filter(Boolean).join(" ")).slice(0, 120);
    const phone = at(r, "phone");
    if (!phone) { out.errors.push({ line: i + 1, error: "Порожній телефон" }); continue; }
    if (!displayName) { out.errors.push({ line: i + 1, error: "Порожнє імʼя" }); continue; }
    out.records.push({
      patientId: at(r, "patientId").toLowerCase().slice(0, 64),
      displayName,
      phone,
      birthDate: normalizeImportDate(at(r, "dob")),
      email: at(r, "email").slice(0, 254),
      address: at(r, "address").slice(0, 200),
      notes: at(r, "notes").slice(0, 2000),
    });
  }
  return out;
}
