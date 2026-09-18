"use client";

import { useEffect, useMemo, useState } from "react";
import StaffWorkspaceShell from "../../workspace-shell";
import ProtocolAddendaPanel from "../protocol-addenda-panel";
import styles from "./page.module.css";

type StaffRole = "admin" | "registrar" | "radiologist" | "radiographer";
type StaffInfo = { email:string; displayName:string; role:StaffRole };
type QueueItem = {
  id:number;
  code:string;
  name:string;
  service:string;
  serviceTitle:string;
  desiredDate:string;
  desiredTime:string;
  protocolNumber:string;
  protocolStatus:string;
  protocolIssuedAt:string;
  documentStatus:string;
  documentVersion:number;
};

const roleLabels:Record<StaffRole,string> = {
  admin:"Адміністратор",
  registrar:"Реєстратор",
  radiologist:"Лікар-рентгенолог",
  radiographer:"Рентгенолаборант",
};

function formatDateTime(value:string) {
  if (!value) return "—";
  const parsed = new Date(value.includes("T") ? value : value.replace(" ", "T") + "Z");
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString("uk-UA");
}

export default function ProtocolCorrectionsPage() {
  const [queue,setQueue] = useState<QueueItem[]>([]);
  const [staff,setStaff] = useState<StaffInfo | null>(null);
  const [selectedId,setSelectedId] = useState<number | null>(null);
  const [query,setQuery] = useState("");
  const [error,setError] = useState("");
  const [loading,setLoading] = useState(true);

  useEffect(()=>{
    const controller = new AbortController();
    async function load() {
      try {
        const response = await fetch("/api/staff/protocols", { cache:"no-store", signal:controller.signal });
        const data = await response.json() as { queue?:QueueItem[]; staff?:StaffInfo; error?:string };
        if (!response.ok) {
          setError(data.error || "Немає доступу");
          return;
        }
        setQueue(data.queue || []);
        setStaff(data.staff || null);
      } catch (cause) {
        if (!(cause instanceof DOMException && cause.name === "AbortError")) setError("Не вдалося завантажити видані протоколи");
      } finally {
        setLoading(false);
      }
    }
    void load();
    return ()=>controller.abort();
  },[]);

  const issued = useMemo(()=>queue
    .filter((item)=>item.documentStatus === "issued" || item.protocolStatus === "issued")
    .filter((item)=>!query.trim() || `${item.code} ${item.name} ${item.serviceTitle} ${item.service}`.toLowerCase().includes(query.trim().toLowerCase())),
  [queue,query]);

  const selected = issued.find((item)=>item.id === selectedId) || issued[0] || null;
  const effectiveSelectedId = selected?.id ?? null;
  const canManage = staff?.role === "admin" || staff?.role === "radiologist";

  return <StaffWorkspaceShell
    active="protocols"
    title="Виправлення до виданих протоколів"
    description="Окремі підписані доповнення без зміни оригінального медичного документа."
    staffName={staff?.displayName || staff?.email}
    staffRole={staff ? roleLabels[staff.role] : undefined}
  >
    {error ? <section className="accessDenied"><b>Захищений розділ</b><p>{error}</p></section>
      : !loading && staff && !canManage ? <section className="accessDenied">
        <b>Недостатньо прав</b>
        <p>Створювати та редагувати виправлення можуть лише лікар-рентгенолог або адміністратор. Підписувати — лише лікар-рентгенолог.</p>
      </section>
      : <div className={styles.workspace}>
        <aside className={styles.queue} aria-label="Видані протоколи">
          <div className={styles.tools}>
            <b>Видані протоколи</b>
            <span>{issued.length}</span>
            <input type="search" value={query} onChange={(event)=>setQuery(event.target.value)} placeholder="Код, ПІБ, дослідження"/>
          </div>
          <div className={styles.list}>
            {loading ? <p className={styles.muted}>Завантаження…</p>
              : issued.length === 0 ? <p className={styles.muted}>Виданих протоколів не знайдено.</p>
                : issued.map((item)=><button type="button" key={item.id}
                  className={item.id === effectiveSelectedId ? styles.activeItem : styles.item}
                  onClick={()=>setSelectedId(item.id)}>
                  <b>{item.serviceTitle || item.service}</b>
                  <span>{item.code} · {item.name}</span>
                  <small>Протокол {item.protocolNumber || "—"} · v{item.documentVersion || 1}</small>
                  <small>Видано: {formatDateTime(item.protocolIssuedAt)}</small>
                </button>)}
          </div>
        </aside>

        <main className={styles.content}>
          {!selected ? <section className={styles.placeholder}>
            <b>Оберіть виданий протокол</b>
            <p>Виправлення створюється як окремий документ і не переписує первинний протокол.</p>
          </section> : <>
            <header className={styles.selectedHead}>
              <div>
                <p className={styles.eyebrow}>Виданий протокол</p>
                <h2>{selected.serviceTitle || selected.service}</h2>
                <p>{selected.code} · {selected.name}</p>
              </div>
              <a href={`/staff/protocols?open=${selected.id}`}>Відкрити оригінал</a>
            </header>
            <ProtocolAddendaPanel bookingId={selected.id} staffRole={staff?.role || ""}/>
          </>}
        </main>
      </div>}
  </StaffWorkspaceShell>;
}
