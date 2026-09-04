"use client";

// Command palette (⌘K / Ctrl+K): global role-aware search plus fast navigation.

import { useEffect, useRef, useState } from "react";

type SearchResult = {
  key: string;
  type: "booking" | "imaging" | "protocol" | "equipment" | "maintenance";
  title: string;
  subtitle: string;
  href: string;
};

// Full navigation surface: every top-level staff section is reachable from the
// palette, so search is a complete jump-to mechanism rather than a partial list.
// (Server-side guards still enforce access — this list is discovery only.)
const COMMANDS: { label: string; hint: string; href: string }[] = [
  // Щоденна робота
  { label: "Пульт відділення", hint: "огляд дня", href: "/staff/dashboard" },
  { label: "Прийом", hint: "черга заявок", href: "/staff/intake" },
  { label: "Календар записів", hint: "розклад", href: "/staff/appointments" },
  { label: "Нова заявка", hint: "записати пацієнта", href: "/staff/book" },
  { label: "Дошка досліджень", hint: "робочий стан", href: "/staff/board" },
  { label: "Завдання", hint: "нагадування / to-do", href: "/staff/tasks" },
  { label: "Протоколи", hint: "опис досліджень", href: "/staff/protocols" },
  { label: "Видача результатів", hint: "готові дослідження", href: "/staff/studies" },
  // Пацієнти
  { label: "Пацієнти", hint: "картки / CRM", href: "/staff/patients" },
  { label: "Імпорт пацієнтів", hint: "CSV / масове завантаження", href: "/staff/patients/import" },
  { label: "Чат із пацієнтами", hint: "повідомлення", href: "/staff/chat" },
  // Медицина
  { label: "DICOM / PACS", hint: "знімки та архів", href: "/staff/imaging" },
  { label: "Стан PACS / MWL", hint: "інтеграції", href: "/staff/integrations/health" },
  { label: "Modality Worklist", hint: "MWL / робочий список", href: "/staff/integrations/mwl" },
  // Послуги і тарифи
  { label: "Послуги кабінетів", hint: "перелік послуг", href: "/staff/services" },
  { label: "Надані послуги", hint: "service-delivery", href: "/staff/finance/services" },
  { label: "Тарифи", hint: "ціни / прейскурант", href: "/staff/tariffs" },
  // Фінанси
  { label: "Фінансові документи", hint: "оплати / повернення / взаєморозрахунки", href: "/staff/finance" },
  { label: "Каси і рахунки", hint: "готівка / банк", href: "/staff/cash-accounts" },
  { label: "Дебіторська заборгованість", hint: "борги пацієнтів", href: "/staff/reports/receivables" },
  // Документи / регістри / звіти
  { label: "Журнал документів", hint: "BAS-реєстратори", href: "/staff/documents" },
  { label: "Регістри", hint: "карта регістрів", href: "/staff/registers" },
  { label: "Обороти регістрів", hint: "оборотно-сальдовий", href: "/staff/reports/registers" },
  { label: "Звіти відділення", hint: "аналітика", href: "/staff/reports" },
  { label: "Маржинальність послуг", hint: "план / факт матеріалів", href: "/staff/reports/material-margin" },
  { label: "Контроль матеріалів", hint: "план / факт списання", href: "/staff/reports/material-consumption-control" },
  // Склад
  { label: "Склад", hint: "залишки / витратні матеріали", href: "/staff/inventory" },
  { label: "Переміщення запасів", hint: "між складами", href: "/staff/inventory/transfers" },
  { label: "Інвентаризація", hint: "фактичні залишки", href: "/staff/inventory/counts" },
  { label: "Фактичне списання", hint: "резервації / партії", href: "/staff/inventory/material-consumption" },
  { label: "Склади", hint: "warehouses", href: "/staff/warehouses" },
  // Закупівлі
  { label: "Кредиторка і оплати", hint: "борги постачальникам", href: "/staff/supplier-payables" },
  { label: "Постачальники", hint: "контрагенти", href: "/staff/counterparties" },
  // Персонал і радіаційна безпека
  { label: "Персонал і зміни", hint: "кадрові картки", href: "/staff/personnel" },
  { label: "Норм-календар роботи", hint: "виробничий календар / норма годин", href: "/staff/work-calendar" },
  { label: "Дозиметрія", hint: "дози опромінення", href: "/staff/personnel/dosimetry" },
  { label: "Радіаційний допуск", hint: "clearance", href: "/staff/personnel/radiation-clearance" },
  { label: "Навчання з радіобезпеки", hint: "training", href: "/staff/personnel/radiation-training" },
  { label: "Черга радіаційного огляду", hint: "review queue", href: "/staff/personnel/radiation-review-queue" },
  { label: "Зведення доз", hint: "dose summary", href: "/staff/personnel/radiation-dose-summary" },
  { label: "ВЛК", hint: "військово-лікарська комісія", href: "/staff/personnel/vlk" },
  // Довідники / обладнання / графіки
  { label: "Довідники", hint: "master-data", href: "/staff/directories" },
  { label: "Обладнання", hint: "апарати / кабінети", href: "/staff/equipment" },
  { label: "ТО та несправності", hint: "обладнання / сервіс", href: "/staff/maintenance" },
  { label: "Графік кабінетів", hint: "робочі години", href: "/staff/schedule" },
  { label: "Графік змін персоналу", hint: "зміни / бригади", href: "/staff/shifts" },
  { label: "Структура відділення", hint: "підрозділи", href: "/staff/structure" },
  { label: "Довільні поля", hint: "custom fields", href: "/staff/custom-fields" },
  // Адміністрування
  { label: "Налаштування", hint: "шлюзи / LiqPay / e-mail", href: "/staff/settings" },
  { label: "Організація та профіль", hint: "реквізити", href: "/staff/organization" },
  { label: "Журнал дій", hint: "аудит", href: "/staff/audit" },
  { label: "WhatsApp і чат-бот", hint: "інтеграція", href: "/staff/whatsapp" },
  { label: "Стан системи", hint: "health / production", href: "/staff/system/health" },
  { label: "Особистий кабінет", hint: "профіль / вихід", href: "/staff/profile" },
];

const TYPE_LABEL:Record<SearchResult["type"],string> = {
  booking:"Пацієнт / заявка",
  imaging:"DICOM",
  protocol:"Протокол",
  equipment:"Обладнання",
  maintenance:"ТО / сервіс",
};

export default function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K")) {
        e.preventDefault(); setOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    const t = window.setTimeout(() => {
      if (open) { setActive(0); inputRef.current?.focus(); }
      else { setQ(""); setResults([]); }
    }, 20);
    return () => window.clearTimeout(t);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    if (q.trim().length < 2) {
      const t0 = window.setTimeout(() => setResults([]), 0);
      return () => window.clearTimeout(t0);
    }
    const ctrl = new AbortController();
    const t = window.setTimeout(() => {
      fetch(`/api/staff/search?q=${encodeURIComponent(q.trim())}`, { signal: ctrl.signal, cache: "no-store" })
        .then((r) => (r.ok ? r.json() : { results: [] }))
        .then((d) => setResults(Array.isArray(d.results) ? d.results : []))
        .catch(() => {});
    }, 180);
    return () => { ctrl.abort(); window.clearTimeout(t); };
  }, [q, open]);

  const cmds = COMMANDS.filter((c) => !q.trim() || `${c.label} ${c.hint}`.toLowerCase().includes(q.trim().toLowerCase()));
  const items: { key: string; go: () => void; render: () => React.ReactNode }[] = [
    ...cmds.map((c) => ({
      key: `cmd-${c.href}`,
      go: () => window.location.assign(c.href),
      render: () => <><span className="cmdkIcon">→</span><span className="cmdkMain">{c.label}</span><span className="cmdkHint">{c.hint}</span></>,
    })),
    ...results.map((r) => ({
      key: r.key,
      go: () => window.location.assign(r.href),
      render: () => <><span className={`cmdkType cmdkType-${r.type}`}>{TYPE_LABEL[r.type]}</span><span className="cmdkMain">{r.title}</span><span className="cmdkHint">{r.subtitle}</span></>,
    })),
  ];

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") { setOpen(false); return; }
    if (!items.length) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => (a + 1) % items.length); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => (a - 1 + items.length) % items.length); }
    else if (e.key === "Enter") { e.preventDefault(); items[Math.min(active, items.length - 1)]?.go(); }
  }

  if (!open) return null;
  return (
    <div className="cmdkOverlay" onClick={() => setOpen(false)} role="dialog" aria-modal="true" aria-label="Командна палітра">
      <div className="cmdkBox" onClick={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          className="cmdkInput"
          value={q}
          onChange={(e) => { setQ(e.target.value); setActive(0); }}
          onKeyDown={onKeyDown}
          placeholder="ПІБ, телефон, RD, accession, протокол, обладнання…"
          aria-label="Глобальний пошук"
        />
        <ul className="cmdkList">
          {items.length === 0
            ? <li className="cmdkEmpty">{q.trim().length < 2 ? "Почніть вводити…" : "Нічого не знайдено"}</li>
            : items.map((it, i) => (
              <li key={it.key} className={`cmdkItem${i === active ? " on" : ""}`} onMouseEnter={() => setActive(i)} onMouseDown={(e) => { e.preventDefault(); it.go(); }}>
                {it.render()}
              </li>
            ))}
        </ul>
        <div className="cmdkFoot"><kbd>↑↓</kbd> вибір · <kbd>↵</kbd> відкрити · <kbd>Esc</kbd> закрити · <kbd>⌘K</kbd> виклик</div>
      </div>
    </div>
  );
}
