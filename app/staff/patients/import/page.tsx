"use client";

import { useState } from "react";
import StaffWorkspaceShell from "../../workspace-shell";
import { mapRows, parseCsv, type ImportRecord } from "../../../../lib/patient-import";

const TEMPLATE = "Прізвище,Імʼя,По батькові,Телефон,Дата народження,Email,Адреса,Нотатки\n"
  + "Іваненко,Іван,Іванович,+380 97 000 00 00,1990-05-21,ivan@example.com,\"м. Чернігів, вул. Миру 1\",Алергія на йод\n";

export default function PatientsImportPage() {
  const [fileName, setFileName] = useState("");
  const [records, setRecords] = useState<ImportRecord[]>([]);
  const [parseErrors, setParseErrors] = useState<{ line: number; error: string }[]>([]);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<{ imported: number; skipped: number; errors: { row: number; error: string }[] } | null>(null);
  const [error, setError] = useState("");

  async function onFile(file: File | null) {
    setResult(null); setError(""); setRecords([]); setParseErrors([]);
    if (!file) return;
    setFileName(file.name);
    try {
      const text = await file.text();
      const parsed = mapRows(parseCsv(text));
      setRecords(parsed.records);
      setParseErrors(parsed.errors);
    } catch {
      setError("Не вдалося прочитати файл. Переконайтеся, що це CSV.");
    }
  }

  async function runImport() {
    if (!records.length) return;
    setImporting(true); setError(""); setResult(null);
    try {
      const res = await fetch("/api/staff/patients/import", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ records }),
      });
      const data = await res.json().catch(() => ({})) as { ok?: boolean; imported?: number; skipped?: number; errors?: { row: number; error: string }[]; error?: string };
      if (!res.ok || !data.ok) throw new Error(data.error || "Не вдалося імпортувати");
      setResult({ imported: data.imported || 0, skipped: data.skipped || 0, errors: data.errors || [] });
      setRecords([]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не вдалося імпортувати");
    } finally {
      setImporting(false);
    }
  }

  const templateHref = "data:text/csv;charset=utf-8,%EF%BB%BF" + encodeURIComponent(TEMPLATE);

  return (
    <StaffWorkspaceShell active="patients" title="Імпорт пацієнтів" description="Завантаження списку пацієнтів із CSV.">
      <div className="settingsCard">
        <section className="settingsBlock">
          <h3>Формат файлу</h3>
          <p className="settingsHint">Завантажте <b>CSV</b>. Excel: «Файл → Зберегти як → CSV (розділювач — кома)». Перший рядок — заголовки (у будь-якому порядку). Обовʼязкові: <b>Прізвище/Імʼя</b> (або ПІБ) і <b>Телефон</b>. Дата народження: <code>РРРР-ММ-ДД</code> або <code>ДД.ММ.РРРР</code>.</p>
          <a className="button secondary" href={templateHref} download="patients-template.csv">↧ Завантажити шаблон CSV</a>
        </section>

        <section className="settingsBlock">
          <h3>Файл</h3>
          <label className="settingsField"><span>CSV-файл</span><input type="file" accept=".csv,text/csv" onChange={e => void onFile(e.target.files?.[0] || null)} /></label>
          {fileName && <p className="settingsHint">{fileName}: розпізнано <b>{records.length}</b> записів{parseErrors.length ? `, пропущено ${parseErrors.length}` : ""}.</p>}
          {parseErrors.length > 0 && <ul className="importErrors">{parseErrors.slice(0, 10).map((e, i) => <li key={i}>Рядок {e.line}: {e.error}</li>)}</ul>}
        </section>

        {error && <p className="notice error" role="alert">{error}</p>}
        {result && <p className="notice success" role="status">Імпортовано: <b>{result.imported}</b>{result.skipped ? `, пропущено: ${result.skipped}` : ""}. <a className="textLink" href="/staff/patients">До пацієнтів →</a></p>}
        {result && result.errors.length > 0 && <ul className="importErrors">{result.errors.slice(0, 10).map((e, i) => <li key={i}>Рядок {e.row}: {e.error}</li>)}</ul>}

        <div className="settingsActions">
          <button type="button" onClick={() => void runImport()} disabled={importing || !records.length}>{importing ? "Імпортуємо…" : `Імпортувати ${records.length || ""}`.trim()}</button>
          <a className="textLink" href="/staff/patients">Скасувати</a>
        </div>
      </div>
    </StaffWorkspaceShell>
  );
}
