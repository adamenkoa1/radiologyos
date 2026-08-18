"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import CommandPalette from "./command-palette";

type WorkspaceSection = "dashboard" | "overview" | "studies" | "patients" | "protocols" | "imaging" | "reports" | "tariffs" | "finance" | "counterparties" | "settings" | "organization" | "site" | "appointments" | "whatsapp" | "chat" | "schedule" | "equipment" | "services" | "structure" | "audit" | "intake" | "board" | "tasks" | "inventory" | "purchases";

type StaffWorkspaceShellProps = {
  active: WorkspaceSection;
  title: string;
  description: string;
  staffName?: string;
  staffRole?: string;
  children: ReactNode;
};

type NavChild = { label:string; href:string; hint?:string };
type NavLink = { label:string; href:string; section:WorkspaceSection; icon:string };
type BusinessModule = { key:string; label:string; shortLabel?:string; items:NavChild[] };

const processRail: NavLink[] = [
  { label:"Пульт", href:"/staff/dashboard", section:"dashboard", icon:"🏠" },
  { label:"Прийом", href:"/staff/intake", section:"intake", icon:"📥" },
  { label:"Розклад", href:"/staff/appointments", section:"appointments", icon:"🗓️" },
  { label:"Дошка", href:"/staff/board", section:"board", icon:"▦" },
  { label:"Завдання", href:"/staff/tasks", section:"tasks", icon:"☑" },
  { label:"Опис", href:"/staff/protocols", section:"protocols", icon:"✍️" },
  { label:"Видача", href:"/staff/studies", section:"studies", icon:"✅" },
];

const quickRail:NavLink[]=[
  { label:"Пацієнти",href:"/staff/patients",section:"patients",icon:"👥" },
  { label:"DICOM / PACS",href:"/staff/imaging",section:"imaging",icon:"🩻" },
  { label:"Склад",href:"/staff/inventory",section:"inventory",icon:"▣" },
  { label:"Фінанси",href:"/staff/finance",section:"finance",icon:"₴" },
  { label:"Звіти",href:"/staff/reports",section:"reports",icon:"▤" },
  { label:"Налаштування",href:"/staff/settings",section:"settings",icon:"⚙" },
];

const businessModules:BusinessModule[]=[
  { key:"home",label:"Головне",items:[
    {label:"Пульт відділення",href:"/staff/dashboard",hint:"Стан системи та робота сьогодні"},
    {label:"Прийом",href:"/staff/intake",hint:"Пацієнти, які прибули"},
    {label:"Дошка досліджень",href:"/staff/board"},
    {label:"Завдання",href:"/staff/tasks"},
  ]},
  { key:"patients",label:"Пацієнти",items:[
    {label:"Картки пацієнтів",href:"/staff/patients"},
    {label:"Чат із пацієнтами",href:"/staff/chat"},
  ]},
  { key:"registry",label:"Реєстратура",shortLabel:"Реєстратура",items:[
    {label:"Календар і записи",href:"/staff/appointments"},
    {label:"Прийом пацієнтів",href:"/staff/intake"},
    {label:"Дошка досліджень",href:"/staff/board"},
    {label:"Завдання",href:"/staff/tasks"},
  ]},
  { key:"medicine",label:"Медицина",items:[
    {label:"DICOM / PACS",href:"/staff/imaging"},
    {label:"Протоколи",href:"/staff/protocols"},
    {label:"Видача результатів",href:"/staff/studies"},
    {label:"Стан PACS / MWL",href:"/staff/integrations/health"},
    {label:"Modality Worklist",href:"/staff/integrations/mwl"},
  ]},
  { key:"services",label:"Послуги",items:[
    {label:"Послуги кабінетів",href:"/staff/services"},
    {label:"Тарифи",href:"/staff/tariffs"},
  ]},
  { key:"finance",label:"Фінанси",items:[
    {label:"Фінансові документи",href:"/staff/finance"},
    {label:"Контрагенти",href:"/staff/counterparties"},
  ]},
  { key:"inventory",label:"Склад",items:[
    {label:"Складський облік",href:"/staff/inventory",hint:"Залишки, надходження і списання"},
    {label:"Переміщення запасів",href:"/staff/inventory/transfers"},
    {label:"Інвентаризація",href:"/staff/inventory/counts",hint:"Фактичний перерахунок і коригування залишків"},
    {label:"Склади",href:"/staff/warehouses"},
  ]},
  { key:"purchases",label:"Закупівлі",items:[
    {label:"Кредиторка і оплати",href:"/staff/supplier-payables",hint:"Оцінка надходжень, борги та оплати постачальникам"},
    {label:"Постачальники",href:"/staff/counterparties",hint:"Довідник контрагентів"},
    {label:"Надходження на склад",href:"/staff/inventory",hint:"Документи оприбуткування"},
  ]},
  { key:"reports",label:"Звіти",items:[
    {label:"Звіти відділення",href:"/staff/reports"},
    {label:"Обороти регістрів",href:"/staff/reports/registers"},
  ]},
  { key:"directories",label:"Довідники",items:[
    {label:"Обладнання",href:"/staff/equipment"},
    {label:"Послуги",href:"/staff/services"},
    {label:"Тарифи",href:"/staff/tariffs"},
    {label:"Склади",href:"/staff/warehouses"},
    {label:"Контрагенти",href:"/staff/counterparties"},
    {label:"Графік кабінетів",href:"/staff/schedule"},
    {label:"Графік змін персоналу",href:"/staff/shifts",hint:"Циклічні зміни, бригади та персональні корекції"},
  ]},
  { key:"admin",label:"Адміністрування",shortLabel:"Адмін",items:[
    {label:"Налаштування",href:"/staff/settings"},
    {label:"Структура відділення",href:"/staff/structure"},
    {label:"Організація та профіль",href:"/staff/organization"},
    {label:"Персонал і ролі",href:"/staff#staff-admin"},
    {label:"Журнал дій",href:"/staff/audit"},
    {label:"WhatsApp і чат-бот",href:"/staff/whatsapp"},
  ]},
];

const moduleBySection:Record<WorkspaceSection,string>={
  dashboard:"home",overview:"home",
  patients:"patients",chat:"patients",
  appointments:"registry",intake:"registry",board:"registry",tasks:"registry",
  protocols:"medicine",imaging:"medicine",studies:"medicine",
  services:"services",tariffs:"services",
  finance:"finance",counterparties:"finance",
  inventory:"inventory",purchases:"purchases",
  reports:"reports",
  equipment:"directories",schedule:"directories",
  settings:"admin",organization:"admin",site:"admin",whatsapp:"admin",structure:"admin",audit:"admin",
};

const sectionLabels:Record<WorkspaceSection,string>={
  dashboard:"Пульт",overview:"Робочий кабінет",studies:"Видача результатів",patients:"Пацієнти",
  protocols:"Протоколи",imaging:"DICOM / PACS",reports:"Звіти",tariffs:"Тарифи",finance:"Фінанси",
  counterparties:"Контрагенти",settings:"Налаштування",organization:"Організація",site:"Публічний сайт",
  appointments:"Календар записів",whatsapp:"WhatsApp",chat:"Чат з пацієнтами",schedule:"Графік кабінетів",
  equipment:"Обладнання",services:"Послуги",structure:"Структура відділення",audit:"Журнал дій",
  intake:"Прийом",board:"Дошка досліджень",tasks:"Завдання",inventory:"Склад",purchases:"Кредиторка постачальників",
};

function formatDateTime(value:Date) {
  const date = new Intl.DateTimeFormat("uk-UA", {
    timeZone:"Europe/Kyiv",day:"2-digit",month:"2-digit",year:"numeric",
  }).format(value);
  const time = new Intl.DateTimeFormat("uk-UA", {
    timeZone:"Europe/Kyiv",hour:"2-digit",minute:"2-digit",second:"2-digit",
  }).format(value);
  return { date,time };
}

export default function StaffWorkspaceShell({
  active,title,description,staffName,staffRole,children,
}:StaffWorkspaceShellProps) {
  const [collapsed,setCollapsed] = useState(false);
  const [now,setNow] = useState<Date | null>(null);
  const [dark,setDark] = useState(false);
  const [browsedModule,setBrowsedModule] = useState<string|null>(null);

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
  const activeModuleKey=moduleBySection[active]||"home";
  const activeModule=businessModules.find(module=>module.key===activeModuleKey)||businessModules[0];
  const browsed=businessModules.find(module=>module.key===(browsedModule||activeModuleKey))||activeModule;

  async function logout() {
    await fetch("/api/staff/logout", { method:"POST" }).catch(()=>{});
    window.location.assign("/staff/login");
  }

  const wide = active === "dashboard" || active === "appointments" || active === "intake" || active === "board" || active === "tasks" || active === "inventory" || active === "finance" || active === "counterparties" || active === "purchases";
  return <div className={`workspaceShell basWorkspaceShell${collapsed ? " workspaceCollapsed":""}${dark ? " themeDark":""}${wide ? " workspaceWide":""}`}>
    <CommandPalette />
    <aside className="workspaceSidebar">
      <Link className="workspaceBrand" href="/staff/dashboard" aria-label="RadiologyOS — головний пульт">
        <span className="workspaceBrandMark">R</span>
        <span className="workspaceBrandCopy"><b>RadiologyOS</b><small>Бізнес-ядро + медицина</small></span>
      </Link>

      <nav className="workspaceNavigation" aria-label="Робочий процес">
        <p>Робочий процес</p>
        {processRail.map((o, i)=><Link
          key={o.href} href={o.href}
          className={`workspaceModuleLink processStep${active === o.section ? " active":""}`}
          aria-current={active === o.section ? "page":undefined}
          title={collapsed ? o.label:undefined} data-step={i + 1}
        ><span aria-hidden="true">{o.icon}</span><b>{o.label}</b></Link>)}
        <p>Швидкий доступ</p>
        {quickRail.map((o)=><Link
          key={o.href} href={o.href}
          className={`workspaceModuleLink${active === o.section ? " active":""}`}
          aria-current={active === o.section ? "page":undefined}
          title={collapsed ? o.label:undefined}
        ><span aria-hidden="true">{o.icon}</span><b>{o.label}</b></Link>)}
      </nav>

      <div className="workspaceSidebarFoot">
        <span className="systemPulse" aria-hidden="true"/>
        <span><b>Система працює</b><small>Захищений робочий кабінет</small></span>
      </div>
    </aside>

    <div className="workspaceMain">
      <header className="workspaceTopbar">
        <button
          className="workspaceMenuButton" type="button"
          aria-label={collapsed ? "Розгорнути меню":"Згорнути меню"}
          aria-expanded={!collapsed} onClick={()=>setCollapsed((value)=>!value)}
        ><span/><span/><span/></button>
        <div className="workspaceTopTitle"><b>Чернігівський військовий госпіталь</b><small>Відділення променевої діагностики</small></div>
        <div className="workspaceClock" aria-label="Поточна дата і час"><b>{current.time}</b><span>{current.date}</span></div>
        <span className="workspaceOnline"><i/> Онлайн</span>
        <button
          className="workspaceThemeToggle" type="button" aria-pressed={dark}
          aria-label={dark ? "Світла тема":"Темна тема"} title={dark ? "Світла тема":"Темна тема"}
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
            <Link href="/staff/inventory">Склад</Link>
            <Link href="/staff/reports">Звіти відділення</Link>
            <Link href="/">Публічний сайт</Link>
            <button type="button" className="workspaceLogout" onClick={()=>void logout()}>Вийти</button>
          </div>
        </details>
      </header>

      <nav className="workspaceBusinessBar" aria-label="Бізнес-модулі RadiologyOS">
        <div className="workspaceBusinessModules" role="tablist" aria-label="Модулі">
          {businessModules.map(module=>{
            const currentModule=module.key===activeModuleKey;
            const selected=module.key===browsed.key;
            return <button
              key={module.key} type="button" role="tab" aria-selected={selected}
              className={`${currentModule?"current ":""}${selected?"selected":""}`.trim()}
              onClick={()=>setBrowsedModule(module.key)}
            ><span>{module.shortLabel||module.label}</span>{currentModule&&<i aria-label="Поточний модуль"/>}</button>;
          })}
        </div>
        <div className="workspaceBusinessCommands" aria-label={`Команди модуля ${browsed.label}`}>
          <span className="workspaceBusinessContext"><b>{browsed.label}</b><small>{browsed.key===activeModuleKey?"Поточний модуль":"Перегляд команд"}</small></span>
          <div className="workspaceBusinessLinks">
            {browsed.items.map(item=><Link key={`${browsed.key}-${item.href}-${item.label}`} href={item.href} title={item.hint}>{item.label}</Link>)}
          </div>
          {browsed.key!==activeModuleKey&&<button type="button" className="workspaceBusinessReturn" onClick={()=>setBrowsedModule(null)}>↩ {activeModule.label}</button>}
        </div>
      </nav>

      <main className="workspacePage">
        <header className="workspacePageHead">
          <div>
            <p className="workspaceBreadcrumb">RadiologyOS <span>/</span> {activeModule.label} <span>/</span> {sectionLabels[active]}</p>
            <h1>{title}</h1>
            <p>{description}</p>
          </div>
          <div className="workspacePageActions">
            {active === "reports"
              ? <Link href="/staff/dashboard">На головний пульт</Link>
              : <><Link href="/staff/dashboard">Головне</Link><Link className="primary" href="/staff/reports">Звіти</Link></>}
          </div>
        </header>
        {children}
      </main>
    </div>
  </div>;
}