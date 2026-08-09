"use client";

import { useEffect, useMemo, useState } from "react";
import StaffWorkspaceShell from "../workspace-shell";

type Status = "ok" | "warn" | "new";
type Phase = "Готово" | "Фаза 2" | "Фаза 3" | "Фаза 4";
type Prio = "none" | "hi" | "mid" | "lo";

type Item = {
  scr: string; fn: string; st: Status; ph: Phase; prcls: Prio; prlbl: string; path: string;
};
type Module = { num: string; name: string; items: Item[] };

const DATA: Module[] = [
  { num: "1", name: "Головна / Послуги", items: [
    { scr: "Публічний сайт", fn: "Інформація про відділення, послуги й запис (військовим безоплатно / цивільним платно)", st: "ok", ph: "Готово", prcls: "none", prlbl: "—", path: "/ · /staff/structure" },
    { scr: "Онлайн-запис", fn: "Кошик і заявка прямо з головної", st: "ok", ph: "Готово", prcls: "none", prlbl: "—", path: "index.html · /api/site-booking" },
    { scr: "Тарифи", fn: "Таблиці цін для військових і цивільних", st: "ok", ph: "Готово", prcls: "none", prlbl: "—", path: "index.html · /api/tariffs" },
    { scr: "Контакти", fn: "Телефон, карта проїзду, графік", st: "ok", ph: "Готово", prcls: "none", prlbl: "—", path: "index.html" },
    { scr: "Пакети / акції", fn: "Комплекти послуг зі знижкою, промокоди", st: "new", ph: "Фаза 4", prcls: "lo", prlbl: "Низький", path: "новий модуль" },
    { scr: "Довіра", fn: "Відгуки, ліцензії, фото відділення", st: "new", ph: "Фаза 4", prcls: "lo", prlbl: "Низький", path: "нова секція" },
    { scr: "Зворотний дзвінок", fn: "Форма «передзвоніть мені» → заявка/CRM", st: "new", ph: "Фаза 4", prcls: "lo", prlbl: "Низький", path: "нова форма + API" },
  ] },
  { num: "2", name: "Запис і заявки", items: [
    { scr: "Форма заявки", fn: "Цивільна та військова форми", st: "ok", ph: "Готово", prcls: "none", prlbl: "—", path: "price.html · military.html" },
    { scr: "Вибір часу", fn: "Вільні слоти з реального розкладу", st: "ok", ph: "Готово", prcls: "none", prlbl: "—", path: "/api/availability" },
    { scr: "Кабінет пацієнта", fn: "Заявки, статуси, протокол, скасування, QR-оплата", st: "ok", ph: "Готово", prcls: "none", prlbl: "—", path: "cabinet.html · /api/my-bookings" },
    { scr: "Черга реєстратури", fn: "Список бронювань: підтвердження/перенесення/коментарі", st: "ok", ph: "Готово", prcls: "none", prlbl: "—", path: "/staff · /api/staff/bookings" },
    { scr: "Розклад дня", fn: "Календар записів по днях/апаратах", st: "ok", ph: "Готово", prcls: "none", prlbl: "—", path: "/staff/dashboard" },
    { scr: "Нагадування", fn: "Telegram є; додати email/SMS до візиту", st: "warn", ph: "Фаза 2", prcls: "hi", prlbl: "Високий", path: "lib/telegram.ts (+email/SMS)" },
    { scr: "Повторний запис", fn: "Автопропозиція наступного візиту / диспансеризація", st: "new", ph: "Фаза 4", prcls: "lo", prlbl: "Низький", path: "новий модуль" },
  ] },
  { num: "3", name: "CRM (пацієнти/клієнти)", items: [
    { scr: "Картка пацієнта", fn: "Візити, оплати, теги, нотатки, рік народження", st: "ok", ph: "Готово", prcls: "none", prlbl: "—", path: "/staff/patients" },
    { scr: "Комунікації", fn: "Історія дзвінків/повідомлень", st: "ok", ph: "Готово", prcls: "none", prlbl: "—", path: "/api/staff/patients (POST)" },
    { scr: "Сегменти", fn: "Групи пацієнтів для роботи", st: "ok", ph: "Готово", prcls: "none", prlbl: "—", path: "lib/patients.ts" },
    { scr: "Експорт контактів", fn: "CSV у Google Контакти", st: "ok", ph: "Готово", prcls: "none", prlbl: "—", path: "/api/staff/patients/export" },
    { scr: "Розсилки", fn: "Масові email/SMS/Telegram по сегментах", st: "new", ph: "Фаза 4", prcls: "lo", prlbl: "Низький", path: "новий модуль" },
    { scr: "Воронка лідів", fn: "Статуси звернень: новий → записаний → прийшов", st: "new", ph: "Фаза 4", prcls: "lo", prlbl: "Низький", path: "новий модуль" },
    { scr: "Лояльність", fn: "Знижки постійним, дні народження", st: "new", ph: "Фаза 4", prcls: "lo", prlbl: "Низький", path: "новий модуль" },
  ] },
  { num: "4", name: "Бухгалтерія / Фінанси", items: [
    { scr: "Оплати за заявками", fn: "Статус оплати, сума, спосіб (готівка/картка/Приват)", st: "warn", ph: "Фаза 2", prcls: "hi", prlbl: "Високий", path: "bookings.paymentStatus" },
    { scr: "Тарифи/прайс", fn: "Ціни послуг (редагування)", st: "ok", ph: "Готово", prcls: "none", prlbl: "—", path: "/staff/tariffs" },
    { scr: "Квитанції / рахунки", fn: "Генерація PDF-квитанції та рахунку пацієнту", st: "new", ph: "Фаза 2", prcls: "hi", prlbl: "Високий", path: "новий модуль" },
    { scr: "Каса та зміни", fn: "Відкриття/закриття зміни, звірка готівки", st: "new", ph: "Фаза 2", prcls: "hi", prlbl: "Високий", path: "новий модуль" },
    { scr: "Звірка з Приват24", fn: "Звіряння надходжень з виписки банку", st: "new", ph: "Фаза 2", prcls: "hi", prlbl: "Високий", path: "інтеграція / імпорт виписки" },
    { scr: "Фінансові звіти", fn: "Виручка за період, за послугами, за лікарями", st: "warn", ph: "Фаза 2", prcls: "hi", prlbl: "Високий", path: "/staff/reports (розширити)" },
    { scr: "Договори / акти", fn: "Формування договорів і актів наданих послуг", st: "new", ph: "Фаза 4", prcls: "lo", prlbl: "Низький", path: "новий модуль" },
    { scr: "Витрати", fn: "Облік витрат відділення (матеріали, ТО, ЗП)", st: "new", ph: "Фаза 4", prcls: "lo", prlbl: "Низький", path: "новий модуль" },
    { scr: "Податки / ФОП", fn: "Зведення для звітності (за потреби)", st: "new", ph: "Фаза 4", prcls: "lo", prlbl: "Низький", path: "новий модуль" },
  ] },
  { num: "5", name: "Персонал (HR)", items: [
    { scr: "Співробітники й ролі", fn: "Облік персоналу, ролі доступу", st: "ok", ph: "Готово", prcls: "none", prlbl: "—", path: "/api/staff/members" },
    { scr: "Реєстрація за кодом", fn: "Самореєстрація співробітника", st: "ok", ph: "Готово", prcls: "none", prlbl: "—", path: "/staff/register" },
    { scr: "Графік змін", fn: "Планування змін лікарів/лаборантів/реєстраторів", st: "new", ph: "Фаза 3", prcls: "mid", prlbl: "Середній", path: "новий модуль" },
    { scr: "Завантаженість", fn: "Скільки досліджень на працівника за період", st: "new", ph: "Фаза 3", prcls: "mid", prlbl: "Середній", path: "звіт/дашборд" },
    { scr: "KPI / виробіток", fn: "Показники на лікаря (протоколи, час)", st: "new", ph: "Фаза 3", prcls: "mid", prlbl: "Середній", path: "звіт" },
    { scr: "Відпустки / лікарняні", fn: "Облік відсутностей", st: "new", ph: "Фаза 4", prcls: "lo", prlbl: "Низький", path: "новий модуль" },
    { scr: "Журнал дій (аудит)", fn: "Хто що змінив у системі", st: "new", ph: "Фаза 4", prcls: "lo", prlbl: "Низький", path: "наскрізний лог" },
  ] },
  { num: "6", name: "Обладнання", items: [
    { scr: "Реєстр апаратів", fn: "КТ, рентген, флюорограф — облік", st: "ok", ph: "Готово", prcls: "none", prlbl: "—", path: "/api/staff/equipment" },
    { scr: "Завантаженість", fn: "Скільки досліджень на апарат/день", st: "warn", ph: "Фаза 2", prcls: "hi", prlbl: "Високий", path: "/staff/dashboard (розширити)" },
    { scr: "Знімки / PACS", fn: "Прив'язка знімків до дослідження", st: "ok", ph: "Готово", prcls: "none", prlbl: "—", path: "/staff/imaging" },
    { scr: "Обслуговування (ТО)", fn: "Графік ТО, історія ремонтів, нагадування", st: "new", ph: "Фаза 3", prcls: "mid", prlbl: "Середній", path: "новий модуль" },
    { scr: "Простої / поломки", fn: "Реєстрація несправностей і простоїв", st: "new", ph: "Фаза 3", prcls: "mid", prlbl: "Середній", path: "новий модуль" },
    { scr: "Витратні матеріали", fn: "Склад: плівка, контраст, залишки", st: "new", ph: "Фаза 3", prcls: "mid", prlbl: "Середній", path: "новий модуль" },
  ] },
  { num: "7", name: "Адмін / Наскрізне", items: [
    { scr: "Пульт відділення", fn: "KPI, зведення дня", st: "ok", ph: "Готово", prcls: "none", prlbl: "—", path: "/staff/dashboard" },
    { scr: "Налаштування", fn: "Telegram, оплата, нагадування, календар", st: "ok", ph: "Готово", prcls: "none", prlbl: "—", path: "/staff/settings" },
    { scr: "Ролі й права", fn: "Доступ за ролями (адмін/реєстратор/лікар/лаборант)", st: "ok", ph: "Готово", prcls: "none", prlbl: "—", path: "lib/staff-auth.ts" },
    { scr: "Календар", fn: "Google експорт/імпорт (iCal)", st: "ok", ph: "Готово", prcls: "none", prlbl: "—", path: "/api/calendar · external-calendar" },
    { scr: "Резервне копіювання", fn: "Бекап бази D1", st: "warn", ph: "Фаза 2", prcls: "hi", prlbl: "Високий", path: "Cloudflare D1" },
  ] },
];

const PH_CLASS: Record<Phase, string> = { "Готово": "ph-done", "Фаза 2": "ph-2", "Фаза 3": "ph-3", "Фаза 4": "ph-4" };

type StatusFilter = "all" | Status;
type PhaseFilter = "all" | Phase;

// Публічні сторінки → їхні реальні URL. Службові /staff… лінкуються напряму.
const PUBLIC_PAGES: Record<string, string> = {
  "index.html": "/",
  "price.html": "/site/price.html",
  "military.html": "/site/military.html",
  "cabinet.html": "/site/cabinet.html",
};

function hrefForToken(token: string): string | null {
  if (token.startsWith("/staff")) return token;
  return PUBLIC_PAGES[token] ?? null;
}

function renderPath(path: string) {
  const parts = path.split("·");
  return parts.map((part, i) => {
    const sep = i > 0 ? <span className="sysmapSep">·</span> : null;
    const trimmed = part.trim();
    const match = trimmed.match(/^(\S+)(.*)$/);
    const href = match ? hrefForToken(match[1]) : null;
    if (match && href) {
      return <span key={i}>{sep}<a className="sysmapPathLink" href={href}>{match[1]}</a>{match[2]}</span>;
    }
    return <span key={i}>{sep}{part}</span>;
  });
}

export default function SystemMapPage() {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [phaseFilter, setPhaseFilter] = useState<PhaseFilter>("all");
  const [dark, setDark] = useState(true);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  // Перехід до блоку модуля за якорем (#mod-N) із бічної панелі.
  useEffect(() => {
    function jump() {
      const hash = window.location.hash;
      if (!hash.startsWith("#mod-")) return;
      const id = hash.slice(1);
      setCollapsed((current) => ({ ...current, [id.replace("mod-", "")]: false }));
      window.setTimeout(() => {
        document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 60);
    }
    jump();
    window.addEventListener("hashchange", jump);
    return () => window.removeEventListener("hashchange", jump);
  }, []);

  const totals = useMemo(() => {
    const t = { ok: 0, warn: 0, new: 0, all: 0, ph2: 0, ph3: 0, ph4: 0 };
    for (const m of DATA) for (const it of m.items) {
      t.all++; t[it.st]++;
      if (it.ph === "Фаза 2") t.ph2++; else if (it.ph === "Фаза 3") t.ph3++; else if (it.ph === "Фаза 4") t.ph4++;
    }
    return t;
  }, []);
  const done = totals.ok;
  const trackPct = (n: number) => `${(n / totals.all) * 100}%`;

  function rowVisible(it: Item) {
    return (statusFilter === "all" || it.st === statusFilter) && (phaseFilter === "all" || it.ph === phaseFilter);
  }

  const visibleModules = DATA
    .map((m) => ({ module: m, shown: m.items.filter(rowVisible) }))
    .filter((entry) => entry.shown.length > 0);
  const anyVisible = visibleModules.length > 0;

  return <StaffWorkspaceShell
    active="system-map"
    title="Карта системи"
    description="Цільова структура платформи відділення: 7 модулів, 48 екранів — що вже працює, що доробити, що збудувати, за фазами й пріоритетами."
  >
    <div className={`sysmap${dark ? " sysmapDark" : " sysmapLight"}`}>
      <header className="sysmapHero">
        <span className="sysmapScan" aria-hidden="true" />
        <p className="sysmapEyebrow">Карта платформи · відділення променевої діагностики</p>
        <h2>RadiologyOS — цільова структура системи</h2>
        <p className="sysmapSub">Повна платформа відділення: продаж послуг, запис, CRM, бухгалтерія, персонал, обладнання. {totals.all} екранів у {DATA.length} модулях.</p>
        <div className="sysmapLegend">
          <span className="sysmapLg"><span className="sysmapDot ok" /><b>є</b> — вже працює</span>
          <span className="sysmapLg"><span className="sysmapDot warn" /><b>частково</b> — є основа, треба доробити</span>
          <span className="sysmapLg"><span className="sysmapDot new" /><b>новий</b> — запланувати й збудувати</span>
        </div>
      </header>

      <section className="sysmapSummary">
        <div className="sysmapTile ok"><div className="k">{totals.ok}</div><div className="l"><span className="sysmapDot ok" />працює</div><span className="bar" /></div>
        <div className="sysmapTile warn"><div className="k">{totals.warn}</div><div className="l"><span className="sysmapDot warn" />частково готове</div><span className="bar" /></div>
        <div className="sysmapTile new"><div className="k">{totals.new}</div><div className="l"><span className="sysmapDot new" />до побудови</div><span className="bar" /></div>
      </section>

      <section className="sysmapPhasebar">
        <div className="cap">Порядок робіт за фазами</div>
        <div className="sysmapTrack" role="img" aria-label="Розподіл екранів за фазами">
          <span className="p-done" style={{ width: trackPct(done) }} />
          <span className="p2" style={{ width: trackPct(totals.ph2) }} />
          <span className="p3" style={{ width: trackPct(totals.ph3) }} />
          <span className="p4" style={{ width: trackPct(totals.ph4) }} />
        </div>
        <div className="sysmapPlabels">
          <span><span className="sw done" />Готово <i>{done}</i></span>
          <span><span className="sw p2" />Фаза 2 · бухгалтерія + нагадування <i>{totals.ph2}</i></span>
          <span><span className="sw p3" />Фаза 3 · персонал + обладнання <i>{totals.ph3}</i></span>
          <span><span className="sw p4" />Фаза 4 · CRM-розсилки, договори, аудит <i>{totals.ph4}</i></span>
        </div>
      </section>

      <div className="sysmapControls">
        <div className="sysmapCtlGroup">
          <span className="gl">Статус</span>
          {([["all", "Усі", null], ["ok", "є", totals.ok], ["warn", "частково", totals.warn], ["new", "новий", totals.new]] as const).map(([v, label, cnt]) =>
            <button key={v} type="button" className="sysmapChip" aria-pressed={statusFilter === v} onClick={() => setStatusFilter(v as StatusFilter)}>
              {v !== "all" ? <span className={`sysmapDot ${v}`} /> : null}{label}{cnt != null ? <span className="cnt">{cnt}</span> : null}
            </button>)}
        </div>
        <div className="sysmapCtlGroup">
          <span className="gl">Фаза</span>
          {([["all", "Усі", null], ["Фаза 2", "Фаза 2", totals.ph2], ["Фаза 3", "Фаза 3", totals.ph3], ["Фаза 4", "Фаза 4", totals.ph4]] as const).map(([v, label, cnt]) =>
            <button key={v} type="button" className="sysmapChip" aria-pressed={phaseFilter === v} onClick={() => setPhaseFilter(v as PhaseFilter)}>
              {label}{cnt != null ? <span className="cnt">{cnt}</span> : null}
            </button>)}
        </div>
        <span className="sysmapSpacer" />
        <button type="button" className="sysmapThemeBtn" onClick={() => setDark((d) => !d)} aria-label="Перемкнути тему">
          <span aria-hidden="true">{dark ? "◑" : "◐"}</span> тема
        </button>
      </div>

      <div className="sysmapColhead" aria-hidden="true">
        <span /><span>Екран</span><span>Функція</span><span>Фаза</span><span>Пріоритет</span><span>Де в системі</span>
      </div>

      <div className="sysmapTree">
        {visibleModules.map(({ module: m, shown }) => {
          const counts = { ok: 0, warn: 0, new: 0 };
          for (const it of m.items) counts[it.st]++;
          const pct = Math.round((counts.ok / m.items.length) * 100);
          const isCollapsed = !!collapsed[m.num];
          return <section id={`mod-${m.num}`} className={`sysmapMod${isCollapsed ? " collapsed" : ""}`} key={m.num}>
            <button type="button" className="sysmapModhead" aria-expanded={!isCollapsed}
              onClick={() => setCollapsed((c) => ({ ...c, [m.num]: !c[m.num] }))}>
              <span className="sysmapNum">{m.num}</span>
              <span className="sysmapMname">{m.name}</span>
              <span className="sysmapMmeta">
                <span className="sysmapMinicount">
                  <b className="c-ok">{counts.ok}</b><b className="c-warn">{counts.warn}</b><b className="c-new">{counts.new}</b>
                </span>
                <span className="sysmapMeter" title={`${pct}% готово`}><i style={{ width: `${pct}%` }} /></span>
                <span className="sysmapCaret" aria-hidden="true">▼</span>
              </span>
            </button>
            <div className="sysmapRows">
              {shown.map((it, i) => <div className="sysmapRow" key={i}>
                <span className="sysmapRdot"><span className={`sysmapDot ${it.st}`} /></span>
                <span className="sysmapScr">{it.scr}</span>
                <span className="sysmapFn">{it.fn}</span>
                <span className={`sysmapTag ${PH_CLASS[it.ph]}`}>{it.ph}</span>
                <span className={`sysmapPr ${it.prcls}`}>{it.prlbl}</span>
                <span className="sysmapPath">{renderPath(it.path)}</span>
              </div>)}
            </div>
          </section>;
        })}
      </div>
      {!anyVisible ? <div className="sysmapEmpty">Немає екранів під обрані фільтри.</div> : null}
    </div>
  </StaffWorkspaceShell>;
}
