"use client";

import { useEffect, useMemo, useState } from "react";
import StaffWorkspaceShell from "../workspace-shell";
import {
  PROTOCOL_STATUS_LABELS,
  PROTOCOL_TEMPLATES,
  type ProtocolDocument,
  type ProtocolStatus,
  normalDocument,
  protocolTemplateByKey,
  renderProtocolText,
  suggestTemplateKey,
} from "../../../lib/protocols";
import type { ProtocolDraft } from "../../../lib/ai";

type StaffRole = "admin" | "registrar" | "radiologist" | "radiographer";
type StaffInfo = { email:string; displayName:string; role:StaffRole };

type QueueItem = {
  id:number; code:string; name:string; service:string; serviceTitle:string; serviceCode:string;
  equipmentId:string; desiredDate:string; desiredTime:string; performedAt:string; status:string;
  protocolNumber:string; protocolStatus:string; protocolReadyAt:string; protocolIssuedAt:string;
  assignedRadiologistEmail:string; documentStatus:string; documentVersion:number;
};
type BookingDetail = {
  id:number; code:string; name:string; service:string; serviceCode:string; equipmentId:string;
  desiredDate:string; desiredTime:string; patientCategory:string; performedAt:string;
  anatomicalRegionsCount:number; protocolNumber:string; protocolStatus:string;
  protocolReadyAt:string; protocolIssuedAt:string; assignedRadiologistEmail:string;
};
type EditorDoc = ProtocolDocument & { version:number; updatedBy:string; updatedAt:string };

const roleLabels: Record<StaffRole,string> = {
  admin:"Адміністратор", registrar:"Реєстратор",
  radiologist:"Лікар-рентгенолог", radiographer:"Рентгенолаборант",
};
const bookingProtocolLabels: Record<string,string> = {
  not_started:"Не розпочато", in_progress:"В роботі", ready:"Готовий", issued:"Видано",
};
const categoryLabels: Record<string,string> = { civilian:"Цивільний маршрут", military:"Військовий маршрут" };

function formatDateTime(value:string) {
  if (!value) return "—";
  const parsed = new Date(value.includes("T") || value.includes(" ") ? value : `${value}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString("uk-UA");
}

function emptyDoc(serviceCode:string):EditorDoc {
  return { ...normalDocument(suggestTemplateKey(serviceCode)), version:0, updatedBy:"", updatedAt:"" };
}

export default function ProtocolsPage() {
  const [queue,setQueue] = useState<QueueItem[]>([]);
  const [staff,setStaff] = useState<StaffInfo | null>(null);
  const [selectedId,setSelectedId] = useState<number | null>(null);
  const [booking,setBooking] = useState<BookingDetail | null>(null);
  const [doc,setDoc] = useState<EditorDoc | null>(null);
  const [error,setError] = useState("");
  const [actionError,setActionError] = useState("");
  const [actionSuccess,setActionSuccess] = useState("");
  const [saving,setSaving] = useState(false);
  const [aiDraft,setAiDraft] = useState<ProtocolDraft | null>(null);
  const [aiLoading,setAiLoading] = useState(false);
  const [filter,setFilter] = useState<"awaiting"|"ready"|"issued"|"all">("awaiting");
  const [query,setQuery] = useState("");

  async function loadQueue() {
    const response = await fetch("/api/staff/protocols", { cache:"no-store" });
    const data = await response.json() as { queue?:QueueItem[]; staff?:StaffInfo; error?:string };
    if (!response.ok) { setError(data.error || "Немає доступу"); return; }
    setQueue(data.queue || []);
    setStaff(data.staff || null);
    setError("");
  }

  useEffect(() => {
    const timer = window.setTimeout(() => { void loadQueue(); }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!queue.length || selectedId !== null) return;
    const open = Number(new URLSearchParams(window.location.search).get("open"));
    if (Number.isInteger(open) && open > 0 && queue.some((item) => item.id === open)) void openBooking(open);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queue]);

  async function openBooking(id:number) {
    setActionError(""); setActionSuccess(""); setSelectedId(id); setBooking(null); setDoc(null); setAiDraft(null);
    const response = await fetch(`/api/staff/protocols?bookingId=${id}`, { cache:"no-store" });
    const data = await response.json() as {
      booking?:BookingDetail; protocol?:(EditorDoc | null); error?:string;
    };
    if (!response.ok || !data.booking) { setActionError(data.error || "Не вдалося відкрити протокол"); return; }
    setBooking(data.booking);
    setDoc(data.protocol
      ? {
          templateKey:data.protocol.templateKey, method:data.protocol.method,
          sections:data.protocol.sections || {}, findings:data.protocol.findings,
          conclusion:data.protocol.conclusion, recommendations:data.protocol.recommendations,
          number:data.protocol.number, status:data.protocol.status,
          version:data.protocol.version, updatedBy:data.protocol.updatedBy, updatedAt:data.protocol.updatedAt,
        }
      : emptyDoc(data.booking.serviceCode));
  }

  function setSectionField(sectionKey:string,fieldKey:string,value:string) {
    setDoc((current) => current && ({
      ...current,
      sections:{ ...current.sections, [sectionKey]:{ ...(current.sections[sectionKey] || {}), [fieldKey]:value } },
    }));
  }

  function changeTemplate(templateKey:string) {
    setDoc((current) => {
      if (!current) return current;
      const template = protocolTemplateByKey(templateKey);
      return {
        ...current,
        templateKey,
        method:current.method.trim() ? current.method : template.method,
      };
    });
  }

  function fillNorms() {
    setDoc((current) => {
      if (!current) return current;
      const template = protocolTemplateByKey(current.templateKey);
      const sections = { ...current.sections };
      for (const section of template.sections) {
        const values = { ...(sections[section.key] || {}) };
        for (const field of section.fields) if (field.normal && !values[field.key]?.trim()) values[field.key] = field.normal;
        sections[section.key] = values;
      }
      return { ...current, method:current.method.trim() ? current.method : template.method, sections };
    });
    setActionSuccess("Поля заповнено типовими формулюваннями норми. Відредагуйте виявлені зміни.");
  }

  async function save(status:ProtocolStatus) {
    if (!doc || !booking) return;
    setActionError(""); setActionSuccess("");
    if ((status === "ready" || status === "issued") && !doc.number.trim()) {
      setActionError("Для готового або виданого протоколу вкажіть його номер."); return;
    }
    if ((status === "ready" || status === "issued") && !doc.conclusion.trim()) {
      setActionError("Готовий протокол повинен містити висновок."); return;
    }
    setSaving(true);
    const response = await fetch("/api/staff/protocols", {
      method:"PUT", headers:{"content-type":"application/json"},
      body:JSON.stringify({ bookingId:booking.id, ...doc, status }),
    });
    const data = await response.json() as {
      ok?:boolean; version?:number; protocolStatus?:string; protocolNumber?:string;
      protocolReadyAt?:string; protocolIssuedAt?:string; error?:string;
    };
    setSaving(false);
    if (!response.ok || !data.ok) { setActionError(data.error || "Не вдалося зберегти протокол"); return; }
    setDoc((current) => current && ({ ...current, status, version:data.version || current.version, updatedBy:staff?.email || current.updatedBy }));
    setBooking((current) => current && ({
      ...current,
      protocolNumber:data.protocolNumber ?? current.protocolNumber,
      protocolStatus:data.protocolStatus ?? current.protocolStatus,
      protocolReadyAt:data.protocolReadyAt ?? current.protocolReadyAt,
      protocolIssuedAt:data.protocolIssuedAt ?? current.protocolIssuedAt,
    }));
    setQueue((current) => current.map((item) => item.id === booking.id ? {
      ...item,
      protocolNumber:data.protocolNumber ?? item.protocolNumber,
      protocolStatus:data.protocolStatus ?? item.protocolStatus,
      protocolReadyAt:data.protocolReadyAt ?? item.protocolReadyAt,
      protocolIssuedAt:data.protocolIssuedAt ?? item.protocolIssuedAt,
      documentStatus:status, documentVersion:data.version || item.documentVersion,
    } : item));
    setActionSuccess(status === "issued" ? "Протокол видано." : status === "ready" ? "Протокол позначено готовим." : "Чернетку протоколу збережено.");
  }

  async function copyText() {
    if (!doc) return;
    try {
      await navigator.clipboard.writeText(renderProtocolText(doc));
      setActionSuccess("Текст протоколу скопійовано.");
    } catch {
      setActionError("Не вдалося скопіювати текст.");
    }
  }

  async function generateDraft() {
    if (!doc || !booking) return;
    setActionError(""); setActionSuccess(""); setAiLoading(true);
    const response = await fetch("/api/staff/ai/protocol-draft", {
      method:"POST", headers:{"content-type":"application/json"},
      body:JSON.stringify({ bookingId:booking.id, ...doc }),
    });
    const data = await response.json() as { ok?:boolean; draft?:ProtocolDraft; error?:string };
    setAiLoading(false);
    if (!response.ok || !data.draft) { setActionError(data.error || "Не вдалося сформувати чернетку"); return; }
    setAiDraft(data.draft);
  }

  function applyDraft(part:"conclusion"|"recommendations"|"all") {
    if (!aiDraft) return;
    setDoc((current) => current && ({
      ...current,
      conclusion:part === "recommendations" ? current.conclusion : aiDraft.conclusion,
      recommendations:part === "conclusion" ? current.recommendations : aiDraft.recommendations,
    }));
    setActionSuccess("AI-чернетку вставлено. Перевірте та відредагуйте перед видачею.");
  }

  const canEdit = staff?.role === "admin" || staff?.role === "radiologist";
  const template = doc ? protocolTemplateByKey(doc.templateKey) : null;

  const visible = useMemo(() => queue
    .filter((item) => {
      if (filter === "awaiting") return item.protocolStatus !== "ready" && item.protocolStatus !== "issued";
      if (filter === "ready") return item.protocolStatus === "ready";
      if (filter === "issued") return item.protocolStatus === "issued";
      return true;
    })
    .filter((item) => !query.trim() || `${item.code} ${item.name} ${item.serviceTitle} ${item.serviceCode}`.toLowerCase().includes(query.trim().toLowerCase())),
  [queue,filter,query]);

  const counts = useMemo(() => ({
    awaiting:queue.filter((item) => item.protocolStatus !== "ready" && item.protocolStatus !== "issued").length,
    ready:queue.filter((item) => item.protocolStatus === "ready").length,
    issued:queue.filter((item) => item.protocolStatus === "issued").length,
  }), [queue]);

  return <StaffWorkspaceShell
    active="protocols"
    title="Конструктор протоколів"
    description="Структуровані протоколи досліджень за модальностями: заповнення полів, висновок, видача та друк."
    staffName={staff?.displayName || staff?.email}
    staffRole={staff ? roleLabels[staff.role] : undefined}
  >
    {error ? <section className="accessDenied"><b>Захищений розділ</b><p>{error}. Увійдіть через дозволений робочий обліковий запис.</p><a className="button compact" href="/signin-with-chatgpt?returnTo=%2Fstaff%2Fprotocols">Увійти для роботи</a></section> :
    <div className="protocolWorkspace">
      <aside className="protocolQueue" aria-label="Черга протоколів">
        <div className="protocolQueueTools">
          <div className="protocolFilterTabs" role="tablist">
            <button role="tab" aria-selected={filter==="awaiting"} className={filter==="awaiting"?"active":""} onClick={()=>setFilter("awaiting")}>Очікують <b>{counts.awaiting}</b></button>
            <button role="tab" aria-selected={filter==="ready"} className={filter==="ready"?"active":""} onClick={()=>setFilter("ready")}>Готові <b>{counts.ready}</b></button>
            <button role="tab" aria-selected={filter==="issued"} className={filter==="issued"?"active":""} onClick={()=>setFilter("issued")}>Видані <b>{counts.issued}</b></button>
            <button role="tab" aria-selected={filter==="all"} className={filter==="all"?"active":""} onClick={()=>setFilter("all")}>Усі</button>
          </div>
          <input type="search" value={query} onChange={(e)=>setQuery(e.target.value)} placeholder="Код, ПІБ, дослідження"/>
        </div>
        <div className="protocolQueueList">
          {visible.length === 0 ? <p className="empty">Немає досліджень у цій категорії.</p> : visible.map((item) => <button
            key={item.id}
            className={`protocolQueueItem${selectedId === item.id ? " active":""}`}
            onClick={()=>void openBooking(item.id)}
          >
            <span className={`protocolTag ${item.protocolStatus}`}>{bookingProtocolLabels[item.protocolStatus] || item.protocolStatus}</span>
            <b>{item.serviceTitle}</b>
            <small>{item.code} · {item.name}</small>
            <small>{item.performedAt ? `Виконано ${formatDateTime(item.performedAt)}` : `Заплановано ${item.desiredDate} ${item.desiredTime}`}</small>
          </button>)}
        </div>
      </aside>

      <section className="protocolEditor">
        {actionError && <p className="staffError" role="alert">{actionError}</p>}
        {actionSuccess && <p className="staffSuccess" role="status">{actionSuccess}</p>}

        {!booking || !doc || !template ? <div className="protocolPlaceholder">
          <span aria-hidden="true">▤</span>
          <b>Оберіть дослідження зі списку</b>
          <p>Структурований протокол відкриється тут. Для нового дослідження шаблон підбереться автоматично за модальністю.</p>
        </div> : <>
          <header className="protocolEditorHead">
            <div>
              <p className="eyebrow">{template.modalityLabel} · {doc.version > 0 ? `версія ${doc.version}` : "нова чернетка"}</p>
              <h2>{booking.service}</h2>
              <p>{booking.code} · {booking.name} · {categoryLabels[booking.patientCategory] || booking.patientCategory}</p>
              <p className="protocolMeta">
                {booking.performedAt ? `Виконано: ${formatDateTime(booking.performedAt)}` : "Дослідження ще не виконано"}
                {" · "}Статус: {PROTOCOL_STATUS_LABELS[doc.status]}
                {doc.updatedBy && ` · Автор: ${doc.updatedBy}`}
              </p>
            </div>
            <span className={`protocolTag ${booking.protocolStatus}`}>{bookingProtocolLabels[booking.protocolStatus] || booking.protocolStatus}</span>
          </header>

          {!canEdit && <p className="protocolReadonlyHint">Режим перегляду. Редагувати протокол можуть лише лікар-рентгенолог або адміністратор.</p>}

          <fieldset className="protocolFields" disabled={!canEdit || saving}>
            <div className="protocolRow">
              <label className="wide"><span>Шаблон протоколу</span>
                <select value={doc.templateKey} onChange={(e)=>changeTemplate(e.target.value)}>
                  {PROTOCOL_TEMPLATES.map((tpl)=><option key={tpl.key} value={tpl.key}>{tpl.title}</option>)}
                </select>
              </label>
              <label><span>Номер протоколу</span>
                <input value={doc.number} maxLength={80} placeholder="Наприклад, КТ-2026-001"
                  onChange={(e)=>setDoc((c)=>c && ({...c,number:e.target.value}))}/>
              </label>
              <button type="button" className="protocolNormButton" onClick={fillNorms}>Заповнити норму</button>
            </div>

            <label className="protocolNarrative"><span>Методика</span>
              <textarea value={doc.method} maxLength={600} placeholder={template.method || "Опишіть методику дослідження"}
                onChange={(e)=>setDoc((c)=>c && ({...c,method:e.target.value}))}/>
            </label>

            {template.sections.map((section)=><div className="protocolSection" key={section.key}>
              <h3>{section.title}</h3>
              <div className="protocolSectionFields">
                {section.fields.map((field)=>{
                  const value = doc.sections[section.key]?.[field.key] || "";
                  const onChange = (v:string)=>setSectionField(section.key,field.key,v);
                  if (field.type === "select") return <label key={field.key}><span>{field.label}</span>
                    <select value={value} onChange={(e)=>onChange(e.target.value)}>
                      <option value="">—</option>
                      {(field.options || []).map((option)=><option key={option} value={option}>{option}</option>)}
                    </select></label>;
                  if (field.type === "text") return <label key={field.key} className="protocolFieldWide"><span>{field.label}</span>
                    <textarea value={value} maxLength={2000} placeholder={field.placeholder} onChange={(e)=>onChange(e.target.value)}/></label>;
                  return <label key={field.key}><span>{field.label}</span>
                    <input value={value} maxLength={2000} placeholder={field.placeholder} onChange={(e)=>onChange(e.target.value)}/></label>;
                })}
              </div>
            </div>)}

            <label className="protocolNarrative"><span>Опис (додатково)</span>
              <textarea value={doc.findings} maxLength={6000} placeholder="Вільний опис виявлених змін, що доповнює структуровані поля"
                onChange={(e)=>setDoc((c)=>c && ({...c,findings:e.target.value}))}/>
            </label>
            <label className="protocolNarrative"><span>Висновок</span>
              <textarea value={doc.conclusion} maxLength={6000} placeholder="Діагностичний висновок"
                onChange={(e)=>setDoc((c)=>c && ({...c,conclusion:e.target.value}))}/>
            </label>
            <label className="protocolNarrative"><span>Рекомендації</span>
              <textarea value={doc.recommendations} maxLength={6000} placeholder="Рекомендації щодо подальшого обстеження"
                onChange={(e)=>setDoc((c)=>c && ({...c,recommendations:e.target.value}))}/>
            </label>
          </fieldset>

          {canEdit && <section className="aiAssist">
            <div className="aiAssistHead">
              <div>
                <p className="eyebrow">AI-асистент</p>
                <b>Чернетка висновку зі структурованих полів</b>
                <small>Порівнює заповнені поля з нормою й пропонує проєкт висновку та рекомендацій.</small>
              </div>
              <button type="button" onClick={()=>void generateDraft()} disabled={aiLoading}>
                {aiLoading ? "Формування…" : "✨ Згенерувати чернетку"}
              </button>
            </div>
            {aiDraft && <div className="aiAssistResult">
              <p className="aiDisclaimer">{aiDraft.disclaimer}</p>
              <div className="aiDraftBlock">
                <div className="aiDraftBlockHead"><b>Запропонований висновок</b><button type="button" onClick={()=>applyDraft("conclusion")}>Вставити у висновок</button></div>
                <p>{aiDraft.conclusion}</p>
              </div>
              {aiDraft.recommendations && <div className="aiDraftBlock">
                <div className="aiDraftBlockHead"><b>Рекомендації</b><button type="button" onClick={()=>applyDraft("recommendations")}>Вставити рекомендації</button></div>
                <p>{aiDraft.recommendations}</p>
              </div>}
              <div className="aiDraftMeta">
                <span>Перевірено полів: {aiDraft.reviewedFieldCount}</span>
                <span>Відхилень від норми: {aiDraft.deviations.length}</span>
                <button type="button" className="primary" onClick={()=>applyDraft("all")}>Вставити висновок і рекомендації</button>
              </div>
              {aiDraft.deviations.length > 0 && <ul className="aiDeviations">
                {aiDraft.deviations.map((deviation)=><li key={`${deviation.section}-${deviation.field}`}><b>{deviation.label}:</b> {deviation.value}</li>)}
              </ul>}
            </div>}
          </section>}

          <div className="protocolActions">
            {canEdit && <>
              <button type="button" onClick={()=>void save("draft")} disabled={saving}>Зберегти чернетку</button>
              <button type="button" className="secondary" onClick={()=>void save("ready")} disabled={saving}>Позначити готовим</button>
              <button type="button" className="primary" onClick={()=>void save("issued")} disabled={saving}>Видати протокол</button>
            </>}
            <button type="button" className="ghost" onClick={()=>void copyText()}>Копіювати текст</button>
            <button type="button" className="ghost" onClick={()=>window.print()}>Друк / PDF</button>
          </div>

          <article className="protocolPrint" aria-hidden="true">
            <header>
              <b>Чернігівський військовий госпіталь</b>
              <span>Відділення променевої діагностики</span>
            </header>
            <h1>{template.title}</h1>
            {doc.number && <p className="protocolPrintNumber">Протокол № {doc.number}</p>}
            <dl className="protocolPrintPatient">
              <div><dt>Пацієнт</dt><dd>{booking.name}</dd></div>
              <div><dt>Код запису</dt><dd>{booking.code}</dd></div>
              <div><dt>Дослідження</dt><dd>{booking.service}</dd></div>
              <div><dt>Дата виконання</dt><dd>{booking.performedAt ? formatDateTime(booking.performedAt) : `${booking.desiredDate} ${booking.desiredTime}`}</dd></div>
            </dl>
            {(doc.method || template.method) && <section><h2>Методика</h2><p>{doc.method || template.method}</p></section>}
            {template.sections.map((section)=>{
              const rendered = section.fields
                .map((field)=>({ field, value:(doc.sections[section.key]?.[field.key] || "").trim() }))
                .filter((entry)=>entry.value);
              if (!rendered.length) return null;
              return <section key={section.key}><h2>{section.title}</h2>
                <dl>{rendered.map(({field,value})=><div key={field.key}><dt>{field.label}</dt><dd>{value}</dd></div>)}</dl>
              </section>;
            })}
            {doc.findings.trim() && <section><h2>Опис</h2><p>{doc.findings}</p></section>}
            {doc.conclusion.trim() && <section><h2>Висновок</h2><p>{doc.conclusion}</p></section>}
            {doc.recommendations.trim() && <section><h2>Рекомендації</h2><p>{doc.recommendations}</p></section>}
            <footer>
              <span>Лікар-рентгенолог: {booking.assignedRadiologistEmail || doc.updatedBy || "________________"}</span>
              <span>Статус: {PROTOCOL_STATUS_LABELS[doc.status]}</span>
            </footer>
          </article>
        </>}
      </section>
    </div>}
  </StaffWorkspaceShell>;
}
