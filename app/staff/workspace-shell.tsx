"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";

type WorkspaceSection = "dashboard" | "overview" | "studies" | "patients" | "protocols" | "imaging" | "reports" | "tariffs" | "settings" | "organization" | "system-map" | "site" | "appointments" | "whatsapp" | "chat" | "schedule" | "equipment" | "structure" | "audit";

type StaffWorkspaceShellProps = {
  active: WorkspaceSection;
  title: string;
  description: string;
  staffName?: string;
  staffRole?: string;
  children: ReactNode;
};

// Бічна панель = модулі цільової структури (у порядку «Карти системи»).
// Кожен модуль веде на робочу сторінку й розгортається у підпункти-екрани;
// кожен підпункт — на свою сторінку (нереалізовані ведуть у блок карти).
// Підпункт може залежати від feature flag профілю організації: якщо
// відповідну можливість вимкнено, пункт ховається (конструктор).
type NavChild = { label:string; href:string; flag?:string };
type NavModule = { n:string; label:string; href:string; section?:WorkspaceSection; defaultOpen?:boolean; items:NavChild[] };
const systemModules: NavModule[] = [
  { n:"1", label:"Календар і заявки", href:"/staff/appointments", section:"appointments", items:[
    { label:"Календар заявок", href:"/staff/appointments" },
    { label:"Записати пацієнта", href:"/staff/book" },
    { label:"Пульт відділення", href:"/staff/dashboard" },
    { label:"Кабінет пацієнта", href:"/site/cabinet.html", flag:"patient_cabinet" },
  ]},
  { n:"2", label:"Пацієнти", href:"/staff/patients", section:"patients", items:[
    { label:"Картки пацієнтів", href:"/staff/patients" },
    { label:"Чат із пацієнтами", href:"/staff/chat" },
    { label:"WhatsApp", href:"/staff/whatsapp" },
  ]},
  { n:"3", label:"Кабінети й обладнання", href:"/staff/schedule", section:"schedule", items:[
    { label:"Графік і слоти кабінетів", href:"/staff/schedule" },
    { label:"Обладнання", href:"/staff/equipment" },
  ]},
  { n:"4", label:"Дослідження", href:"/staff/studies", section:"studies", items:[
    { label:"Реєстр досліджень", href:"/staff/studies" },
    { label:"Протоколи", href:"/staff/protocols" },
    { label:"Знімки DICOM", href:"/staff/imaging", flag:"dicom_pacs" },
  ]},
  { n:"5", label:"Фінанси і звіти", href:"/staff/reports", section:"reports", items:[
    { label:"Звіти відділення", href:"/staff/reports" },
    { label:"Тарифи", href:"/staff/tariffs" },
  ]},
  { n:"6", label:"Адміністрування", href:"/staff/settings", section:"settings", defaultOpen:false, items:[
    { label:"Редактор публічного сайту", href:"/staff/structure" },
    { label:"Організація та профіль", href:"/staff/organization" },
    { label:"Персонал і ролі", href:"/staff#staff-admin" },
    { label:"Реєстрація працівника", href:"/staff/register" },
    { label:"Налаштування", href:"/staff/settings" },
    { label:"Журнал дій", href:"/staff/audit" },
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
  // Ефективні feature flags організації; null — ще не завантажено (показуємо все).
  const [flags,setFlags] = useState<Record<string,boolean> | null>(null);

  function toggleModule(n:string) {
    setOpenModules((current)=>({ ...current, [n]:!current[n] }));
  }

  // Пункт видимий, доки прапорці не завантажені; після — лише якщо його
  // можливість увімкнена (пункти без flag завжди видимі).
  function childVisible(child:NavChild) {
    if (!child.flag) return true;
    if (!flags) return true;
    return flags[child.flag] !== false;
  }

  useEffect(()=>{
    let active = true;
    fetch("/api/staff/org-profile", { cache:"no-store" })
      .then((r)=>r.ok ? r.json() : null)
      .then((d)=>{ if (active && d?.flags) setFlags(d.flags as Record<string,boolean>); })
      .catch(()=>{});
    return ()=>{ active = false; };
  },[]);

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
      <Link className="workspaceBrand" href="/staff/appointments" aria-label="RadiologyOS — календар заявок">
        <span className="workspaceBrandMark">R</span>
        <span className="workspaceBrandCopy"><b>RadiologyOS</b><small>Променева діагностика</small></span>
      </Link>

      <nav className="workspaceNavigation" aria-label="Модулі системи">
        <p>Огляд</p>
        <Link
          href="/staff/structure"
          className={`workspaceModuleLink${active === "structure" ? " active":""}`}
          aria-current={active === "structure" ? "page":undefined}
          title={collapsed ? "Публічна вітрина":undefined}
        ><span aria-hidden="true">▤</span><b>Редактор сайту</b></Link>
        <p>Модулі</p>
        {systemModules.map((item)=>{
          const isActive = !!item.section && item.section === active;
          const isOpen = openModules[item.n] ?? item.defaultOpen ?? true;
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
              {item.items.filter(childVisible).map((sub,i)=><Link key={i} href={sub.href} className="workspaceSubLink">{sub.label}</Link>)}
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
            <Link href="/staff/appointments">Календар і заявки</Link>
            <Link href="/staff/reports">Звіти відділення</Link>
            <Link href="/">Публічний сайт</Link>
            <button type="button" className="workspaceLogout" onClick={()=>void logout()}>Вийти</button>
          </div>
        </details>
      </header>

      <main className="workspacePage">
        <header className="workspacePageHead">
          <div>
            <p className="workspaceBreadcrumb">RadiologyOS <span>/</span> {active === "reports" ? "Аналітика":active === "protocols" ? "Протоколи":active === "patients" ? "CRM":active === "imaging" ? "DICOM / PACS":active === "equipment" ? "Обладнання":active === "dashboard" ? "Пульт":active === "studies" ? "Дослідження":active === "appointments" ? "Календар записів":active === "whatsapp" ? "WhatsApp":active === "chat" ? "Чат з пацієнтами":active === "site" ? "Публічний сайт":active === "schedule" ? "Графік кабінетів":active === "tariffs" ? "Тарифи":active === "settings" ? "Налаштування":active === "organization" ? "Організація":active === "system-map" ? "Карта системи":active === "structure" ? "Структура відділення":active === "audit" ? "Журнал дій":"Робочий кабінет"}</p>
            <h1>{title}</h1>
            <p>{description}</p>
          </div>
          <div className="workspacePageActions">
            {active === "reports"
              ? <Link href="/staff">До черги заявок</Link>
              : active === "protocols" || active === "patients" || active === "imaging" || active === "equipment" || active === "dashboard" || active === "settings" || active === "tariffs" || active === "studies" || active === "organization" || active === "appointments" || active === "whatsapp" || active === "chat" || active === "schedule" || active === "structure" || active === "audit"
              ? <><Link href="/staff">До черги заявок</Link><Link className="primary" href="/staff/reports">Перейти до звітів</Link></>
              : <><a href="#bookings">Відкрити заявки</a><Link className="primary" href="/staff/reports">Перейти до звітів</Link></>}
          </div>
        </header>
        {children}
      </main>
    </div>
  </div>;
}
