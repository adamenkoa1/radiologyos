"use client";

// Прототип оформлення внутрішніх журналів у стилі Google Sheets / Excel.
// ІЗОЛЬОВАНО: сторінка-макет для узгодження вигляду. Дані УМОВНІ (не реальні
// пацієнти), жоден API не викликається, стилі інлайнові й не чіпають глобальний
// CSS. Мета — затвердити табличний скін перед розкочуванням на спільний
// DataTable/JournalForm. Внутрішня сторінка /staff/** уже має noindex,nofollow
// через app/staff/layout.tsx.

import { useMemo, useState } from "react";
import StaffWorkspaceShell from "../workspace-shell";

type Status = "done" | "in" | "wait" | "cancel";
type Paid = "paid" | "part" | "unpaid";
type Row = { time: string; patient: string; service: string; room: string; status: Status; amount: number; paid: Paid };

// Умовні рядки. Прізвища вигадані; модальності — лише з погодженого переліку
// (КТ, рентгенографія, флюорографія, пантомографія, УЗД).
const ROWS: Row[] = [
  { time: "08:15", patient: "Іваненко О. П.", service: "Флюорографія ОГК", room: "Флюоро", status: "done", amount: 0, paid: "paid" },
  { time: "08:40", patient: "Коваль С. М.", service: "Рентгенографія кисті", room: "Рентген", status: "done", amount: 320, paid: "paid" },
  { time: "09:00", patient: "Бондаренко Т. І.", service: "КТ ОГК без контрасту", room: "КТ", status: "in", amount: 1450, paid: "part" },
  { time: "09:30", patient: "Ткаченко В. Р.", service: "УЗД органів черевної порожнини", room: "УЗД", status: "wait", amount: 600, paid: "unpaid" },
  { time: "09:55", patient: "Мороз А. Д.", service: "Пантомографія", room: "Пантомо", status: "wait", amount: 480, paid: "unpaid" },
  { time: "10:20", patient: "Савчук Л. Г.", service: "Рентгенографія ОГК", room: "Рентген", status: "done", amount: 340, paid: "paid" },
  { time: "10:45", patient: "Гончар Д. В.", service: "КТ головного мозку", room: "КТ", status: "in", amount: 1700, paid: "part" },
  { time: "11:10", patient: "Левченко Н. О.", service: "УЗД щитоподібної залози", room: "УЗД", status: "wait", amount: 520, paid: "unpaid" },
  { time: "11:35", patient: "Кравець І. С.", service: "Флюорографія ОГК (ВЛК)", room: "Флюоро", status: "done", amount: 0, paid: "paid" },
  { time: "12:00", patient: "Поліщук М. А.", service: "Рентгенографія стопи (навантаж.)", room: "Рентген", status: "cancel", amount: 380, paid: "unpaid" },
  { time: "13:15", patient: "Шевченко О. Ю.", service: "КТ ОГК з контрастуванням", room: "КТ", status: "wait", amount: 2100, paid: "unpaid" },
  { time: "13:40", patient: "Мельник Р. П.", service: "УЗД суглобів", room: "УЗД", status: "done", amount: 540, paid: "paid" },
  { time: "14:05", patient: "Клименко В. І.", service: "Пантомографія", room: "Пантомо", status: "in", amount: 480, paid: "part" },
  { time: "14:30", patient: "Романюк С. Д.", service: "Рентгенографія ОГК", room: "Рентген", status: "wait", amount: 340, paid: "unpaid" },
];

const STATUS_LABEL: Record<Status, string> = { done: "Виконано", in: "У кабінеті", wait: "Очікує", cancel: "Скасовано" };
const PAID_LABEL: Record<Paid, string> = { paid: "Оплачено", part: "Частково", unpaid: "Не сплачено" };

type ColKey = "time" | "patient" | "service" | "room" | "status" | "amount" | "paid";
type Col = { key: ColKey; label: string; num?: boolean };
const COLS: Col[] = [
  { key: "time", label: "Час" },
  { key: "patient", label: "Пацієнт" },
  { key: "service", label: "Дослідження" },
  { key: "room", label: "Кабінет" },
  { key: "status", label: "Статус" },
  { key: "amount", label: "Сума, ₴", num: true },
  { key: "paid", label: "Оплата" },
];

function colLetter(i: number) { return String.fromCharCode(65 + i); }
function money(n: number) { return n.toLocaleString("uk-UA"); }

export default function SheetPreviewPage() {
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<ColKey | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [selected, setSelected] = useState<number | null>(null);
  const [dense, setDense] = useState(true);
  const [letters, setLetters] = useState(true);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = ROWS.filter(r => !q || [r.time, r.patient, r.service, r.room, STATUS_LABEL[r.status], PAID_LABEL[r.paid]].join(" ").toLowerCase().includes(q));
    if (sortKey) {
      const dir = sortDir === "asc" ? 1 : -1;
      list = [...list].sort((a, b) => {
        const av = a[sortKey]; const bv = b[sortKey];
        if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
        return String(av).localeCompare(String(bv), "uk") * dir;
      });
    }
    return list;
  }, [query, sortKey, sortDir]);

  const total = rows.reduce((sum, r) => sum + r.amount, 0);

  function onSort(key: ColKey) {
    if (sortKey === key) { setSortDir(d => (d === "asc" ? "desc" : "asc")); return; }
    setSortKey(key); setSortDir("asc");
  }

  function exportCsv() {
    const header = COLS.map(c => c.label).join(";");
    const lines = rows.map(r => [r.time, r.patient, r.service, r.room, STATUS_LABEL[r.status], r.amount, PAID_LABEL[r.paid]].join(";"));
    const csv = [header, ...lines].join("\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "journal-preview.csv"; a.click();
    URL.revokeObjectURL(url);
  }

  const body = (
    <div className={`sx-wrap${dense ? " sx-dense" : " sx-comfy"}${letters ? " sx-lon" : ""}`}>
      <p className="sx-note" role="status">
        <b>Прототип оформлення.</b> Дані умовні (не реальні пацієнти). Ціль — узгодити табличний вигляд у стилі
        Google&nbsp;Sheets&nbsp;/&nbsp;Excel перед розкочуванням на журнали. Клік по рядку — виділення; клік по заголовку — сортування.
      </p>

      <div className="sx-toolbar">
        <input className="sx-search" type="search" placeholder="Пошук у таблиці…" value={query} onChange={e => setQuery(e.target.value)} aria-label="Пошук у таблиці" />
        <div className="sx-tgroup" role="group" aria-label="Щільність рядків">
          <button type="button" className={dense ? "on" : ""} onClick={() => setDense(true)}>Компактно</button>
          <button type="button" className={!dense ? "on" : ""} onClick={() => setDense(false)}>Комфортно</button>
        </div>
        <button type="button" className={`sx-toggle${letters ? " on" : ""}`} aria-pressed={letters} onClick={() => setLetters(v => !v)}>Літери стовпців</button>
        <span className="sx-frozen">Шапка й № — заморожені</span>
        <button type="button" className="sx-export" onClick={exportCsv}>Експорт CSV</button>
      </div>

      <div className="sx-frame" tabIndex={0} aria-label="Журнал (прототип)">
        <table className="sx-table">
          <thead>
            {letters && (
              <tr className="sx-letters">
                <th className="sx-corner" aria-hidden="true" />
                {COLS.map((c, i) => <th key={c.key} className={c.num ? "sx-n" : ""}>{colLetter(i)}</th>)}
              </tr>
            )}
            <tr className="sx-head">
              <th className="sx-corner sx-num" scope="col">№</th>
              {COLS.map(c => {
                const active = sortKey === c.key;
                return (
                  <th key={c.key} className={c.num ? "sx-n" : ""} scope="col" aria-sort={active ? (sortDir === "asc" ? "ascending" : "descending") : "none"}>
                    <button type="button" onClick={() => onSort(c.key)}>
                      <span>{c.label}</span>
                      <i aria-hidden="true">{active ? (sortDir === "asc" ? "▲" : "▼") : "↕"}</i>
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, idx) => (
              <tr key={`${r.time}-${r.patient}`} className={selected === idx ? "sx-sel" : ""} onClick={() => setSelected(idx)}>
                <td className="sx-num">{idx + 1}</td>
                <td className="sx-mono">{r.time}</td>
                <td>{r.patient}</td>
                <td>{r.service}</td>
                <td>{r.room}</td>
                <td><span className={`sx-chip sx-st-${r.status}`}>{STATUS_LABEL[r.status]}</span></td>
                <td className="sx-n sx-mono">{r.amount ? money(r.amount) : "—"}</td>
                <td><span className={`sx-chip sx-pd-${r.paid}`}>{PAID_LABEL[r.paid]}</span></td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td className="sx-empty" colSpan={COLS.length + 1}>Нічого не знайдено за запитом «{query}».</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="sx-foot">
        <span>Рядків: <b>{rows.length}</b>{rows.length !== ROWS.length && <> з {ROWS.length}</>}</span>
        <span>Сума видимих: <b className="sx-mono">{money(total)}</b> ₴</span>
        <span>{selected !== null && rows[selected] ? <>Виділено: <b>{rows[selected].patient}</b></> : "Рядок не виділено"}</span>
      </div>

      <style>{SX_CSS}</style>
    </div>
  );

  return (
    <StaffWorkspaceShell active="documents" title="Прототип: журнал у стилі Sheets/Excel" description="Макет табличного оформлення для узгодження. Дані умовні, це не робоча сторінка.">
      {body}
    </StaffWorkspaceShell>
  );
}

const SX_CSS = `
.sx-wrap{--sx-line:#d6dcda;--sx-head:#f1f3f2;--sx-zebra:#f8faf9;--sx-hover:#eef6f3;--sx-sel:#e3f0fd;--sx-selb:#1a73e8;--sx-ink:#1b211e;--sx-muted:#6b7672;font-size:13px;color:var(--sx-ink)}
.sx-note{margin:0 0 12px;padding:10px 14px;border:1px solid #cfe0d9;border-left:3px solid #0d5b50;border-radius:8px;background:#f2f9f6;color:#28423c;font-size:12.5px;line-height:1.5}
.sx-toolbar{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin-bottom:10px}
.sx-search{flex:1;min-width:200px;height:34px;padding:0 12px;border:1px solid var(--sx-line);border-radius:8px;background:#fff;font:inherit}
.sx-search:focus{outline:2px solid #1a73e8;outline-offset:1px;border-color:#1a73e8}
.sx-tgroup{display:inline-flex;border:1px solid var(--sx-line);border-radius:8px;overflow:hidden}
.sx-tgroup button{border:0;background:#fff;padding:0 12px;height:34px;font:inherit;cursor:pointer;color:var(--sx-muted)}
.sx-tgroup button.on{background:#0d5b50;color:#fff;font-weight:700}
.sx-toggle,.sx-export{height:34px;padding:0 14px;border:1px solid var(--sx-line);border-radius:8px;background:#fff;font:inherit;cursor:pointer;color:var(--sx-ink)}
.sx-toggle.on{background:#e3f0fd;border-color:#1a73e8;color:#0b57d0;font-weight:700}
.sx-export{background:#0d5b50;border-color:#0d5b50;color:#fff;font-weight:700}
.sx-frozen{font-size:11px;color:var(--sx-muted);margin-left:auto}
.sx-frame{position:relative;max-height:62vh;overflow:auto;border:1px solid var(--sx-line);border-radius:10px;background:#fff}
.sx-table{border-collapse:separate;border-spacing:0;width:100%;min-width:760px}
.sx-table th,.sx-table td{border-right:1px solid var(--sx-line);border-bottom:1px solid var(--sx-line);text-align:left;white-space:nowrap;background:#fff}
.sx-dense th,.sx-dense td{padding:4px 10px}
.sx-comfy th,.sx-comfy td{padding:9px 12px}
.sx-table thead th{position:sticky;z-index:3;background:var(--sx-head);font-weight:700;color:#33403c;user-select:none}
.sx-letters th{top:0;height:22px;padding:2px 10px;font-size:11px;font-weight:600;color:#8a938f;text-align:center;background:#eaeeec;z-index:4}
.sx-lon .sx-head th{top:22px}
.sx-head th{top:0}
.sx-head th button{display:flex;align-items:center;gap:8px;width:100%;border:0;background:transparent;font:inherit;font-weight:700;color:inherit;cursor:pointer;padding:0}
.sx-head th.sx-n button{justify-content:flex-end}
.sx-head th button i{font-style:normal;font-size:10px;color:#98a29e}
.sx-head th button:focus-visible{outline:2px solid #1a73e8;outline-offset:2px;border-radius:3px}
.sx-num{position:sticky;left:0;z-index:2;width:44px;min-width:44px;text-align:center;color:#98a29e;background:var(--sx-head);font-variant-numeric:tabular-nums}
td.sx-num{background:var(--sx-head);font-size:11px}
.sx-corner{z-index:5!important}
.sx-n{text-align:right}
.sx-mono{font-variant-numeric:tabular-nums;font-feature-settings:"tnum" 1}
.sx-table tbody tr:nth-child(even) td{background:var(--sx-zebra)}
.sx-table tbody tr:nth-child(even) td.sx-num{background:#eef1f0}
.sx-table tbody tr:hover td{background:var(--sx-hover)}
.sx-table tbody tr:hover td.sx-num{background:#dcebe5}
.sx-table tbody tr.sx-sel td{background:var(--sx-sel)}
.sx-table tbody tr.sx-sel td.sx-num{background:#cfe1fa;color:#0b57d0;font-weight:700;box-shadow:inset 3px 0 0 var(--sx-selb)}
.sx-table tbody tr{cursor:pointer}
.sx-empty{text-align:center;color:var(--sx-muted);padding:26px}
.sx-chip{display:inline-block;padding:2px 9px;border-radius:20px;font-size:11px;font-weight:700;line-height:1.7}
.sx-st-done{background:#e3f3ed;color:#075246}
.sx-st-in{background:#e6effd;color:#0b57d0}
.sx-st-wait{background:#fdf3e0;color:#8a5a10}
.sx-st-cancel{background:#fdeceb;color:#a23320}
.sx-pd-paid{background:#e3f3ed;color:#075246}
.sx-pd-part{background:#fdf3e0;color:#8a5a10}
.sx-pd-unpaid{background:#f3f1ee;color:#6b7672}
.sx-foot{display:flex;flex-wrap:wrap;gap:20px;padding:9px 4px 0;font-size:12px;color:var(--sx-muted)}
.sx-foot b{color:var(--sx-ink)}
@media(max-width:600px){.sx-frozen{display:none}.sx-search{min-width:140px}}

.themeDark .sx-wrap{--sx-line:#26333a;--sx-head:#141d23;--sx-zebra:#0f171c;--sx-hover:#132630;--sx-sel:#10314f;--sx-ink:#e6edf1;--sx-muted:#93a3ad}
.themeDark .sx-note{background:#0e1a17;border-color:#1f4a40;color:#bfe3d8}
.themeDark .sx-search,.themeDark .sx-tgroup button,.themeDark .sx-toggle,.themeDark .sx-tgroup{background:#0e151a;color:#e6edf1;border-color:#26333a}
.themeDark .sx-frame{background:#0b1216;border-color:#26333a}
.themeDark .sx-table th,.themeDark .sx-table td{background:#0b1216}
.themeDark .sx-table tbody tr:nth-child(even) td{background:var(--sx-zebra)}
.themeDark .sx-letters th{background:#101a20;color:#7f8d95}
.themeDark .sx-table tbody tr.sx-sel td{background:var(--sx-sel)}
`;
