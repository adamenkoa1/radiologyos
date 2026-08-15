"use client";

import { useEffect, useMemo, useState } from "react";
import styles from "./protocol-addenda-panel.module.css";

type StaffRole = "admin" | "registrar" | "radiologist" | "radiographer" | "";
type AddendumStatus = "draft" | "ready" | "signed" | "issued";

type Addendum = {
  id:string;
  bookingId:number;
  baseProtocolVersion:number;
  reason:string;
  correctionText:string;
  status:AddendumStatus;
  version:number;
  authorEmail:string;
  updatedBy:string;
  updatedAt:string;
  signedBy:string;
  signedAt:string;
  signedVersion:number;
  createdAt:string;
};

type Revision = {
  id:number;
  addendumId:string;
  baseProtocolVersion:number;
  version:number;
  reason:string;
  correctionText:string;
  status:"draft" | "ready" | "signed";
  savedBy:string;
  createdAt:string;
};

type ApiPayload = {
  baseProtocol?:{ version?:number; number?:string; status?:string } | null;
  addenda?:Addendum[];
  revisions?:Revision[];
  error?:string;
};

const statusLabels:Record<AddendumStatus,string> = {
  draft:"Чернетка",
  ready:"До підпису",
  signed:"Підписано",
  issued:"Видано пацієнту",
};

function formatDateTime(value:string) {
  if (!value) return "—";
  const parsed = new Date(value.includes("T") ? value : value.replace(" ", "T") + "Z");
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString("uk-UA");
}

export default function ProtocolAddendaPanel({ bookingId, staffRole }:{ bookingId:number; staffRole:StaffRole }) {
  const [addenda,setAddenda] = useState<Addendum[]>([]);
  const [revisions,setRevisions] = useState<Revision[]>([]);
  const [baseVersion,setBaseVersion] = useState<number>(0);
  const [selectedId,setSelectedId] = useState("");
  const [reason,setReason] = useState("");
  const [correctionText,setCorrectionText] = useState("");
  const [newReason,setNewReason] = useState("");
  const [newText,setNewText] = useState("");
  const [loading,setLoading] = useState(true);
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState("");
  const [success,setSuccess] = useState("");

  const selected = useMemo(
    () => addenda.find((item)=>item.id === selectedId) || null,
    [addenda,selectedId],
  );
  const selectedRevisions = useMemo(
    () => revisions.filter((revision)=>revision.addendumId === selectedId),
    [revisions,selectedId],
  );

  function applySelection(item:Addendum | null) {
    setSelectedId(item?.id || "");
    setReason(item?.reason || "");
    setCorrectionText(item?.correctionText || "");
  }

  async function load(preferredId?:string) {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/staff/protocols/addenda?bookingId=${bookingId}`, { cache:"no-store" });
      const data = await response.json() as ApiPayload;
      if (!response.ok) {
        setError(data.error || "Не вдалося завантажити виправлення");
        return;
      }
      const next = data.addenda || [];
      setAddenda(next);
      setRevisions(data.revisions || []);
      setBaseVersion(Number(data.baseProtocol?.version || 0));
      const keep = preferredId || selectedId;
      const chosen = next.find((item)=>item.id === keep) || next.at(-1) || null;
      applySelection(chosen);
    } catch {
      setError("Помилка мережі під час завантаження виправлень");
    } finally {
      setLoading(false);
    }
  }

  useEffect(()=>{
    setSelectedId("");
    setReason("");
    setCorrectionText("");
    setNewReason("");
    setNewText("");
    const timer = window.setTimeout(()=>{ void load(); },0);
    return ()=>window.clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[bookingId]);

  async function createAddendum() {
    setError(""); setSuccess("");
    if (!newReason.trim() || !newText.trim()) {
      setError("Вкажіть причину і текст виправлення.");
      return;
    }
    setBusy(true);
    try {
      const response = await fetch("/api/staff/protocols/addenda", {
        method:"POST",
        headers:{ "content-type":"application/json" },
        body:JSON.stringify({ bookingId, reason:newReason, correctionText:newText }),
      });
      const data = await response.json() as { addendum?:Addendum; error?:string };
      if (!response.ok || !data.addendum) {
        setError(data.error || "Не вдалося створити виправлення");
        return;
      }
      setNewReason(""); setNewText("");
      setSuccess("Чернетку виправлення створено. Оригінальний виданий протокол не змінено.");
      await load(data.addendum.id);
    } catch {
      setError("Помилка мережі під час створення виправлення");
    } finally {
      setBusy(false);
    }
  }

  async function transition(status:AddendumStatus) {
    if (!selected) return;
    setError(""); setSuccess(""); setBusy(true);
    try {
      const response = await fetch("/api/staff/protocols/addenda", {
        method:"PUT",
        headers:{ "content-type":"application/json" },
        body:JSON.stringify({
          id:selected.id,
          baseVersion:selected.version,
          reason,
          correctionText,
          status,
        }),
      });
      const data = await response.json() as { addendum?:Addendum; error?:string };
      if (!response.ok || !data.addendum) {
        setError(data.error || "Не вдалося змінити виправлення");
        if (response.status === 409) await load(selected.id);
        return;
      }
      setSuccess(
        status === "issued" ? "Виправлення видано пацієнту."
          : status === "signed" ? "Виправлення підписано лікарем-рентгенологом і заблоковано від редагування."
            : status === "ready" ? "Виправлення готове до підпису."
              : "Чернетку виправлення збережено.",
      );
      await load(data.addendum.id);
    } catch {
      setError("Помилка мережі під час збереження виправлення");
    } finally {
      setBusy(false);
    }
  }

  const locked = selected?.status === "signed" || selected?.status === "issued";
  const canSign = staffRole === "radiologist" && selected?.status === "ready";
  const canIssue = (staffRole === "radiologist" || staffRole === "admin") && selected?.status === "signed";

  return <section className={styles.panel} aria-labelledby="protocol-addenda-title">
    <header className={styles.head}>
      <div>
        <p className={styles.eyebrow}>Окремий медичний документ</p>
        <h3 id="protocol-addenda-title">Виправлення / доповнення</h3>
        <p>Виданий протокол залишається незмінним. Кожне виправлення має власні версії, підпис і окрему видачу пацієнту.</p>
      </div>
      <span className={styles.base}>Базовий протокол v{baseVersion || "—"}</span>
    </header>

    {error && <p className={styles.error} role="alert">{error}</p>}
    {success && <p className={styles.success} role="status">{success}</p>}
    {loading ? <p className={styles.muted}>Завантаження виправлень…</p> : <>
      <div className={styles.createBox}>
        <b>Створити нове виправлення</b>
        <label><span>Причина</span><input value={newReason} maxLength={500} disabled={busy}
          onChange={(event)=>setNewReason(event.target.value)} placeholder="Наприклад, уточнення сторони або формулювання"/></label>
        <label><span>Текст виправлення / доповнення</span><textarea value={newText} maxLength={12000} disabled={busy}
          onChange={(event)=>setNewText(event.target.value)} placeholder="Що саме слід читати замість/на додаток до виданого протоколу"/></label>
        <button type="button" onClick={()=>void createAddendum()} disabled={busy}>Створити чернетку</button>
      </div>

      {addenda.length === 0 ? <p className={styles.muted}>До цього протоколу ще немає виправлень.</p> : <div className={styles.workspace}>
        <nav className={styles.list} aria-label="Список виправлень">
          {addenda.map((item,index)=><button type="button" key={item.id}
            className={item.id === selectedId ? styles.activeItem : styles.item}
            onClick={()=>applySelection(item)}>
            <span>Виправлення №{index + 1}</span>
            <b>{statusLabels[item.status]}</b>
            <small>v{item.version} · {formatDateTime(item.updatedAt)}</small>
          </button>)}
        </nav>

        {selected && <div className={styles.editor}>
          <div className={styles.meta}>
            <span className={`${styles.status} ${styles[selected.status]}`}>{statusLabels[selected.status]}</span>
            <span>Версія {selected.version}</span>
            <span>База v{selected.baseProtocolVersion}</span>
            <span>Автор: {selected.authorEmail}</span>
          </div>
          {selected.signedBy && <p className={styles.signed}>Підпис: {selected.signedBy} · {formatDateTime(selected.signedAt)} · підписана v{selected.signedVersion}</p>}
          <label><span>Причина</span><input value={reason} maxLength={500} readOnly={locked || busy}
            onChange={(event)=>setReason(event.target.value)}/></label>
          <label><span>Текст виправлення / доповнення</span><textarea value={correctionText} maxLength={12000} readOnly={locked || busy}
            onChange={(event)=>setCorrectionText(event.target.value)}/></label>

          <div className={styles.actions}>
            {selected.status === "draft" && <>
              <button type="button" disabled={busy} onClick={()=>void transition("draft")}>Зберегти чернетку</button>
              <button type="button" disabled={busy} onClick={()=>void transition("ready")}>Готове до підпису</button>
            </>}
            {selected.status === "ready" && <button type="button" disabled={busy} onClick={()=>void transition("ready")}>Зберегти зміни</button>}
            {canSign && <button type="button" className={styles.primary} disabled={busy} onClick={()=>void transition("signed")}>Підписати виправлення</button>}
            {selected.status === "ready" && staffRole === "admin" && <span className={styles.muted}>Підпис доступний лише лікарю-рентгенологу.</span>}
            {canIssue && <button type="button" className={styles.primary} disabled={busy} onClick={()=>void transition("issued")}>Видати пацієнту</button>}
          </div>

          <details className={styles.history}>
            <summary>Історія версій ({selectedRevisions.length})</summary>
            {selectedRevisions.length === 0 ? <p className={styles.muted}>Історія відсутня.</p> : <ol>
              {selectedRevisions.map((revision)=><li key={revision.id}>
                <b>v{revision.version} · {statusLabels[revision.status]}</b>
                <span>{formatDateTime(revision.createdAt)} · {revision.savedBy}</span>
                <small>{revision.reason}</small>
              </li>)}
            </ol>}
          </details>
        </div>}
      </div>}
    </>}
  </section>;
}
