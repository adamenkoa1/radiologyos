"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";

type WorkspaceSection = "dashboard" | "overview" | "studies" | "patients" | "protocols" | "imaging" | "reports" | "tariffs" | "settings" | "organization" | "system-map" | "site" | "appointments" | "whatsapp" | "chat" | "schedule" | "equipment" | "services" | "structure" | "audit" | "intake";

type StaffWorkspaceShellProps = {
  active: WorkspaceSection;
  title: string;
  description: string;
  staffName?: string;
  staffRole?: string;
  children: ReactNode;
};

// Бічна панель: угорі «Огляд» — найчастіші екрани реєстратури; нижче
// «Модулі» — робочі напрями, згруповані за призначенням. Кожен модуль
// веде на головну сторінку напряму й розгортається у підпункти-екрани.
type NavChild = { label:string; href:string };
type NavLink = { label:string; href:string; section:WorkspaceSection; icon:string };
// section — головний розділ модуля; sections — усі розділи, що його підсвічують.
type NavModule = { label:string; href:string; sections:WorkspaceSection[]; icon:string; items:NavChild[] };

// Швидкий доступ: найчастіші екрани реєстратури — угорі, з піктограмами.
const overview: NavLink[] = [
  { label:"Пульт", href:"/staff/dashboard", section:"dashboard", icon:"🏠" },
  { label:"Дошка прийому", href:"/staff/intake", section:"intake", icon:"📋" },
  { label:"Календар записів", href:"/staff/appointments", section:"appointments", icon:"🗓️" },
];

// Модулі — згруповані за напрямом роботи, з піктограмами й підпунктами.
const systemModules: NavModule[] = [
  { label:"Пацієнти", href:"/staff/patients", sections:["patients","chat"], icon:"👥", items:[
    { label:"Картки пацієнтів", href:"/staff/patients" },
    { label:"Чат із пацієнтами", href:"/staff/chat" },
  ]},
  { label:"Дослідження", href:"/staff/studies", sections:["studies","protocols","imaging"], icon:"🩻", items:[
    { label:"Реєстр досліджень", href:"/staff/studies" },
    { label:"Протоколи", href:"/staff/protocols" },
    { label:"Знімки DICOM", href:"/staff/imaging" },
  ]},
  { label:"Кабінети й обладнання", href:"/staff/schedule", sections:["schedule","equipment","services"], icon:"🛠️", items:[
    { label:"Графік і слоти кабінетів", href:"/staff/schedule" },
    { label:"Обладнання", href:"/staff/equipment" },
    { label:"Послуги кабінетів", href:"/staff/services" },
  ]},
  { label:"Фінанси і звіти", href:"/staff/reports", sections:["reports","tariffs"], icon:"💳", items:[
    { label:"Звіти відділення", href:"/staff/reports" },
    { label:"Тарифи", href:"/staff/tariffs" },
  ]},
  { label:"Адміністрування", href:"/staff/settings", sections:["settings","structure","organization","whatsapp","audit"], icon:"⚙️", items:[
    { label:"Налаштування", href:"/staff/settings" },
    { label:"Сайт і структура відділення", href:"/staff/structure" },
    { label:"Організація та профіль", href:"/staff/organization" },
    { label:"Персонал і ролі", href:"/staff#staff-admin" },
    { label:"WhatsApp і чат-бот", href:"/staff/whatsapp" },
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

  function toggleModule(key:string) {
    setOpenModules((current)=>({ ...current, [key]:!current[key] }));
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

  // Робочі екрани лікаря працюють на всю ширину (Variant B), тому заголовок
  // сторінки теж розтягуємо, щоб він не «висів» вужчою колонкою над контентом.
  const wide = active === "dashboard" || active === "appointments" || active === "intake";
  return <div className={`workspaceShell${collapsed ? " workspaceCollapsed":""}${dark ? " themeDark":""}${wide ? " workspaceWide":""}`}>
    <aside className="workspaceSidebar">
      <Link className="workspaceBrand" href="/staff/appointments" aria-label="RadiologyOS — календар заявок">
        <span className="workspaceBrandMark">R</span>
        <span className="workspaceBrandCopy"><b>RadiologyOS</b><small>Променева діагностика</small></span>
      </Link>

      <nav className="workspaceNavigation" aria-label="Модулі системи">
        <p>Огляд</p>
        {overview.map((o)=><Link
          key={o.href}
          href={o.href}
          className={`workspaceModuleLink${active === o.section ? " active":""}`}
          aria-current={active === o.section ? "page":undefined}
          title={collapsed ? o.label:undefined}
        ><span aria-hidden="true">{o.icon}</span><b>{o.label}</b></Link>)}
        <p>Модулі</p>
        {systemModules.map((item)=>{
          const isActive = item.sections.includes(active);
          // Акордеон: типово розгорнутий лише модуль поточного розділу, решта
          // згорнуті в один рядок. Користувач може розгортати вручну.
          const isOpen = openModules[item.href] ?? isActive;
          return <div className="workspaceModuleGroup" key={item.href}>
            <div className="workspaceModuleRow">
              <Link
                href={item.href}
                className={`workspaceModuleLink${isActive ? " active":""}`}
                aria-current={isActive ? "page":undefined}
                title={collapsed ? item.label:undefined}
              ><span aria-hidden="true">{item.icon}</span><b>{item.label}</b></Link>
              {item.items.length > 0 && <button
                type="button"
                className="workspaceSubToggle"
                aria-label={isOpen ? "Згорнути підпункти":"Розгорнути підпункти"}
                aria-expanded={isOpen}
                onClick={()=>toggleModule(item.href)}
              >▾</button>}
            </div>
            {isOpen && item.items.length > 0 && <div className="workspaceSubList">
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
            <p className="workspaceBreadcrumb">RadiologyOS <span>/</span> {active === "reports" ? "Аналітика":active === "protocols" ? "Протоколи":active === "patients" ? "CRM":active === "imaging" ? "DICOM / PACS":active === "equipment" ? "Обладнання":active === "services" ? "Послуги кабінетів":active === "dashboard" ? "Пульт":active === "studies" ? "Дослідження":active === "appointments" ? "Календар записів":active === "whatsapp" ? "WhatsApp":active === "chat" ? "Чат з пацієнтами":active === "site" ? "Публічний сайт":active === "schedule" ? "Графік кабінетів":active === "tariffs" ? "Тарифи":active === "settings" ? "Налаштування":active === "organization" ? "Організація":active === "system-map" ? "Карта системи":active === "structure" ? "Структура відділення":active === "audit" ? "Журнал дій":active === "intake" ? "Дошка прийому":"Робочий кабінет"}</p>
            <h1>{title}</h1>
            <p>{description}</p>
          </div>
          <div className="workspacePageActions">
            {active === "reports"
              ? <Link href="/staff">До черги заявок</Link>
              : active === "protocols" || active === "patients" || active === "imaging" || active === "equipment" || active === "services" || active === "dashboard" || active === "settings" || active === "tariffs" || active === "studies" || active === "organization" || active === "appointments" || active === "whatsapp" || active === "chat" || active === "schedule" || active === "structure" || active === "audit" || active === "intake"
              ? <><Link href="/staff">До черги заявок</Link><Link className="primary" href="/staff/reports">Перейти до звітів</Link></>
              : <><a href="#bookings">Відкрити заявки</a><Link className="primary" href="/staff/reports">Перейти до звітів</Link></>}
          </div>
        </header>
        {children}
      </main>
    </div>
  </div>;
}
