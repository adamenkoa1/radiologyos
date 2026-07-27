"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";

type WorkspaceSection = "overview" | "patients" | "protocols" | "reports";

type StaffWorkspaceShellProps = {
  active: WorkspaceSection;
  title: string;
  description: string;
  staffName?: string;
  staffRole?: string;
  children: ReactNode;
};

const navigation = [
  { href:"/staff", label:"Головна", glyph:"⌂", section:"overview" as WorkspaceSection },
  { href:"/staff#schedule", label:"Розклад", glyph:"◫" },
  { href:"/staff#bookings", label:"Заявки", glyph:"≡" },
  { href:"/staff/patients", label:"Пацієнти", glyph:"☺", section:"patients" as WorkspaceSection },
  { href:"/staff#bookings", label:"Дослідження", glyph:"◎" },
  { href:"/staff/protocols", label:"Протоколи", glyph:"▤", section:"protocols" as WorkspaceSection },
  { href:"/staff/reports", label:"Звіти", glyph:"▥", section:"reports" as WorkspaceSection },
];

const administration = [
  { href:"/staff#staff-admin", label:"Персонал", glyph:"◉" },
  { href:"/staff#equipment", label:"Обладнання", glyph:"◇" },
  { href:"/", label:"Публічний сайт", glyph:"↗" },
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

  useEffect(()=>{
    const timer = window.setInterval(()=>setNow(new Date()),1000);
    return ()=>window.clearInterval(timer);
  },[]);

  const current = now ? formatDateTime(now) : {date:"—",time:"—"};
  const identity = staffName || "Робочий профіль";

  return <div className={`workspaceShell${collapsed ? " workspaceCollapsed":""}`}>
    <aside className="workspaceSidebar">
      <Link className="workspaceBrand" href="/staff" aria-label="RadiologyOS — головна">
        <span className="workspaceBrandMark">R</span>
        <span className="workspaceBrandCopy"><b>RadiologyOS</b><small>Променева діагностика</small></span>
      </Link>

      <nav className="workspaceNavigation" aria-label="Розділи кабінету">
        <p>Робоче місце</p>
        {navigation.map((item)=><Link
          href={item.href}
          key={`${item.href}-${item.label}`}
          className={item.section === active ? "active":""}
          aria-current={item.section === active ? "page":undefined}
          title={collapsed ? item.label:undefined}
        ><span aria-hidden="true">{item.glyph}</span><b>{item.label}</b></Link>)}
        <p>Керування</p>
        {administration.map((item)=><Link
          href={item.href}
          key={item.label}
          title={collapsed ? item.label:undefined}
        ><span aria-hidden="true">{item.glyph}</span><b>{item.label}</b></Link>)}
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
        <details className="workspaceProfile">
          <summary>
            <span className="workspaceAvatar">{identity.trim().charAt(0).toUpperCase() || "R"}</span>
            <span><b>{identity}</b><small>{staffRole || "Персонал відділення"}</small></span>
          </summary>
          <div>
            <Link href="/staff">Робочий кабінет</Link>
            <Link href="/staff/reports">Звіти відділення</Link>
            <Link href="/">Публічний сайт</Link>
          </div>
        </details>
      </header>

      <main className="workspacePage">
        <header className="workspacePageHead">
          <div>
            <p className="workspaceBreadcrumb">RadiologyOS <span>/</span> {active === "reports" ? "Аналітика":active === "protocols" ? "Протоколи":active === "patients" ? "CRM":"Робочий кабінет"}</p>
            <h1>{title}</h1>
            <p>{description}</p>
          </div>
          <div className="workspacePageActions">
            {active === "reports"
              ? <Link href="/staff">До черги заявок</Link>
              : active === "protocols" || active === "patients"
              ? <><Link href="/staff">До черги заявок</Link><Link className="primary" href="/staff/reports">Перейти до звітів</Link></>
              : <><a href="#bookings">Відкрити заявки</a><Link className="primary" href="/staff/reports">Перейти до звітів</Link></>}
          </div>
        </header>
        {children}
      </main>
    </div>
  </div>;
}
