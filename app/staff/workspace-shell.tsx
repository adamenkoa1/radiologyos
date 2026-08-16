"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import CommandPalette from "./command-palette";

type WorkspaceSection = "dashboard" | "overview" | "studies" | "patients" | "protocols" | "imaging" | "reports" | "tariffs" | "finance" | "counterparties" | "settings" | "organization" | "site" | "appointments" | "whatsapp" | "chat" | "schedule" | "equipment" | "services" | "structure" | "audit" | "intake" | "board" | "tasks" | "inventory";

type StaffWorkspaceShellProps = {
  active: WorkspaceSection;
  title: string;
  description: string;
  staffName?: string;
  staffRole?: string;
  children: ReactNode;
};

type NavChild = { label:string; href:string };
type NavLink = { label:string; href:string; section:WorkspaceSection; icon:string };
type NavModule = { label:string; href:string; sections:WorkspaceSection[]; icon:string; items:NavChild[] };

const processRail: NavLink[] = [
  { label:"Пульт", href:"/staff/dashboard", section:"dashboard", icon:"🏠" },
  { label:"Прийом", href:"/staff/intake", section:"intake", icon:"📥" },
  { label:"Розклад", href:"/staff/appointments", section:"appointments", icon:"🗓️" },
  { label:"Дошка", href:"/staff/board", section:"board", icon:"▦" },
  { label:"Завдання", href:"/staff/tasks", section:"tasks", icon:"☑" },
  { label:"Опис", href:"/staff/protocols", section:"protocols", icon:"✍️" },
  { label:"Видача", href:"/staff/studies", section:"studies", icon:"✅" },
];

const systemModules: NavModule[] = [
  { label:"Пацієнти", href:"/staff/patients", sections:["patients","chat"], icon:"👥", items:[
    { label:"Картки пацієнтів", href:"/staff/patients" },
    { label:"Чат із пацієнтами", href:"/staff/chat" },
  ]},
  { label:"Знімки DICOM", href:"/staff/imaging", sections:["imaging"], icon:"🩻", items:[
    { label:"Список досліджень", href:"/staff/imaging" },
    { label:"Стан PACS / MWL", href:"/staff/integrations/health" },
    { label:"Modality Worklist", href:"/staff/integrations/mwl" },
  ]},
  { label:"Кабінети й обладнання", href:"/staff/schedule", sections:["schedule","equipment","services"], icon:"🛠️", items:[
    { label:"Графік і слоти кабінетів", href:"/staff/schedule" },
    { label:"Обладнання", href:"/staff/equipment" },
    { label:"Послуги кабінетів", href:"/staff/services" },
  ]},
  { label:"Склад", href:"/staff/inventory", sections:["inventory"], icon:"▣", items:[
    { label:"Витратні матеріали", href:"/staff/inventory" },
  ]},
  { label:"Фінанси і звіти", href:"/staff/finance", sections:["finance","counterparties","reports","tariffs"], icon:"💳", items:[
    { label:"Фінансові документи", href:"/staff/finance" },
    { label:"Контрагенти", href:"/staff/counterparties" },
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

  const wide = active === "dashboard" || active === "appointments" || active === "intake" || active === "board" || active === "tasks" || active === "inventory" || active === "finance" || active === "counterparties";
  return <div className={`workspaceShell${collapsed ? " workspaceCollapsed":""}${dark ? " themeDark":""}${wide ? " workspaceWide":""}`}>
    <CommandPalette />
    <aside className="workspaceSidebar">
      <Link className="workspaceBrand" href="/staff/appointments" aria-label="RadiologyOS — календар заявок">
        <span className="workspaceBrandMark">R</span>
        <span className="workspaceBrandCopy"><b>RadiologyOS</b><small>Променева діагностика</small></span>
      </Link>

      <nav className="workspaceNavigation" aria-label="Модулі системи">
        <p>Робочий процес</p>
        {processRail.map((o, i)=><Link
          key={o.href}
          href={o.href}
          className={`workspaceModuleLink processStep${active === o.section ? " active":""}`}
          aria-current={active === o.section ? "page":undefined}
          title={collapsed ? o.label:undefined}
          data-step={i + 1}
        ><span aria-hidden="true">{o.icon}</span><b>{o.label}</b></Link>)}
        <p>Модулі</p>
        {systemModules.map((item)=>{
          const isActive = item.sections.includes(active);
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
            <Link href="/staff/finance">Фінанси</Link>
            <Link href="/staff/reports">Звіти відділення</Link>
            <Link href="/">Публічний сайт</Link>
            <button type="button" className="workspaceLogout" onClick={()=>void logout()}>Вийти</button>
          </div>
        </details>
      </header>

      <main className="workspacePage">
        <header className="workspacePageHead">
          <div>
            <p className="workspaceBreadcrumb">RadiologyOS <span>/</span> {active === "finance" ? "Фінанси":active === "counterparties" ? "Контрагенти":active === "reports" ? "Аналітика":active === "protocols" ? "Протоколи":active === "patients" ? "CRM":active === "imaging" ? "DICOM / PACS":active === "equipment" ? "Обладнання":active === "services" ? "Послуги кабінетів":active === "dashboard" ? "Пульт":active === "studies" ? "Дослідження":active === "appointments" ? "Календар записів":active === "board" ? "Дошка досліджень":active === "tasks" ? "Завдання":active === "inventory" ? "Склад":active === "whatsapp" ? "WhatsApp":active === "chat" ? "Чат з пацієнтами":active === "site" ? "Публічний сайт":active === "schedule" ? "Графік кабінетів":active === "tariffs" ? "Тарифи":active === "settings" ? "Налаштування":active === "organization" ? "Організація":active === "structure" ? "Структура відділення":active === "audit" ? "Журнал дій":active === "intake" ? "Дошка прийому":"Робочий кабінет"}</p>
            <h1>{title}</h1>
            <p>{description}</p>
          </div>
          <div className="workspacePageActions">
            {active === "reports"
              ? <Link href="/staff">До черги заявок</Link>
              : active === "protocols" || active === "patients" || active === "imaging" || active === "equipment" || active === "services" || active === "dashboard" || active === "settings" || active === "tariffs" || active === "studies" || active === "organization" || active === "appointments" || active === "board" || active === "tasks" || active === "inventory" || active === "finance" || active === "counterparties" || active === "whatsapp" || active === "chat" || active === "schedule" || active === "structure" || active === "audit" || active === "intake"
              ? <><Link href="/staff">До черги заявок</Link><Link className="primary" href="/staff/reports">Перейти до звітів</Link></>
              : <><a href="#bookings">Відкрити заявки</a><Link className="primary" href="/staff/reports">Перейти до звітів</Link></>}
          </div>
        </header>
        {children}
      </main>
    </div>
  </div>;
}
