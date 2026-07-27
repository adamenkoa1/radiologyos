"use client";

import { useEffect, useMemo, useState } from "react";
import StaffWorkspaceShell from "../workspace-shell";
import {
  STUDY_STATUS_LABELS,
  STUDY_STATUSES,
  type DicomSeries,
  type StudyStatus,
  viewerUrl,
} from "../../../lib/dicom";

type StaffRole = "admin" | "registrar" | "radiologist" | "radiographer";
type StaffInfo = { email:string; displayName:string; role:StaffRole };
type Settings = { enabled:boolean; viewerBaseUrl:string; aeTitle:string; dicomwebConfigured:boolean };
type FullSettings = { dicomwebBaseUrl:string; viewerBaseUrl:string; aeTitle:string; enabled:number; notes:string; updatedBy:string; updatedAt:string };
type WorklistItem = {
  id:number; code:string; name:string; service:string; serviceTitle:string; serviceCode:string;
  equipmentId:string; desiredDate:string; desiredTime:string; performedAt:string; status:string;
  studyStatus:StudyStatus; accessionNumber:string; studyInstanceUid:string; seriesCount:number;
};
type StudyRecord = {
  bookingId:number; accessionNumber:string; studyInstanceUid:string; modality:string;
  seriesCount:number; instancesCount:number; studyStatus:StudyStatus; studyDatetime:string;
  updatedBy:string; updatedAt:string;
};
type BookingRef = {
  id:number; code:string; name:string; service:string; serviceCode:string;
  equipmentId:string; desiredDate:string; desiredTime:string; performedAt:string;
};
type Card = { booking:BookingRef; study:StudyRecord | null; series:DicomSeries[]; pacsReachable:boolean; settings:Settings };

const roleLabels: Record<StaffRole,string> = {
  admin:"Адміністратор", registrar:"Реєстратор",
  radiologist:"Лікар-рентгенолог", radiographer:"Рентгенолаборант",
};

function formatDateTime(value:string) {
  if (!value) return "—";
  const parsed = new Date(value.includes("T") || value.includes(" ") ? value : `${value}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString("uk-UA");
}

export default function ImagingPage() {
  const [worklist,setWorklist] = useState<WorklistItem[]>([]);
  const [staff,setStaff] = useState<StaffInfo | null>(null);
  const [settings,setSettings] = useState<Settings>({ enabled:false, viewerBaseUrl:"", aeTitle:"", dicomwebConfigured:false });
  const [fullSettings,setFullSettings] = useState<FullSettings | null>(null);
  const [selectedId,setSelectedId] = useState<number | null>(null);
  const [card,setCard] = useState<Card | null>(null);
  const [error,setError] = useState("");
  const [actionError,setActionError] = useState("");
  const [actionSuccess,setActionSuccess] = useState("");
  const [saving,setSaving] = useState(false);
  const [filter,setFilter] = useState<"all"|"not_linked"|"available">("all");
  const [query,setQuery] = useState("");

  async function loadWorklist() {
    const response = await fetch("/api/staff/imaging", { cache:"no-store" });
    const data = await response.json() as { worklist?:WorklistItem[]; settings?:Settings; staff?:StaffInfo; error?:string };
    if (!response.ok) { setError(data.error || "Немає доступу"); return; }
    setWorklist(data.worklist || []);
    setStaff(data.staff || null);
    if (data.settings) setSettings(data.settings);
    setError("");
    if (data.staff?.role === "admin") void loadSettings();
  }

  async function loadSettings() {
    const response = await fetch("/api/staff/imaging/settings", { cache:"no-store" });
    const data = await response.json() as { settings?:FullSettings; error?:string };
    if (response.ok && data.settings) setFullSettings(data.settings);
  }

  useEffect(() => {
    const timer = window.setTimeout(() => { void loadWorklist(); }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!worklist.length || selectedId !== null) return;
    const open = Number(new URLSearchParams(window.location.search).get("open"));
    if (Number.isInteger(open) && open > 0 && worklist.some((item) => item.id === open)) void openBooking(open);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [worklist]);

  async function openBooking(id:number) {
    setActionError(""); setActionSuccess(""); setSelectedId(id); setCard(null);
    const response = await fetch(`/api/staff/imaging?bookingId=${id}`, { cache:"no-store" });
    const data = await response.json() as Card & { error?:string };
    if (!response.ok || !data.booking) { setActionError(data.error || "Не вдалося відкрити дослідження"); return; }
    setCard(data);
    if (data.settings) setSettings(data.settings);
  }

  async function saveStudy(form:HTMLFormElement) {
    if (!card) return;
    setActionError(""); setActionSuccess(""); setSaving(true);
    const data = new FormData(form);
    const payload = {
      bookingId:card.booking.id,
      accessionNumber:String(data.get("accessionNumber") || ""),
      studyInstanceUid:String(data.get("studyInstanceUid") || ""),
      modality:String(data.get("modality") || ""),
      studyStatus:String(data.get("studyStatus") || "not_linked"),
    };
    const response = await fetch("/api/staff/imaging", {
      method:"PUT", headers:{"content-type":"application/json"}, body:JSON.stringify(payload),
    });
    const result = await response.json() as { ok?:boolean; study?:StudyRecord; error?:string };
    setSaving(false);
    if (!response.ok || !result.ok || !result.study) { setActionError(result.error || "Не вдалося зберегти дослідження"); return; }
    setCard((current) => current && ({ ...current, study:{ ...(current.study || {} as StudyRecord), ...result.study! } }));
    setWorklist((current) => current.map((item) => item.id === card.booking.id ? {
      ...item, studyStatus:payload.studyStatus as StudyStatus,
      accessionNumber:payload.accessionNumber, studyInstanceUid:payload.studyInstanceUid,
    } : item));
    setActionSuccess("Дослідження прив’язано. Оновіть картку, щоб підтягнути серії з PACS.");
  }

  async function saveSettings(form:HTMLFormElement) {
    setActionError(""); setActionSuccess(""); setSaving(true);
    const data = new FormData(form);
    const response = await fetch("/api/staff/imaging/settings", {
      method:"PUT", headers:{"content-type":"application/json"},
      body:JSON.stringify({
        dicomwebBaseUrl:String(data.get("dicomwebBaseUrl") || ""),
        viewerBaseUrl:String(data.get("viewerBaseUrl") || ""),
        aeTitle:String(data.get("aeTitle") || ""),
        notes:String(data.get("notes") || ""),
        enabled:data.get("enabled") === "on",
      }),
    });
    const result = await response.json() as { ok?:boolean; settings?:FullSettings; error?:string };
    setSaving(false);
    if (!response.ok || !result.ok || !result.settings) { setActionError(result.error || "Не вдалося зберегти налаштування"); return; }
    setFullSettings(result.settings);
    setSettings({
      enabled:!!result.settings.enabled, viewerBaseUrl:result.settings.viewerBaseUrl,
      aeTitle:result.settings.aeTitle, dicomwebConfigured:!!result.settings.dicomwebBaseUrl,
    });
    setActionSuccess("Налаштування PACS збережено.");
  }

  const canEdit = staff?.role === "admin" || staff?.role === "radiographer" || staff?.role === "radiologist";
  const isAdmin = staff?.role === "admin";

  const visible = useMemo(() => worklist
    .filter((item) => filter === "all" || (filter === "not_linked" ? item.studyStatus === "not_linked" : item.studyStatus === "available"))
    .filter((item) => !query.trim() || `${item.code} ${item.name} ${item.serviceTitle} ${item.accessionNumber}`.toLowerCase().includes(query.trim().toLowerCase())),
  [worklist,filter,query]);
  const counts = useMemo(() => ({
    all:worklist.length,
    not_linked:worklist.filter((item) => item.studyStatus === "not_linked").length,
    available:worklist.filter((item) => item.studyStatus === "available").length,
  }), [worklist]);

  const launchUrl = card?.study?.studyInstanceUid ? viewerUrl(settings.viewerBaseUrl, card.study.studyInstanceUid) : "";

  return <StaffWorkspaceShell
    active="imaging"
    title="Знімки та DICOM/PACS"
    description="Прив’язка досліджень до DICOM-студій, запуск у переглядачі та серії з PACS через DICOMweb."
    staffName={staff?.displayName || staff?.email}
    staffRole={staff ? roleLabels[staff.role] : undefined}
  >
    {error ? <section className="accessDenied"><b>Захищений розділ</b><p>{error}. Увійдіть через дозволений робочий обліковий запис.</p><a className="button compact" href="/signin-with-chatgpt?returnTo=%2Fstaff%2Fimaging">Увійти для роботи</a></section> :
    <>
      <div className={`pacsBanner${settings.enabled ? " on":""}`}>
        <span className="pacsDot" aria-hidden="true"/>
        <b>{settings.enabled ? "PACS підключено" : "PACS не підключено"}</b>
        <small>{settings.enabled
          ? `DICOMweb активний${settings.aeTitle ? ` · AE ${settings.aeTitle}` : ""}. Серії підтягуються автоматично.`
          : "Прив’язку дослідження можна зберігати вже зараз; серії й переглядач запрацюють після налаштування адміністратором."}</small>
      </div>

      <div className="protocolWorkspace">
        <aside className="protocolQueue" aria-label="Робочий список досліджень">
          <div className="protocolQueueTools">
            <div className="protocolFilterTabs" role="tablist">
              <button role="tab" aria-selected={filter==="all"} className={filter==="all"?"active":""} onClick={()=>setFilter("all")}>Усі <b>{counts.all}</b></button>
              <button role="tab" aria-selected={filter==="not_linked"} className={filter==="not_linked"?"active":""} onClick={()=>setFilter("not_linked")}>Без студії <b>{counts.not_linked}</b></button>
              <button role="tab" aria-selected={filter==="available"} className={filter==="available"?"active":""} onClick={()=>setFilter("available")}>У PACS <b>{counts.available}</b></button>
            </div>
            <input type="search" value={query} onChange={(e)=>setQuery(e.target.value)} placeholder="Код, ПІБ, Accession"/>
          </div>
          <div className="protocolQueueList">
            {visible.length === 0 ? <p className="empty">Досліджень у цій категорії немає.</p> : visible.map((item)=><button
              key={item.id}
              className={`protocolQueueItem${selectedId===item.id?" active":""}`}
              onClick={()=>void openBooking(item.id)}
            >
              <span className={`protocolTag ${item.studyStatus==="available"?"ready":item.studyStatus==="archived"?"issued":item.studyStatus==="scheduled"?"in_progress":""}`}>{STUDY_STATUS_LABELS[item.studyStatus]}</span>
              <b>{item.serviceTitle}</b>
              <small>{item.code} · {item.name}</small>
              <small>{item.accessionNumber ? `Accession ${item.accessionNumber}` : item.performedAt ? `Виконано ${formatDateTime(item.performedAt)}` : `${item.desiredDate} ${item.desiredTime}`}{item.seriesCount ? ` · ${item.seriesCount} серій` : ""}</small>
            </button>)}
          </div>
        </aside>

        <section className="protocolEditor">
          {actionError && <p className="staffError" role="alert">{actionError}</p>}
          {actionSuccess && <p className="staffSuccess" role="status">{actionSuccess}</p>}

          {!card || !selectedId ? <div className="protocolPlaceholder">
            <span aria-hidden="true">▦</span>
            <b>Оберіть дослідження зі списку</b>
            <p>Прив’яжіть дослідження до DICOM-студії, відкрийте його у переглядачі та перегляньте серії з PACS.</p>
          </div> : <>
            <header className="protocolEditorHead">
              <div>
                <p className="eyebrow">DICOM · {card.study?.studyStatus ? STUDY_STATUS_LABELS[card.study.studyStatus] : "не прив’язано"}</p>
                <h2>{card.booking.service}</h2>
                <p>{card.booking.code} · {card.booking.name}</p>
                <p className="protocolMeta">{card.booking.performedAt ? `Виконано: ${formatDateTime(card.booking.performedAt)}` : `Заплановано: ${card.booking.desiredDate} ${card.booking.desiredTime}`}{card.study?.updatedBy ? ` · Оновив: ${card.study.updatedBy}` : ""}</p>
              </div>
              <button type="button" className="pacsViewerButton" disabled={!launchUrl} onClick={()=>launchUrl && window.open(launchUrl, "_blank", "noopener")}>Відкрити у переглядачі ↗</button>
            </header>

            <fieldset className="protocolFields" disabled={!canEdit || saving}>
              <form onSubmit={(e)=>{e.preventDefault();void saveStudy(e.currentTarget);}}>
                <div className="pacsFormGrid">
                  <label><span>Accession Number</span><input name="accessionNumber" maxLength={64} defaultValue={card.study?.accessionNumber || ""} placeholder="Напр. A2026-0001"/></label>
                  <label><span>Модальність</span><input name="modality" maxLength={16} defaultValue={card.study?.modality || (card.booking.equipmentId==="ct"?"CT":"DX")} placeholder="CT, DX, CR…"/></label>
                  <label className="pacsWide"><span>StudyInstanceUID</span><input name="studyInstanceUid" maxLength={64} defaultValue={card.study?.studyInstanceUid || ""} placeholder="1.2.840.113619.2…"/></label>
                  <label><span>Статус</span><select name="studyStatus" defaultValue={card.study?.studyStatus || "not_linked"}>{STUDY_STATUSES.map((status)=><option key={status} value={status}>{STUDY_STATUS_LABELS[status]}</option>)}</select></label>
                  <div className="pacsFormActions"><button type="submit">Зберегти прив’язку</button><button type="button" className="ghost" onClick={()=>void openBooking(card.booking.id)}>Оновити з PACS</button></div>
                </div>
              </form>
            </fieldset>
            {!canEdit && <p className="protocolReadonlyHint">Режим перегляду. Прив’язувати студії можуть лаборант, лікар або адміністратор.</p>}

            <section className="pacsSeries">
              <h3>Серії дослідження {card.series.length ? `(${card.series.length})` : ""}</h3>
              {card.series.length === 0 ? <p className="empty">
                {!settings.enabled ? "PACS не підключено — серії з’являться після налаштування DICOMweb."
                  : !card.study?.studyInstanceUid ? "Вкажіть StudyInstanceUID, щоб підтягнути серії."
                  : !card.pacsReachable ? "PACS недоступний або дослідження ще не надійшло. Спробуйте оновити пізніше."
                  : "Серій за цим дослідженням не знайдено."}
              </p> : <table className="pacsSeriesTable">
                <thead><tr><th>№</th><th>Модальність</th><th>Опис</th><th>Зображень</th></tr></thead>
                <tbody>{card.series.map((series)=><tr key={series.seriesInstanceUid}>
                  <td>{series.seriesNumber || "—"}</td><td>{series.modality || "—"}</td>
                  <td>{series.description || "—"}</td><td>{series.instances || "—"}</td>
                </tr>)}</tbody>
              </table>}
            </section>
          </>}
        </section>
      </div>

      {isAdmin && <details className="pacsSettings">
        <summary>Налаштування PACS / DICOMweb (адміністратор)</summary>
        <form onSubmit={(e)=>{e.preventDefault();void saveSettings(e.currentTarget);}}>
          <label className="pacsWide"><span>DICOMweb базова адреса (QIDO-RS/WADO-RS)</span><input name="dicomwebBaseUrl" defaultValue={fullSettings?.dicomwebBaseUrl || ""} placeholder="https://pacs.example.org/dicom-web"/></label>
          <label className="pacsWide"><span>Адреса переглядача (можна з {"{study}"})</span><input name="viewerBaseUrl" defaultValue={fullSettings?.viewerBaseUrl || ""} placeholder="https://viewer.example.org/viewer"/></label>
          <label><span>AE Title</span><input name="aeTitle" maxLength={16} defaultValue={fullSettings?.aeTitle || ""} placeholder="RADIOLOGYOS"/></label>
          <label className="pacsCheck"><input name="enabled" type="checkbox" defaultChecked={!!fullSettings?.enabled}/><span>Увімкнути інтеграцію (підтягувати серії)</span></label>
          <label className="pacsWide"><span>Примітки</span><textarea name="notes" maxLength={500} defaultValue={fullSettings?.notes || ""} placeholder="Внутрішні примітки щодо підключення"/></label>
          <button type="submit" disabled={saving}>Зберегти налаштування</button>
        </form>
        <p className="pacsSettingsHint">Дані пацієнтів не зберігаються в цьому модулі — RadiologyOS лише прив’язує ідентифікатори дослідження та звертається до PACS через стандарт DICOMweb.</p>
      </details>}
    </>}
  </StaffWorkspaceShell>;
}
