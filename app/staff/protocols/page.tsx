"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import StaffWorkspaceShell from "../workspace-shell";
import {
  PROTOCOL_TEMPLATES,
  type ProtocolDocument,
  type ProtocolStatus,
  defaultMethodRef,
  isConditionMet,
  normalDocument,
  protocolTemplateByKey,
  renderProtocolText,
  suggestTemplateKey,
} from "../../../lib/protocols";
import {
  PROTOCOL_LIFECYCLE_STATUS_LABELS,
  type ProtocolLifecycleStatus,
} from "../../../lib/protocol-lifecycle";
import {
  composeFinding,
  insertComposedFinding,
  reviewProtocol,
  regionByKey,
  LATERALITY_LABEL,
  MEASUREMENT_META,
  type Laterality,
  type FindingSelection,
  type MeasurementInput,
  type MeasurementKind,
  type ComposedFinding,
  type ClinicalWarning,
} from "../../../lib/findings-composer";
import type { ProtocolDraft } from "../../../lib/ai";

type StaffRole = "admin" | "registrar" | "radiologist" | "radiographer";
type StaffInfo = { email:string; displayName:string; role:StaffRole };

type QueueItem = {
  id:number; code:string; name:string; service:string; serviceTitle:string; serviceCode:string;
  equipmentId:string; desiredDate:string; desiredTime:string; performedAt:string; status:string;
  protocolNumber:string; protocolStatus:string; protocolReadyAt:string; protocolIssuedAt:string;
  assignedRadiologistEmail:string; documentStatus:string; documentVersion:number;
  signedBy:string; signedAt:string; signedVersion:number;
};
type BookingDetail = {
  id:number; code:string; name:string; service:string; serviceCode:string; equipmentId:string;
  desiredDate:string; desiredTime:string; patientCategory:string; performedAt:string;
  anatomicalRegionsCount:number; protocolNumber:string; protocolStatus:string;
  protocolReadyAt:string; protocolIssuedAt:string; assignedRadiologistEmail:string;
};
type EditorDoc = Omit<ProtocolDocument,"status"> & {
  status:ProtocolLifecycleStatus; version:number; updatedBy:string; updatedAt:string;
  signedBy:string; signedAt:string; signedVersion:number;
};

const roleLabels: Record<StaffRole,string> = {
  admin:"Адміністратор", registrar:"Реєстратор",
  radiologist:"Лікар-рентгенолог", radiographer:"Рентгенлаборант",
};
const bookingProtocolLabels: Record<string,string> = {
  not_started:"Не розпочато", in_progress:"В роботі", ready:"Готовий", issued:"Видано",
};
const categoryLabels: Record<string,string> = { civilian:"Цивільний маршрут", military:"Військовий маршрут" };

function lifecycleLabel(status:string) {
  return PROTOCOL_LIFECYCLE_STATUS_LABELS[status as ProtocolLifecycleStatus]
    || bookingProtocolLabels[status]
    || status;
}

function formatDateTime(value:string) {
  if (!value) return "—";
  const parsed = new Date(value.includes("T") || value.includes(" ") ? value : `${value}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString("uk-UA");
}

function emptyDoc(serviceCode:string):EditorDoc {
  return {
    ...normalDocument(suggestTemplateKey(serviceCode)),
    version:0, updatedBy:"", updatedAt:"", signedBy:"", signedAt:"", signedVersion:0,
  };
}

export default function ProtocolsPage() {
  const [queue,setQueue] = useState<QueueItem[]>([]);
  const [staff,setStaff] = useState<StaffInfo | null>(null);
  const [selectedId,setSelectedId] = useState<number | null>(null);
  const [booking,setBooking] = useState<BookingDetail | null>(null);
  const [doc,setDoc] = useState<EditorDoc | null>(null);
  const [error,setError] = useState("");
  // Мережевий збій завантаження черги — щоб показати «Повторити», а не тиху
  // порожню чергу (яка виглядає як «роботи немає»).
  const [loadError,setLoadError] = useState(false);
  const [actionError,setActionError] = useState("");
  const [actionSuccess,setActionSuccess] = useState("");
  const [saving,setSaving] = useState(false);
  const [aiDraft,setAiDraft] = useState<ProtocolDraft | null>(null);
  const [aiLoading,setAiLoading] = useState(false);
  const [filter,setFilter] = useState<"awaiting"|"ready"|"signed"|"issued"|"all">("awaiting");
  const [query,setQuery] = useState("");
  const [bookingLoading,setBookingLoading] = useState(false);
  const [dirty,setDirty] = useState(false);
  // Жива панель прев'ю (Этап D2, §3): показ рендера протоколу в реальному часі.
  const [showPreview,setShowPreview] = useState(false);
  // Режим роботи (Этап D3, §6): суто ВІЗУАЛЬНА перевага. Перемикання ніколи не
  // стирає й не перезаписує поля — структуровані дані живуть у `doc` і при
  // поверненні в структурований режим показуються без втрат.
  const [mode,setMode] = useState<"quick"|"structured"|"free">("structured");
  // Персональні макроси лікаря (Этап D5b, §7): власні повторно вживані
  // формулювання, які вставляються (append) у вибране вільне поле.
  type Macro = { id:number; title:string; body:string };
  const [macros,setMacros] = useState<Macro[]>([]);
  const [macroTarget,setMacroTarget] = useState<"findings"|"conclusion"|"recommendations">("conclusion");
  const [macroTitle,setMacroTitle] = useState("");
  const [macroBody,setMacroBody] = useState("");
  const [macroError,setMacroError] = useState("");

  // Конструктор структурованих знахідок (Этап C): локальний стан вибору лікаря.
  // Складений текст ДОДАЄТЬСЯ у вільні поля опису/висновку, нічого не
  // перезаписуючи; lifecycle/підпис/API не зачіпаються.
  const [cTarget,setCTarget] = useState("");
  const [cFinding,setCFinding] = useState("");
  const [cLat,setCLat] = useState<Laterality>("right");
  const [cLobe,setCLobe] = useState("");
  const [cSeg,setCSeg] = useState("");
  const [cMeasures,setCMeasures] = useState<Record<string,string>>({});
  const [cMods,setCMods] = useState<string[]>([]);
  const [cError,setCError] = useState("");
  const [composed,setComposed] = useState<ComposedFinding[]>([]);

  function resetComposer() {
    setCTarget(""); setCFinding(""); setCLat("right"); setCLobe(""); setCSeg("");
    setCMeasures({}); setCMods([]); setCError(""); setComposed([]); setMode("structured");
  }

  // Знятий до ProtocolDocument вигляд EditorDoc (підписаний → ready для рендера).
  function docToProtocol(source:EditorDoc):ProtocolDocument {
    const status:ProtocolStatus = source.status === "signed" ? "ready" : source.status;
    return {
      templateKey:source.templateKey, method:source.method, methodRef:source.methodRef,
      sections:source.sections, findings:source.findings, conclusion:source.conclusion,
      recommendations:source.recommendations, number:source.number, status,
    };
  }

  function parseMeasures(raw:Record<string,string>, kinds:MeasurementKind[]):MeasurementInput {
    const out:MeasurementInput = {};
    for (const kind of kinds) {
      const str = (raw[kind] || "").trim().replace(/−/g,"-").replace(",",".");
      if (!str) continue;
      const value = Number(str);
      if (Number.isFinite(value)) out[kind] = value;
    }
    return out;
  }

  // Єдиний патч документа + позначка «є незбережені зміни».
  function patchDoc(partial:Partial<EditorDoc>) {
    setDoc((current) => current && ({ ...current, ...partial }));
    setDirty(true);
  }

  // background:true — тихе автооновлення черги: не показує екран помилки через
  // тимчасовий збій (лишає наявну чергу до наступної спроби).
  async function loadQueue({ background = false } = {}) {
    try {
      const response = await fetch("/api/staff/protocols", { cache:"no-store" });
      const data = await response.json() as { queue?:QueueItem[]; staff?:StaffInfo; error?:string };
      if (!response.ok) { if (!background) setError(data.error || "Немає доступу"); return; }
      setQueue(data.queue || []);
      setStaff(data.staff || null);
      setError(""); setLoadError(false);
    } catch {
      // Мережевий збій першого завантаження — явна помилка з «Повторити»,
      // а не мовчазна порожня черга.
      if (!background) setLoadError(true);
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => { void loadQueue(); void loadMacros(); }, 0);
    return () => window.clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Не оновлюємо у фоні під час збереження, відкриття протоколу чи генерації
  // AI-чернетки — щоб не смикати чергу під час активної роботи.
  const busyRef = useRef(false);
  useEffect(() => { busyRef.current = saving || bookingLoading || aiLoading; });

  // Жива черга «Очікують опису»: тихо оновлюємо ліву чергу кожні 45 с, тож нові
  // виконані дослідження зʼявляються без ручного перезавантаження. Правий
  // редактор має окремий стан і від фонового оновлення не страждає.
  useEffect(() => {
    const id = window.setInterval(() => {
      if (document.hidden || busyRef.current) return;
      void loadQueue({ background:true });
    }, 45000);
    return () => window.clearInterval(id);
  }, []);

  // Захист незбережених змін перед перемиканням на інший протокол.
  function selectBooking(id:number) {
    if (id === selectedId) return;
    if (dirty && !window.confirm("У поточному протоколі є незбережені зміни. Відкрити інший запис без збереження?")) return;
    void openBooking(id);
  }

  async function openBooking(id:number) {
    setActionError(""); setActionSuccess(""); setSelectedId(id); setBooking(null); setDoc(null); setAiDraft(null);
    setBookingLoading(true); setDirty(false); resetComposer();
    try {
      const response = await fetch(`/api/staff/protocols?bookingId=${id}`, { cache:"no-store" });
      const data = await response.json() as {
        booking?:BookingDetail; protocol?:(EditorDoc | null); error?:string;
      };
      if (!response.ok || !data.booking) { setActionError(data.error || "Не вдалося відкрити протокол"); return; }
      setBooking(data.booking);
      setDoc(data.protocol
        ? {
            templateKey:data.protocol.templateKey, method:data.protocol.method,
            methodRef:data.protocol.methodRef || "",
            sections:data.protocol.sections || {}, findings:data.protocol.findings,
            conclusion:data.protocol.conclusion, recommendations:data.protocol.recommendations,
            number:data.protocol.number, status:data.protocol.status,
            version:data.protocol.version, updatedBy:data.protocol.updatedBy, updatedAt:data.protocol.updatedAt,
            signedBy:data.protocol.signedBy || "", signedAt:data.protocol.signedAt || "",
            signedVersion:data.protocol.signedVersion || 0,
          }
        : emptyDoc(data.booking.serviceCode));
    } catch {
      setActionError("Помилка мережі — спробуйте ще раз");
    } finally {
      setBookingLoading(false);
    }
  }

  // Глибоке посилання ?open=<id> відкриває протокол одразу після завантаження черги.
  useEffect(() => {
    if (!queue.length || selectedId !== null) return;
    const open = Number(new URLSearchParams(window.location.search).get("open"));
    if (Number.isInteger(open) && open > 0 && queue.some((item) => item.id === open)) void openBooking(open);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queue]);

  // Захист незбережених змін при виході зі сторінки (закриття вкладки, «назад»,
  // перехід за лінком навігації). Перемикання між записами вже прикрите
  // window.confirm у selectBooking; тут покриваємо саме залишення сторінки, щоб
  // напівнаписаний протокол не губився тихо.
  useEffect(() => {
    if (!dirty) return;
    const handler = (event:BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  function setSectionField(sectionKey:string,fieldKey:string,value:string) {
    setDoc((current) => current && ({
      ...current,
      sections:{ ...current.sections, [sectionKey]:{ ...(current.sections[sectionKey] || {}), [fieldKey]:value } },
    }));
    setDirty(true);
  }

  function changeTemplate(templateKey:string) {
    setDoc((current) => {
      if (!current) return current;
      const template = protocolTemplateByKey(templateKey);
      return {
        ...current,
        templateKey,
        method:current.method.trim() ? current.method : template.method,
        methodRef:current.methodRef.trim() ? current.methodRef : (template.methodRef || defaultMethodRef(template.equipmentId)),
      };
    });
    setDirty(true);
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
      return {
        ...current,
        method:current.method.trim() ? current.method : template.method,
        methodRef:current.methodRef.trim() ? current.methodRef : (template.methodRef || defaultMethodRef(template.equipmentId)),
        sections,
      };
    });
    setDirty(true);
    setActionSuccess("Поля заповнено типовими формулюваннями норми. Відредагуйте виявлені зміни.");
  }

  async function save(status:ProtocolLifecycleStatus) {
    if (!doc || !booking) return;
    setActionError(""); setActionSuccess("");
    if ((status === "ready" || status === "signed" || status === "issued") && !doc.number.trim()) {
      setActionError("Для готового, підписаного або виданого протоколу вкажіть його номер."); return;
    }
    if ((status === "ready" || status === "signed" || status === "issued") && !doc.conclusion.trim()) {
      setActionError("Готовий протокол повинен містити висновок."); return;
    }
    // Підтвердження незворотних дій: підпис фіксує клінічний зміст назавжди,
    // видача передає результат пацієнту.
    if (status === "signed" && !window.confirm("Підписати протокол? Після підпису клінічний зміст стане незмінним.")) return;
    if (status === "issued" && !window.confirm("Видати протокол пацієнту? Дію не можна скасувати.")) return;
    setSaving(true);
    const response = await fetch("/api/staff/protocols", {
      method:"PUT", headers:{"content-type":"application/json"},
      body:JSON.stringify({ bookingId:booking.id, baseVersion:doc.version || 0, ...doc, status }),
    });
    const data = await response.json() as {
      ok?:boolean; version?:number; protocolStatus?:string; protocolNumber?:string;
      documentStatus?:ProtocolLifecycleStatus; signedBy?:string; signedAt?:string; signedVersion?:number;
      protocolReadyAt?:string; protocolIssuedAt?:string; error?:string;
    };
    setSaving(false);
    if (!response.ok || !data.ok) { setActionError(data.error || "Не вдалося зберегти протокол"); return; }
    const resolvedStatus = data.documentStatus || status;
    setDirty(false);
    setDoc((current) => current && ({
      ...current,
      status:resolvedStatus,
      version:data.version ?? current.version,
      updatedBy:staff?.email || current.updatedBy,
      signedBy:data.signedBy ?? current.signedBy,
      signedAt:data.signedAt ?? current.signedAt,
      signedVersion:data.signedVersion ?? current.signedVersion,
    }));
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
      documentStatus:resolvedStatus,
      documentVersion:data.version ?? item.documentVersion,
      signedBy:data.signedBy ?? item.signedBy,
      signedAt:data.signedAt ?? item.signedAt,
      signedVersion:data.signedVersion ?? item.signedVersion,
    } : item));
    setActionSuccess(
      resolvedStatus === "issued" ? "Протокол видано пацієнту."
        : resolvedStatus === "signed" ? "Протокол підписано. Клінічний зміст тепер незмінний."
          : resolvedStatus === "ready" ? "Протокол готовий до підпису."
            : "Чернетку протоколу збережено.",
    );
  }

  async function copyText() {
    if (!doc) return;
    try {
      await navigator.clipboard.writeText(renderProtocolText(docToProtocol(doc)));
      setActionSuccess("Текст протоколу скопійовано.");
    } catch {
      setActionError("Не вдалося скопіювати текст.");
    }
  }

  async function flagCritical() {
    if (!booking) return;
    const note = window.prompt("Опишіть критичну знахідку (для термінового доведення лікарю/пацієнту):", "");
    if (note === null) return;
    setActionError(""); setActionSuccess("");
    const res = await fetch("/api/staff/critical-findings", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "flag", bookingId: booking.id, note }),
    });
    const data = await res.json().catch(() => ({})) as { ok?: boolean; error?: string };
    if (!res.ok || !data.ok) { setActionError(data.error || "Не вдалося позначити критичну знахідку"); return; }
    setActionSuccess("Критичну знахідку позначено — вона у списку «Критичні знахідки» для доведення.");
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
    if (!aiDraft || !doc) return;
    patchDoc({
      conclusion:part === "recommendations" ? doc.conclusion : aiDraft.conclusion,
      recommendations:part === "conclusion" ? doc.recommendations : aiDraft.recommendations,
    });
    setActionSuccess("AI-чернетку вставлено. Перевірте та відредагуйте перед підписом.");
  }

  // Конструктор знахідок: складає речення опису/висновку й ДОДАЄ їх у документ,
  // не перезаписуючи ручний текст (insertComposedFinding робить append + дедуп).
  function addComposedFinding() {
    if (!doc) return;
    setCError("");
    const region = regionByKey(doc.templateKey);
    const target = region?.targets.find((entry) => entry.id === cTarget);
    const finding = target?.findings.find((entry) => entry.id === cFinding);
    if (!target || !finding) { setCError("Оберіть орган і знахідку."); return; }
    const needsLat = Boolean(target.laterality && finding.laterality !== false);
    const selection:FindingSelection = {
      regionKey:doc.templateKey, targetId:cTarget, findingId:cFinding,
      laterality:needsLat ? cLat : undefined,
      lobeId:cLobe || undefined,
      segmentId:cSeg || undefined,
      measurements:parseMeasures(cMeasures, finding.measurements || []),
      modifierIds:cMods,
    };
    const result = composeFinding(selection);
    if (!result.ok) { setCError(result.error); return; }
    const merged = insertComposedFinding(docToProtocol(doc), result.finding);
    patchDoc({ findings:merged.findings, conclusion:merged.conclusion });
    setComposed((prev) => [...prev, result.finding]);
    setActionSuccess("Структуровану знахідку додано в опис і висновок. Перевірте та відредагуйте текст перед підписом.");
    setCFinding(""); setCLat("right"); setCLobe(""); setCSeg(""); setCMeasures({}); setCMods([]);
  }

  // ── Персональні макроси ─────────────────────────────────────────────────────
  async function loadMacros() {
    try {
      const response = await fetch("/api/staff/protocols/macros", { cache:"no-store" });
      if (!response.ok) return;
      const data = await response.json() as { macros?:Macro[] };
      setMacros(data.macros || []);
    } catch { /* макроси — зручність; тихо ігноруємо збій завантаження */ }
  }

  function insertMacro(text:string) {
    if (!doc) return;
    const base = (doc[macroTarget] || "").replace(/\s+$/, "");
    const snippet = text.trim();
    if (!snippet) return;
    patchDoc({ [macroTarget]: base ? `${base}\n${snippet}` : snippet });
    setActionSuccess("Макрос вставлено. Перевірте та відредагуйте текст.");
  }

  async function createMacro() {
    setMacroError("");
    const title = macroTitle.trim();
    const body = macroBody.trim();
    if (!title || !body) { setMacroError("Вкажіть назву і текст макроса."); return; }
    const response = await fetch("/api/staff/protocols/macros", {
      method:"POST", headers:{"content-type":"application/json"},
      body:JSON.stringify({ title, body }),
    });
    const data = await response.json().catch(() => ({})) as { ok?:boolean; error?:string };
    if (!response.ok || !data.ok) { setMacroError(data.error || "Не вдалося зберегти макрос"); return; }
    setMacroTitle(""); setMacroBody("");
    await loadMacros();
  }

  async function deleteMacro(id:number) {
    const response = await fetch("/api/staff/protocols/macros", {
      method:"DELETE", headers:{"content-type":"application/json"},
      body:JSON.stringify({ id }),
    });
    if (response.ok) await loadMacros();
  }

  const canManage = staff?.role === "admin" || staff?.role === "radiologist";
  const clinicalLocked = doc?.status === "signed" || doc?.status === "issued";
  const canEdit = Boolean(canManage && !clinicalLocked);
  const canSign = staff?.role === "radiologist" && doc?.status === "ready";
  const canIssue = Boolean(canManage && doc?.status === "signed");
  const template = doc ? protocolTemplateByKey(doc.templateKey) : null;

  // Конструктор знахідок активний лише для змодельованих ділянок (КТ ОГК,
  // головний мозок, черевна порожнина). Для решти шаблонів лишається вільний текст.
  const composerRegion = doc ? regionByKey(doc.templateKey) : undefined;
  const composerTarget = composerRegion?.targets.find((entry) => entry.id === cTarget);
  const composerFinding = composerTarget?.findings.find((entry) => entry.id === cFinding);
  const composerNeedsLat = Boolean(composerTarget?.laterality && composerFinding?.laterality !== false);
  const composerWarnings:ClinicalWarning[] = (doc && composed.length)
    ? reviewProtocol({ document:docToProtocol(doc), findings:composed })
    : [];

  const visible = useMemo(() => queue
    .filter((item) => {
      if (filter === "awaiting") return !["ready","signed","issued"].includes(item.documentStatus);
      if (filter === "ready") return item.documentStatus === "ready";
      if (filter === "signed") return item.documentStatus === "signed";
      if (filter === "issued") return item.documentStatus === "issued";
      return true;
    })
    .filter((item) => !query.trim() || `${item.code} ${item.name} ${item.serviceTitle} ${item.serviceCode}`.toLowerCase().includes(query.trim().toLowerCase())),
  [queue,filter,query]);

  const counts = useMemo(() => ({
    awaiting:queue.filter((item) => !["ready","signed","issued"].includes(item.documentStatus)).length,
    ready:queue.filter((item) => item.documentStatus === "ready").length,
    signed:queue.filter((item) => item.documentStatus === "signed").length,
    issued:queue.filter((item) => item.documentStatus === "issued").length,
  }), [queue]);

  // Заповненість структурованих полів — для змісту й підказки готовності.
  const completeness = useMemo(() => {
    if (!doc) return null;
    const tpl = protocolTemplateByKey(doc.templateKey);
    let total = 0, filled = 0;
    for (const section of tpl.sections) for (const field of section.fields) {
      total++;
      if ((doc.sections[section.key]?.[field.key] || "").trim()) filled++;
    }
    return { total, filled };
  }, [doc]);

  return <StaffWorkspaceShell
    active="protocols"
    title="Конструктор протоколів"
    description="Структуровані протоколи досліджень за модальностями: заповнення, клінічний підпис, видача та друк."
    staffName={staff?.displayName || staff?.email}
    staffRole={staff ? roleLabels[staff.role] : undefined}
  >
    {error ? <section className="accessDenied"><b>Захищений розділ</b><p>{error}. Увійдіть через дозволений робочий обліковий запис.</p><a className="button compact" href="/staff/login?returnTo=%2Fstaff%2Fprotocols">Увійти для роботи</a></section> :
    loadError ? <section className="accessDenied"><b>Не вдалося завантажити</b><p>Не вдалося завантажити чергу протоколів. Перевірте зʼєднання та спробуйте ще раз.</p><button type="button" className="button compact" onClick={()=>{ setLoadError(false); void loadQueue(); }}>Повторити</button></section> :
    <div className="protocolWorkspace">
      <aside className="protocolQueue" aria-label="Черга протоколів">
        <div className="protocolQueueTools">
          <div className="protocolFilterTabs" role="group" aria-label="Фільтр черги протоколів">
            <button aria-pressed={filter==="awaiting"} className={filter==="awaiting"?"active":""} onClick={()=>setFilter("awaiting")}>Очікують <b>{counts.awaiting}</b></button>
            <button aria-pressed={filter==="ready"} className={filter==="ready"?"active":""} onClick={()=>setFilter("ready")}>До підпису <b>{counts.ready}</b></button>
            <button aria-pressed={filter==="signed"} className={filter==="signed"?"active":""} onClick={()=>setFilter("signed")}>Підписані <b>{counts.signed}</b></button>
            <button aria-pressed={filter==="issued"} className={filter==="issued"?"active":""} onClick={()=>setFilter("issued")}>Видані <b>{counts.issued}</b></button>
            <button aria-pressed={filter==="all"} className={filter==="all"?"active":""} onClick={()=>setFilter("all")}>Усі</button>
          </div>
          <input type="search" value={query} onChange={(e)=>setQuery(e.target.value)} aria-label="Пошук у черзі протоколів за кодом, ПІБ або дослідженням" placeholder="Код, ПІБ, дослідження"/>
        </div>
        <div className="protocolQueueList">
          {visible.length === 0 ? <p className="empty">Немає досліджень у цій категорії.</p> : visible.map((item) => <button
            key={item.id}
            aria-current={selectedId === item.id ? "true" : undefined}
            className={`protocolQueueItem${selectedId === item.id ? " active":""}`}
            onClick={()=>selectBooking(item.id)}
          >
            <span className={`protocolTag ${item.documentStatus || item.protocolStatus}`}>{lifecycleLabel(item.documentStatus || item.protocolStatus)}</span>
            <b>{item.serviceTitle}</b>
            <small>{item.code} · {item.name}</small>
            <small>{item.performedAt ? `Виконано ${formatDateTime(item.performedAt)}` : `Заплановано ${item.desiredDate} ${item.desiredTime}`}</small>
            {(item.signedBy || item.assignedRadiologistEmail) && <small>Лікар: {item.signedBy || item.assignedRadiologistEmail}</small>}
          </button>)}
        </div>
      </aside>

      <section className="protocolEditor">
        {actionError && <p className="staffError" role="alert">{actionError}</p>}
        {actionSuccess && <p className="staffSuccess" role="status">{actionSuccess}</p>}

        {bookingLoading && !booking ? <div className="protocolPlaceholder" role="status" aria-live="polite">
          <span aria-hidden="true">⏳</span>
          <b>Завантаження протоколу…</b>
          <p>Відкриваємо структурований протокол дослідження та його чернетку.</p>
        </div> : !booking || !doc || !template ? <div className="protocolPlaceholder">
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
                {" · "}Статус: {PROTOCOL_LIFECYCLE_STATUS_LABELS[doc.status]}
                {doc.updatedBy && ` · Автор: ${doc.updatedBy}`}
                {doc.signedAt && ` · Підписано: ${formatDateTime(doc.signedAt)}`}
              </p>
            </div>
            <span className={`protocolTag ${doc.status}`}>{PROTOCOL_LIFECYCLE_STATUS_LABELS[doc.status]}</span>
          </header>

          {clinicalLocked
            ? <p className="protocolReadonlyHint">Підписаний клінічний зміст незмінний. Після підпису доступна лише видача пацієнту.</p>
            : !canManage && <p className="protocolReadonlyHint">Режим перегляду. Редагувати протокол можуть лише лікар-рентгенолог або адміністратор.</p>}

          <div className="protocolFilterTabs" role="group" aria-label="Режим роботи">
            <button type="button" aria-pressed={mode==="quick"} className={mode==="quick"?"active":""} onClick={()=>setMode("quick")}>Швидкий</button>
            <button type="button" aria-pressed={mode==="structured"} className={mode==="structured"?"active":""} onClick={()=>setMode("structured")}>Структурований</button>
            <button type="button" aria-pressed={mode==="free"} className={mode==="free"?"active":""} onClick={()=>setMode("free")}>Вільний</button>
          </div>
          {mode==="quick" && <p className="protocolReadonlyHint">Швидкий режим: натисніть «Заповнити норму», відкоригуйте номер і висновок — протокол готовий. Структуровані поля приховано (дані збережено).</p>}
          {mode==="free" && <p className="protocolReadonlyHint">Вільний режим: структуровані поля й конструктор приховано; пишіть опис, висновок і рекомендації вручну. Збережені структуровані дані не втрачаються.</p>}

          <nav className="protocolToc" aria-label="Зміст протоколу">
            <span className="protocolTocLead">Зміст{completeness ? ` · заповнено ${completeness.filled}/${completeness.total}` : ""}</span>
            <a href="#protocol-method" className={doc.method.trim() ? "done" : ""}>Методика</a>
            <a href="#protocol-method-ref" className={doc.methodRef.trim() ? "done" : ""}>Джерело методики</a>
            {mode === "structured" && template.sections.filter((section)=>isConditionMet(section.showWhen, doc.sections)).map((section)=>{
              const filled = section.fields.some((f)=>(doc.sections[section.key]?.[f.key] || "").trim());
              return <a key={section.key} href={`#protocol-section-${section.key}`} className={filled ? "done" : ""}>{section.title}</a>;
            })}
            <a href="#protocol-findings" className={doc.findings.trim() ? "done" : ""}>Опис</a>
            <a href="#protocol-conclusion" className={doc.conclusion.trim() ? "done" : ""}>Висновок</a>
            <a href="#protocol-recommendations" className={doc.recommendations.trim() ? "done" : ""}>Рекомендації</a>
          </nav>

          <fieldset className="protocolFields" disabled={!canEdit || saving}>
            <div className="protocolRow">
              <label className="wide"><span>Шаблон протоколу</span>
                <select value={doc.templateKey} onChange={(e)=>changeTemplate(e.target.value)}>
                  {PROTOCOL_TEMPLATES.map((tpl)=><option key={tpl.key} value={tpl.key}>{tpl.title}</option>)}
                </select>
              </label>
              <label><span>Номер протоколу</span>
                <input value={doc.number} maxLength={80} placeholder="Наприклад, КТ-2026-001"
                  onChange={(e)=>patchDoc({number:e.target.value})}/>
              </label>
              <button type="button" className="protocolNormButton" onClick={fillNorms}>Заповнити норму</button>
            </div>

            <label className="protocolNarrative" id="protocol-method"><span>Методика</span>
              <textarea value={doc.method} maxLength={600} placeholder={template.method || "Опишіть методику дослідження"}
                onChange={(e)=>patchDoc({method:e.target.value})}/>
            </label>

            <label className="protocolNarrative" id="protocol-method-ref"><span>Джерело методики / стандарт</span>
              <textarea value={doc.methodRef} maxLength={300}
                placeholder={template.methodRef || defaultMethodRef(template.equipmentId) || "Галузевий протокол, методика виробника, наказ МОЗ тощо"}
                onChange={(e)=>patchDoc({methodRef:e.target.value})}/>
              <small className="protocolFieldHint">Підстава методики дослідження — потрапляє в текст протоколу (аналог посилання на стандарт).</small>
            </label>

            {mode === "structured" && template.sections.filter((section)=>isConditionMet(section.showWhen, doc.sections)).map((section)=><div className="protocolSection" id={`protocol-section-${section.key}`} key={section.key}>
              <h3>{section.title}</h3>
              <div className="protocolSectionFields">
                {section.fields.filter((field)=>isConditionMet(field.showWhen, doc.sections)).map((field)=>{
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

            <label className="protocolNarrative" id="protocol-findings"><span>Опис (додатково)</span>
              <textarea value={doc.findings} maxLength={6000} placeholder="Вільний опис виявлених змін, що доповнює структуровані поля"
                onChange={(e)=>patchDoc({findings:e.target.value})}/>
            </label>
            <label className="protocolNarrative" id="protocol-conclusion"><span>Висновок</span>
              <textarea value={doc.conclusion} maxLength={6000} placeholder="Діагностичний висновок"
                onChange={(e)=>patchDoc({conclusion:e.target.value})}/>
            </label>
            <label className="protocolNarrative" id="protocol-recommendations"><span>Рекомендації</span>
              <textarea value={doc.recommendations} maxLength={6000} placeholder="Рекомендації щодо подальшого обстеження"
                onChange={(e)=>patchDoc({recommendations:e.target.value})}/>
            </label>
          </fieldset>

          {canEdit && mode === "structured" && composerRegion && <section className="findingComposer">
            <div className="aiAssistHead">
              <div>
                <p className="eyebrow">Конструктор знахідок</p>
                <b>Структурована знахідка → граматичний опис і висновок</b>
                <small>Оберіть орган, знахідку й параметри — речення складеться українською і додасться в поля «Опис» та «Висновок», не перезаписуючи ваш текст.</small>
              </div>
            </div>
            {cError && <p className="findingComposerWarn" role="alert">{cError}</p>}
            <div className="findingComposerControls">
              <label><span>Орган / структура</span>
                <select value={cTarget} onChange={(e)=>{ const v=e.target.value; setCTarget(v); setCFinding(""); setCLat("right"); setCLobe(""); setCSeg(""); setCMeasures({}); setCMods([]); setCError(""); }}>
                  <option value="">— оберіть —</option>
                  {composerRegion.targets.map((t)=><option key={t.id} value={t.id}>{t.label}</option>)}
                </select>
              </label>
              {composerTarget && <label><span>Знахідка</span>
                <select value={cFinding} onChange={(e)=>{ setCFinding(e.target.value); setCMeasures({}); setCMods([]); setCError(""); }}>
                  <option value="">— оберіть —</option>
                  {composerTarget.findings.map((f)=><option key={f.id} value={f.id}>{f.label}</option>)}
                </select>
                {composerFinding?.hint && <small className="protocolFieldHint">{composerFinding.hint}</small>}
              </label>}
              {composerFinding && composerNeedsLat && <label><span>Латералізація</span>
                <select value={cLat} onChange={(e)=>setCLat(e.target.value as Laterality)}>
                  {(["right","left","bilateral"] as const).map((l)=><option key={l} value={l}>{LATERALITY_LABEL[l]}</option>)}
                </select>
              </label>}
              {composerFinding && composerTarget?.lobes && <label><span>Частка (необов’язково)</span>
                <select value={cLobe} onChange={(e)=>setCLobe(e.target.value)}>
                  <option value="">— не вказувати —</option>
                  {composerTarget.lobes.map((lobe)=><option key={lobe.id} value={lobe.id}>{lobe.label}</option>)}
                </select>
              </label>}
              {composerFinding && composerTarget?.segmentPresets && <label><span>Сегменти (необов’язково)</span>
                <select value={cSeg} onChange={(e)=>setCSeg(e.target.value)}>
                  <option value="">— не вказувати —</option>
                  {composerTarget.segmentPresets.map((seg)=><option key={seg.id} value={seg.id}>{seg.label}</option>)}
                </select>
              </label>}
              {(composerFinding?.measurements || []).map((kind)=><label key={kind}><span>{MEASUREMENT_META[kind].label} ({MEASUREMENT_META[kind].unit})</span>
                <input inputMode="decimal" value={cMeasures[kind] || ""} placeholder={MEASUREMENT_META[kind].unit}
                  onChange={(e)=>setCMeasures((prev)=>({ ...prev, [kind]:e.target.value }))}/>
              </label>)}
            </div>
            {composerFinding?.modifiers && composerFinding.modifiers.length > 0 && <div className="findingComposerMods">
              {composerFinding.modifiers.map((mod)=><label key={mod.id}>
                <input type="checkbox" checked={cMods.includes(mod.id)}
                  onChange={(e)=>setCMods((prev)=>e.target.checked ? [...prev, mod.id] : prev.filter((id)=>id!==mod.id))}/>
                {mod.label}
              </label>)}
            </div>}
            <div className="aiDraftMeta">
              <button type="button" className="primary" disabled={!composerFinding || saving} onClick={addComposedFinding}>Додати у опис і висновок</button>
            </div>
            {composerWarnings.map((w,index)=><p key={`${w.code}-${index}`} className="findingComposerWarn" role="status">⚠ {w.message}</p>)}
            {composed.length > 0 && <ul className="aiDeviations">
              {composed.map((f,index)=><li key={`${f.targetId}-${f.findingId}-${index}`}>{f.description}</li>)}
            </ul>}
          </section>}
          {canEdit && mode === "structured" && !composerRegion && <p className="protocolReadonlyHint">Конструктор структурованих знахідок поки доступний для КТ ОГК, КТ головного мозку та КТ органів черевної порожнини. Для інших шаблонів заповнюйте опис вручну.</p>}

          {canEdit && mode !== "quick" && <section className="protocolMacros">
            <div className="aiAssistHead">
              <div>
                <p className="eyebrow">Макроси</p>
                <b>Персональні формулювання</b>
                <small>Ваші повторно вживані фрагменти; вставляються у вибране поле, не перезаписуючи наявний текст.</small>
              </div>
              <label className="protocolMacroTarget"><span>Куди вставляти</span>
                <select value={macroTarget} onChange={(e)=>setMacroTarget(e.target.value as "findings"|"conclusion"|"recommendations")}>
                  <option value="findings">Опис</option>
                  <option value="conclusion">Висновок</option>
                  <option value="recommendations">Рекомендації</option>
                </select>
              </label>
            </div>
            {macros.length > 0 ? <ul className="protocolMacrosList">
              {macros.map((m)=><li key={m.id}>
                <button type="button" title={m.body} onClick={()=>insertMacro(m.body)}>{m.title}</button>
                <button type="button" className="protocolMacroDelete" aria-label={`Видалити макрос «${m.title}»`} onClick={()=>void deleteMacro(m.id)}>✕</button>
              </li>)}
            </ul> : <p className="protocolMacrosEmpty">Ще немає збережених макросів.</p>}
            <div className="protocolMacrosForm">
              {macroError && <p className="findingComposerWarn" role="alert">{macroError}</p>}
              <input value={macroTitle} maxLength={120} placeholder="Назва макроса" aria-label="Назва нового макроса" onChange={(e)=>setMacroTitle(e.target.value)}/>
              <textarea value={macroBody} maxLength={4000} placeholder="Текст формулювання" aria-label="Текст нового макроса" onChange={(e)=>setMacroBody(e.target.value)}/>
              <button type="button" className="primary" onClick={()=>void createMacro()}>Зберегти макрос</button>
            </div>
          </section>}

          {canEdit && mode !== "quick" && <section className="aiAssist">
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
            {canEdit && doc.status === "draft" && <>
              <button type="button" onClick={()=>void save("draft")} disabled={saving}>Зберегти чернетку</button>
              <button type="button" className="secondary" onClick={()=>void save("ready")} disabled={saving}>Готовий до підпису</button>
            </>}
            {canEdit && doc.status === "ready" &&
              <button type="button" className="secondary" onClick={()=>void save("ready")} disabled={saving}>Зберегти зміни</button>}
            {canSign && <button type="button" className="primary" onClick={()=>void save("signed")} disabled={saving}>Підписати протокол</button>}
            {doc.status === "ready" && staff?.role === "admin" && <span className="protocolReadonlyHint">Підпис доступний лише лікарю-рентгенологу.</span>}
            {canIssue && <button type="button" className="primary" onClick={()=>void save("issued")} disabled={saving}>Видати пацієнту</button>}
            <button type="button" className="ghost" aria-pressed={showPreview} onClick={()=>setShowPreview((on)=>!on)}>{showPreview ? "Сховати перегляд" : "Попередній перегляд"}</button>
            <button type="button" className="ghost" onClick={()=>void copyText()}>Копіювати текст</button>
            <button type="button" className="ghost" onClick={()=>window.print()}>Друк / PDF</button>
            {canManage && <button type="button" className="ghost" onClick={()=>void flagCritical()} title="Позначити ургентну знахідку для термінового доведення">⚠ Критична знахідка</button>}
          </div>

          {showPreview && <section className="protocolLivePreview" role="region" aria-label="Попередній перегляд протоколу">
            <div className="protocolLivePreviewHead"><b>Попередній перегляд (у реальному часі)</b><small>Рендер поточного протоколу; оновлюється під час редагування.</small></div>
            <pre>{renderProtocolText(docToProtocol(doc))}</pre>
          </section>}

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
              <div><dt>{booking.performedAt ? "Дата виконання" : "Запланована дата"}</dt><dd>{booking.performedAt ? formatDateTime(booking.performedAt) : `${booking.desiredDate} ${booking.desiredTime}`}</dd></div>
            </dl>
            {(doc.method || template.method) && <section><h2>Методика</h2><p>{doc.method || template.method}</p></section>}
            {(doc.methodRef || template.methodRef || defaultMethodRef(template.equipmentId)) && <section><h2>Джерело методики</h2><p>{doc.methodRef || template.methodRef || defaultMethodRef(template.equipmentId)}</p></section>}
            {template.sections.filter((section)=>isConditionMet(section.showWhen, doc.sections)).map((section)=>{
              const rendered = section.fields
                .filter((field)=>isConditionMet(field.showWhen, doc.sections))
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
              <span>{doc.signedBy
                ? `Лікар-рентгенолог: ${doc.signedBy === "system:legacy-issued" ? "історичний протокол до введення workflow-підпису" : doc.signedBy}${doc.signedAt ? ` · ${formatDateTime(doc.signedAt)}` : ""}`
                : <>Лікар-рентгенолог: ________________________ <small>(підпис, ПІБ)</small></>}</span>
              <span>Статус: {PROTOCOL_LIFECYCLE_STATUS_LABELS[doc.status]}</span>
            </footer>
          </article>
        </>}
      </section>
    </div>}
  </StaffWorkspaceShell>;
}
