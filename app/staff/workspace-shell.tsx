"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";

type WorkspaceSection = "dashboard" | "overview" | "studies" | "patients" | "protocols" | "imaging" | "reports" | "tariffs" | "settings" | "organization" | "system-map" | "site" | "appointments" | "whatsapp" | "chat" | "schedule" | "structure" | "audit";

type StaffWorkspaceShellProps = {
  active: WorkspaceSection;
  title: string;
  description: string;
  staffName?: string;
  staffRole?: string;
  children: ReactNode;
};

// Бічна панель = модулі системи (у порядку «Карти системи»). Кожен модуль веде
// на робочу сторінку й розгортається у підпункти-екрани; кожен підпункт — на
// свою сторінку (нереалізовані ведуть у блок карти). Продукт обслуговує єдиний
// заклад, тож усі пункти показуються завжди.
type NavChild = { label:string; href:string };
type NavModule = { n:string; label:string; href:string; section?:WorkspaceSection; items:NavChild[] };
const systemModules: NavModule[] = [
  { n:"1", label:"Головна / Послуги", href:"/staff/structure", section:"structure", items:[
    { label:"Структура і контент", href:"/staff/structure" },
    { label:"Відкрити сайт", href:"/" },
    { label:"Онлайн-запис", href:"/" },
    { label:"Тарифи", href:"/staff/tariffs" },
    { label:"Контакти", href:"/" },
    { label:"Пакети / акції", href:"/staff/system-map#mod-1" },
    { label:"Довіра", href:"/staff/system-map#mod-1" },
    { label:"Зворотний дзвінок", href:"/staff/system-map#mod-1" },
  ]},
  { n:"2", label:"Запис і заявки", href:"/staff", section:"overview", items:[
    { label:"Форма заявки", href:"/site/price.html" },
    { label:"Вибір часу", href:"/staff/dashboard" },
    { label:"Кабінет пацієнта", href:"/site/cabinet.html" },
    { label:"Черга реєстратури", href:"/staff#bookings" },
    { label:"Нова запис", href:"/staff/book" },
    { label:"Календар записів", href:"/staff/appointments" },
    { label:"Реєстр досліджень", href:"/staff/studies" },
    { label:"Розклад дня", href:"/staff/dashboard" },
    { label:"Нагадування", href:"/staff/settings" },
    { label:"Повторний запис", href:"/staff/system-map#mod-2" },
  ]},
  { n:"3", label:"CRM (пацієнти/клієнти)", href:"/staff/patients", section:"patients", items:[
    { label:"Картка пацієнта", href:"/staff/patients" },
    { label:"Чат з пацієнтами", href:"/staff/chat" },
    { label:"Комунікації", href:"/staff/patients" },
    { label:"Сегменти", href:"/staff/patients" },
    { label:"Експорт контактів", href:"/staff/patients" },
    { label:"Розсилки", href:"/staff/system-map#mod-3" },
    { label:"Воронка лідів", href:"/staff/system-map#mod-3" },
    { label:"Лояльність", href:"/staff/system-map#mod-3" },
  ]},
  { n:"4", label:"Бухгалтерія / Фінанси", href:"/staff/reports", section:"reports", items:[
    { label:"Оплати за заявками", href:"/staff#bookings" },
    { label:"Тарифи / прайс", href:"/staff/tariffs" },
    { label:"Квитанції / рахунки", href:"/staff/system-map#mod-4" },
    { label:"Каса та зміни", href:"/staff/system-map#mod-4" },
    { label:"Звірка з Приват24", href:"/staff/system-map#mod-4" },
    { label:"Фінансові звіти", href:"/staff/reports" },
    { label:"Договори / акти", href:"/staff/system-map#mod-4" },
    { label:"Витрати", href:"/staff/system-map#mod-4" },
    { label:"Податки / ФОП", href:"/staff/system-map#mod-4" },
  ]},
  { n:"5", label:"Персонал (HR)", href:"/staff#staff-admin", items:[
    { label:"Співробітники й ролі", href:"/staff#staff-admin" },
    { label:"Реєстрація за кодом", href:"/staff/register" },
    { label:"Графік змін", href:"/staff/system-map#mod-5" },
    { label:"Завантаженість", href:"/staff/system-map#mod-5" },
    { label:"KPI / виробіток", href:"/staff/system-map#mod-5" },
    { label:"Відпустки / лікарняні", href:"/staff/system-map#mod-5" },
    { label:"Журнал дій (аудит)", href:"/staff/audit" },
  ]},
  { n:"6", label:"Обладнання", href:"/staff/imaging", section:"imaging", items:[
    { label:"Реєстр апаратів", href:"/staff#equipment" },
    { label:"Графік і слоти", href:"/staff/schedule" },
    { label:"Завантаженість", href:"/staff/dashboard" },
    { label:"Знімки / PACS", href:"/staff/imaging" },
    { label:"Обслуговування (ТО)", href:"/staff/system-map#mod-6" },
    { label:"Простої / поломки", href:"/staff#equipment" },
    { label:"Витратні матеріали", href:"/staff/system-map#mod-6" },
  ]},
  { n:"7", label:"Адмін / Наскрізне", href:"/staff/dashboard", section:"dashboard", items:[
    { label:"Пульт відділення", href:"/staff/dashboard" },
    { label:"Організація", href:"/staff/organization" },
    { label:"WhatsApp", href:"/staff/whatsapp" },
    { label:"Налаштування", href:"/staff/settings" },
    { label:"Ролі й права", href:"/staff#staff-admin" },
    { label:"Журнал дій (аудит)", href:"/staff/audit" },
    { label:"Календар", href:"/staff/settings" },
    { label:"Резервне копіювання", href:"/staff/settings" },
  ]},
];

function formatDateTime(value:Date) {
  const date = new Intl.DateTimeFormat("uk-UA", {
    timeZone:"Europe/Kyiv",
    day:"2-digit",
    month:"2-digit",
    year:"numeric",
  }).format(value);
  const time = new Intl.DateTimeFormat("uk-UA", {
    timeZone:"Europe/Kyiv",
    hour:"2-digit",
    minute:"2-digit",
    second:"2-digit",
  }).format(value);
  return { date,time };
}

export default function StaffWorkspaceShell({
  active,
  title,
  description,
  staffName,
  staffRole,
  children,
}:StaffWorkspaceShellProps) {
  const [collapsed,setCollapsed] = useState(false);
  const [now,setNow] = useState<Date | null>(null);
  const [dark,setDark] = useState(false);
  const [openModules,setOpenModules] = useState<Record<string,boolean>>({});

  function toggleModule(n:string) {
    setOpenModules((current)=>({ ...current, [n]:!current[n] }));
  }

  useEffect(()=>{
    const timer = window.setInterval(()=>setNow(new Date()),1000);
    return ()=>window.clearInterval(timer);
  },[]);

  useEffect(()=>{
    const stored = window.localStorage.getItem("ws-theme");
    const prefersDark = window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDark(stored ? stored === "dark" : prefersDark);
  },[]);

  function toggleTheme() {
    setDark((value)=>{
      const next = !value;
      window.localStorage.setItem("ws-theme", next ? "dark" : "light");
      return next;
    });
  }

  const current = now ? formatDateTime(now) : {date:"—",time:"—"};
  const identity = staffName || "Робочий профіль";

  async function logout() {
    await fetch("/api/staff/logout", { method:"POST" }).catch(()=>{});
    window.location.assign("/staff/login");
  }

  return <div className={`workspaceShell${collapsed ? " workspaceCollapsed":""}${dark ? " themeDark":""}`}>
    <aside className="workspaceSidebar">
      <Link className="workspaceBrand" href="/staff" aria-label="RadiologyOS — головна">
        <span className="workspaceBrandMark">R</span>
        <span className="workspaceBrandCopy"><b>RadiologyOS</b><small>Променева діагностика</small></span>
      </Link>

      <nav className="workspaceNavigation" aria-label="Модулі системи">
        <p>Огляд</p>
        <Link
          href="/staff/system-map"
          className={`workspaceModuleLink${active === "system-map" ? " active":""}`}
          aria-current={active === "system-map" ? "page":undefined}
          title={collapsed ? "Карта системи":undefined}
        ><span aria-hidden="true">◑</span><b>Карта системи</b></Link>
        <Link
          href="/staff/structure"
          className={`workspaceModuleLink${active === "structure" ? " active":""}`}
          aria-current={active === "structure" ? "page":undefined}
          title={collapsed ? "Структура відділення":undefined}
        ><span aria-hidden="true">▤</span><b>Структура відділення</b></Link>
        <p>Модулі</p>
        {systemModules.map((item)=>{
          const isActive = !!item.section && item.section === active;
          const isOpen = openModules[item.n] ?? true;
          return <div className="workspaceModuleGroup" key={item.n}>
            <div className="workspaceModuleRow">
              <Link
                href={item.href}
                className={`workspaceModuleLink${isActive ? " active":""}`}
                aria-current={isActive ? "page":undefined}
                title={collapsed ? item.label:undefined}
              ><span aria-hidden="true">{item.n}</span><b>{item.label}</b></Link>
              <button
                type="button"
                className="workspaceSubToggle"
                aria-label={isOpen ? "Згорнути підпункти":"Розгорнути підпункти"}
                aria-expanded={isOpen}
                onClick={()=>toggleModule(item.n)}
              >▾</button>
            </div>
            {isOpen && <div className="workspaceSubList">
              {item.items.map((sub,i)=><Link key={i} href={sub.href} className="workspaceSubLink">{sub.label}</Link>)}
            </div>}
          </div>;
        })}
      </nav>

      <div className="workspaceSidebarFoot">
        <span className="systemPulse" aria-hidden="true"/>
        <span><b>Система працює</b><small>Захищений робочий кабінет</small></span>
      </div>
    </aside>

    <div className="workspaceMain">
      <header className="workspaceTopbar">
        <button
          className="workspaceMenuButton"
          type="button"
          aria-label={collapsed ? "Розгорнути меню":"Згорнути меню"}
          aria-expanded={!collapsed}
          onClick={()=>setCollapsed((value)=>!value)}
        ><span/><span/><span/></button>
        <div className="workspaceTopTitle"><b>Чернігівський військовий госпіталь</b><small>Відділення променевої діагностики</small></div>
        <div className="workspaceClock" aria-label="Поточна дата і час"><b>{current.time}</b><span>{current.date}</span></div>
        <span className="workspaceOnline"><i/> Онлайн</span>
        <button
          className="workspaceThemeToggle"
          type="button"
          aria-pressed={dark}
          aria-label={dark ? "Світла тема":"Темна тема"}
          title={dark ? "Світла тема":"Темна тема"}
          onClick={toggleTheme}
        >{dark ? "◑":"◐"}</button>
        <details className="workspaceProfile">
          <summary>
            <span className="workspaceAvatar">{identity.trim().charAt(0).toUpperCase() || "R"}</span>
            <span><b>{identity}</b><small>{staffRole || "Персонал відділення"}</small></span>
          </summary>
          <div>
            <Link href="/staff">Робочий кабінет</Link>
            <Link href="/staff/reports">Звіти відділення</Link>
            <Link href="/">Публічний сайт</Link>
            <button type="button" className="workspaceLogout" onClick={()=>void logout()}>Вийти</button>
          </div>
        </details>
      </header>

      <main className="workspacePage">
        <header className="workspacePageHead">
          <div>
            <p className="workspaceBreadcrumb">RadiologyOS <span>/</span> {active === "reports" ? "Аналітика":active === "protocols" ? "Протоколи":active === "patients" ? "CRM":active === "imaging" ? "DICOM / PACS":active === "dashboard" ? "Пульт":active === "studies" ? "Дослідження":active === "appointments" ? "Календар записів":active === "whatsapp" ? "WhatsApp":active === "chat" ? "Чат з пацієнтами":active === "site" ? "Публічний сайт":active === "schedule" ? "Графік і слоти":active === "tariffs" ? "Тарифи":active === "settings" ? "Налаштування":active === "organization" ? "Організація":active === "system-map" ? "Карта системи":active === "structure" ? "Структура відділення":active === "audit" ? "Журнал дій":"Робочий кабінет"}</p>
            <h1>{title}</h1>
            <p>{description}</p>
          </div>
          <div className="workspacePageActions">
            {active === "reports"
              ? <Link href="/staff">До черги заявок</Link>
              : active === "protocols" || active === "patients" || active === "imaging" || active === "dashboard" || active === "settings" || active === "tariffs" || active === "studies" || active === "organization" || active === "appointments" || active === "whatsapp" || active === "chat" || active === "schedule" || active === "structure" || active === "audit"
              ? <><Link href="/staff">До черги заявок</Link><Link className="primary" href="/staff/reports">Перейти до звітів</Link></>
              : <><a href="#bookings">Відкрити заявки</a><Link className="primary" href="/staff/reports">Перейти до звітів</Link></>}
          </div>
        </header>
        {children}
      </main>
    </div>
  </div>;
}
