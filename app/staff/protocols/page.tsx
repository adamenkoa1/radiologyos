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
  FINDINGS_CATALOG,
  LATERALITY_LABEL,
  MEASUREMENT_META,
  type Laterality,
  type FindingSelection,
  type MeasurementInput,
  type MeasurementKind,
  type ComposedFinding,
  type ClinicalWarning,
} from "../../../lib/findings-composer";
import { findContradictions } from "../../../lib/protocol-contradictions";
import { compareStudies, type ComparisonResult } from "../../../lib/protocol-comparison";
import { planImport, FINDING_REGION_TO_CATALOG } from "../../../lib/clinical-library-adapter";
import { renderLibraryFinding, activeParameters } from "../../../lib/clinical-library-finding";
import type { PathologyFinding } from "../../../lib/clinical-library";
import libraryFindingsRaw from "../../../clinical-library/radiologyos-pathology-findings.json";
import { SERVICES } from "../../../lib/catalog";
import { EQUIPMENT_LABELS } from "../../../lib/labels";
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
  clinicalIndication?:string; referral?:string; referralType?:string; referralNumber?:string;
  dateOfBirth?:string; phone?:string;
};
type Revision = { version:number; number:string; status:string; savedBy:string; createdAt:string };
type PriorStudy = { id:number; code:string; service:string; serviceCode:string; equipmentId:string; performedAt:string; desiredDate:string; protocolStatus:string; protocolNumber:string };
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
  const [revisions,setRevisions] = useState<Revision[]>([]);
  // Порівняння з попереднім дослідженням того самого пацієнта (read-only, #8).
  const [priorStudies,setPriorStudies] = useState<PriorStudy[]>([]);
  const [compareId,setCompareId] = useState<number | null>(null);
  const [compareText,setCompareText] = useState("");
  const [compareLoading,setCompareLoading] = useState(false);
  const [comparePriorStructured,setComparePriorStructured] = useState<ComposedFinding[]>([]);
  const [comparePriorRegion,setComparePriorRegion] = useState("");
  const [autoDelta,setAutoDelta] = useState<ComparisonResult | null>(null);
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
  // Додаткові фільтри черги: модальність, виконавець, діапазон дат (клієнтський
  // шар над уже tenant/роль-скоупованою серверною чергою — не розширює доступ).
  const [fModality,setFModality] = useState("all");
  const [fPerformer,setFPerformer] = useState("all");
  const [fDateFrom,setFDateFrom] = useState("");
  const [fDateTo,setFDateTo] = useState("");
  const [filtersOpen,setFiltersOpen] = useState(false);
  const [bookingLoading,setBookingLoading] = useState(false);
  const [dirty,setDirty] = useState(false);
  // Жива панель прев'ю (Этап D2, §3): показ рендера протоколу в реальному часі.
  const [showPreview,setShowPreview] = useState(false);
  // Швидке (walk-in) створення дослідження прямо з робочого місця.
  const [newStudyOpen,setNewStudyOpen] = useState(false);
  const [nsName,setNsName] = useState("");
  const [nsPhone,setNsPhone] = useState("");
  const [nsDob,setNsDob] = useState("");
  const [nsService,setNsService] = useState("401");
  const [nsIndication,setNsIndication] = useState("");
  const [nsSaving,setNsSaving] = useState(false);
  const [nsError,setNsError] = useState("");
  // Вхідні заявки (Telegram) — черга реєстратора прямо на робочому місці.
  type IntakeRequest = { id:number; channel:string; contact:string; message:string; status:string; assignedEmail:string; linkedBookingId:number; createdAt:string };
  const [intakeRequests,setIntakeRequests] = useState<IntakeRequest[]>([]);
  const [intakeOpen,setIntakeOpen] = useState(false);
  const [intakeBusy,setIntakeBusy] = useState(0);
  const [confirmFor,setConfirmFor] = useState<number | null>(null);
  const [confirmText,setConfirmText] = useState("");
  const [pendingIntakeId,setPendingIntakeId] = useState<number | null>(null);
  // Дедуплікація пацієнта за телефоном: прив'язка до наявної картки або нова.
  const [nsPatientId,setNsPatientId] = useState("");
  type NsLookup = { status:"idle"|"loading"|"found"|"ambiguous"|"none"|"error"; label?:string; matches?:{patientId:string;displayName:string;birthDate:string}[]; message?:string };
  const [nsLookup,setNsLookup] = useState<NsLookup>({ status:"idle" });
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
  // Персональні повні шаблони (Этап D5c, §7): збережені заготовки документа.
  type UserTemplate = { id:number; title:string; baseTemplateKey:string; documentJson:string };
  const [userTemplates,setUserTemplates] = useState<UserTemplate[]>([]);
  const [utError,setUtError] = useState("");

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

  // Імпортована клінічна бібліотека (MP4 PR3): вибір знахідки «на перевірці» +
  // значення її параметрів. Вставка — ЯВНА, append, без перезапису; шаблон
  // лишається draft_unvalidated (лікар перевіряє/редагує перед підписом).
  const [libFinding,setLibFinding] = useState("");
  const [libValues,setLibValues] = useState<Record<string,string>>({});

  function resetComposer() {
    setCTarget(""); setCFinding(""); setCLat("right"); setCLobe(""); setCSeg("");
    setCMeasures({}); setCMods([]); setCError(""); setComposed([]); setMode("structured");
    setLibFinding(""); setLibValues({});
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
    const timer = window.setTimeout(() => { void loadQueue(); void loadMacros(); void loadUserTemplates(); void loadIntakeRequests(); }, 0);
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

  // ── Швидке (walk-in) створення дослідження ──────────────────────────────────
  // Пацієнт уже присутній/ретроспективно: створюємо дослідження без слота й
  // одразу відкриваємо редактор. Пише в канонічні bookings (POST
  // /api/staff/protocols/studies), lifecycle протоколу не зачіпається.
  // Пошук наявної картки пацієнта за телефоном (безпечна перевірка дублікатів).
  // Прив'язка лише за явним вибором лікаря; інакше буде створено нову картку.
  async function checkPatient() {
    const phone = nsPhone.trim();
    if (!phone) { setNsLookup({ status:"error", message:"Спершу вкажіть телефон." }); return; }
    setNsPatientId(""); setNsLookup({ status:"loading" });
    try {
      const response = await fetch(`/api/staff/patients?phone=${encodeURIComponent(phone)}`, { cache:"no-store" });
      const data = await response.json() as Record<string, unknown>;
      if (response.status === 409 && Array.isArray(data.matches)) {
        setNsLookup({ status:"ambiguous", matches: data.matches as NsLookup["matches"], message: "Кілька карток із цим номером — оберіть одну або створіть нову." });
        return;
      }
      if (response.ok && typeof data.patientId === "string") {
        setNsLookup({ status:"found", matches:[{ patientId: data.patientId as string, displayName: String(data.displayName || ""), birthDate: String(data.birthDate || "") }] });
        return;
      }
      // 404 або неприв'язані заявки без картки → нова картка.
      setNsLookup({ status:"none", message:"Картку з цим номером не знайдено — буде створено нову." });
    } catch {
      setNsLookup({ status:"error", message:"Помилка мережі під час пошуку." });
    }
  }
  function linkPatient(m:{patientId:string;displayName:string;birthDate:string}) {
    setNsPatientId(m.patientId);
    if (m.displayName) setNsName(m.displayName);
    if (m.birthDate) setNsDob(m.birthDate);
    setNsLookup({ status:"found", label:`${m.displayName || m.patientId}${m.birthDate ? ` · ${m.birthDate}` : ""}`, matches:[m] });
  }
  function unlinkPatient() { setNsPatientId(""); setNsLookup({ status:"idle" }); }

  // ── Вхідні заявки (Telegram) ────────────────────────────────────────────────
  async function loadIntakeRequests() {
    try {
      const res = await fetch("/api/staff/intake-requests?status=new", { cache:"no-store" });
      if (!res.ok) { if (res.status === 403) setIntakeRequests([]); return; }
      const data = await res.json() as { requests?:IntakeRequest[] };
      const open = (data.requests || []).filter((r)=>r.status === "new" || r.status === "in_progress");
      setIntakeRequests(open);
    } catch { /* заявки — допоміжна панель; тихо ігноруємо збій */ }
  }
  async function patchIntake(id:number, body:Record<string,unknown>) {
    setIntakeBusy(id);
    try {
      const res = await fetch("/api/staff/intake-requests", { method:"PATCH", headers:{"content-type":"application/json"}, body:JSON.stringify({ id, ...body }) });
      return await res.json() as { ok?:boolean; status?:string; sent?:boolean; error?:string };
    } catch { return { ok:false, error:"Помилка мережі" }; }
    finally { setIntakeBusy(0); }
  }
  async function claimIntake(id:number) { const r = await patchIntake(id, { action:"claim" }); if (r.ok) await loadIntakeRequests(); }
  async function declineIntake(id:number) { const r = await patchIntake(id, { action:"decline" }); if (r.ok) await loadIntakeRequests(); }
  async function sendIntakeConfirmation(id:number) {
    if (!confirmText.trim()) return;
    const r = await patchIntake(id, { action:"confirm", text:confirmText });
    if (r.sent) { setActionSuccess("Підтвердження надіслано в Telegram."); setConfirmFor(null); setConfirmText(""); }
    else setActionError(r.error || "Не вдалося надіслати підтвердження (перевірте токен бота в налаштуваннях).");
  }
  function startStudyFromIntake(req:IntakeRequest) {
    setPendingIntakeId(req.id);
    setNewStudyOpen(true); setNsError("");
    setNsIndication(req.message.slice(0, 400));
    void claimIntake(req.id);
    try { document.querySelector(".protocolNewStudyForm")?.scrollIntoView({ behavior:"smooth", block:"center" }); } catch { /* no-op */ }
  }

  async function createWalkInStudy() {
    if (nsSaving) return;
    setNsError("");
    if (!nsName.trim() || !nsPhone.trim()) { setNsError("Вкажіть ім'я та телефон пацієнта."); return; }
    setNsSaving(true);
    try {
      const response = await fetch("/api/staff/protocols/studies", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: nsName, phone: nsPhone, dob: nsDob, serviceCode: nsService, clinicalIndication: nsIndication, patientId: nsPatientId }),
      });
      const data = await response.json() as { ok?: boolean; bookingId?: number; error?: string };
      if (!response.ok || !data.ok || !data.bookingId) { setNsError(data.error || "Не вдалося створити дослідження"); return; }
      setNewStudyOpen(false);
      setNsName(""); setNsPhone(""); setNsDob(""); setNsIndication(""); setNsService("401"); setNsPatientId(""); setNsLookup({ status:"idle" });
      // Якщо дослідження створене із заявки — звʼязуємо її (converted) й оновлюємо чергу заявок.
      if (pendingIntakeId) {
        await patchIntake(pendingIntakeId, { action:"link", bookingId:data.bookingId, patientId:nsPatientId });
        setPendingIntakeId(null);
        await loadIntakeRequests();
      }
      await loadQueue();
      await openBooking(data.bookingId);
      setActionSuccess("Дослідження створено. Заповніть опис і висновок, збережіть чернетку.");
    } catch {
      setNsError("Помилка мережі — спробуйте ще раз");
    } finally {
      setNsSaving(false);
    }
  }

  async function openBooking(id:number) {
    setActionError(""); setActionSuccess(""); setSelectedId(id); setBooking(null); setDoc(null); setAiDraft(null); setRevisions([]);
    setPriorStudies([]); setCompareId(null); setCompareText(""); setComparePriorStructured([]); setComparePriorRegion(""); setAutoDelta(null);
    setBookingLoading(true); setDirty(false); resetComposer();
    try {
      const response = await fetch(`/api/staff/protocols?bookingId=${id}`, { cache:"no-store" });
      const data = await response.json() as {
        booking?:BookingDetail; protocol?:((EditorDoc & { findingsStructured?:ComposedFinding[] }) | null); revisions?:Revision[]; priorStudies?:PriorStudy[]; error?:string;
      };
      if (!response.ok || !data.booking) { setActionError(data.error || "Не вдалося відкрити протокол"); return; }
      setBooking(data.booking);
      setRevisions(Array.isArray(data.revisions) ? data.revisions : []);
      setPriorStudies(Array.isArray(data.priorStudies) ? data.priorStudies : []);
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
      // Відновлюємо структуровані знахідки конструктора (для авто-порівняння E3).
      setComposed(data.protocol && Array.isArray(data.protocol.findingsStructured) ? data.protocol.findingsStructured : []);
    } catch {
      setActionError("Помилка мережі — спробуйте ще раз");
    } finally {
      setBookingLoading(false);
    }
  }

  // Завантажити текст протоколу попереднього дослідження для порівняння (#8,
  // read-only). Нічого не змінює; динаміку формулює лікар вручну.
  async function loadComparison(id:number | null) {
    setCompareId(id); setCompareText(""); setComparePriorStructured([]); setComparePriorRegion(""); setAutoDelta(null);
    if (!id) return;
    setCompareLoading(true);
    try {
      const res = await fetch(`/api/staff/protocols?bookingId=${id}`, { cache:"no-store" });
      const data = await res.json() as { protocol?:((EditorDoc & { findingsStructured?:ComposedFinding[] }) | null) };
      if (res.ok && data.protocol) {
        const p = data.protocol;
        const status:ProtocolStatus = p.status === "signed" || p.status === "issued" ? "issued" : p.status === "ready" ? "ready" : "draft";
        setCompareText(renderProtocolText({
          templateKey:p.templateKey, method:p.method, methodRef:p.methodRef || "",
          sections:p.sections || {}, findings:p.findings, conclusion:p.conclusion,
          recommendations:p.recommendations, number:p.number, status,
        }));
        setComparePriorStructured(Array.isArray(p.findingsStructured) ? p.findingsStructured : []);
        setComparePriorRegion(p.templateKey);
      } else {
        setCompareText("Для цього дослідження ще немає протоколу.");
      }
    } catch {
      setCompareText("Не вдалося завантажити попереднє дослідження.");
    } finally {
      setCompareLoading(false);
    }
  }

  // Авто-порівняння E3: будує чернетку динаміки зі СТРУКТУРОВАНИХ знахідок
  // (поточні composed vs структуровані знахідки попереднього дослідження).
  // Guard блокує різні ділянки/модальності. Нічого не змінює — лише чернетка.
  function runAutoCompare() {
    if (!doc) return;
    const assessed = (fs:ComposedFinding[]) => [...new Set(fs.map((f)=>f.targetId))];
    const priorLabel = priorStudies.find((p)=>p.id===compareId)?.service || "Попереднє дослідження";
    const result = compareStudies(
      { label:priorLabel, regionKey:comparePriorRegion, findings:comparePriorStructured, assessedTargets:assessed(comparePriorStructured) },
      { label:"Поточне", regionKey:doc.templateKey, findings:composed, assessedTargets:assessed(composed) },
    );
    setAutoDelta(result);
  }
  function insertDynamicsDraft() {
    if (!doc || !autoDelta || !autoDelta.ok || !autoDelta.draft.trim()) return;
    const base = (doc.conclusion || "").replace(/\s+$/, "");
    patchDoc({ conclusion: base ? `${base}\n${autoDelta.draft}` : autoDelta.draft });
    setActionSuccess("Чернетку динаміки додано у висновок. Перевірте та відредагуйте перед підписом.");
  }

  // Глибоке посилання ?studyId=<id> (або legacy ?open=<id>) відкриває протокол
  // одразу після завантаження черги — дія «Створити/відкрити протокол» із картки
  // пацієнта чи дошки веде саме сюди.
  useEffect(() => {
    if (!queue.length || selectedId !== null) return;
    const params = new URLSearchParams(window.location.search);
    const target = Number(params.get("studyId") || params.get("open"));
    if (Number.isInteger(target) && target > 0 && queue.some((item) => item.id === target)) void openBooking(target);
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
      body:JSON.stringify({ bookingId:booking.id, baseVersion:doc.version || 0, ...doc, status, findingsStructured:composed }),
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
    const newVersion = data.version ?? (doc.version || 0);
    setRevisions((current) => [
      { version:newVersion, number:data.protocolNumber ?? doc.number, status:resolvedStatus, savedBy:staff?.email || "", createdAt:new Date().toISOString() },
      ...current.filter((r) => r.version !== newVersion),
    ]);
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
  // ── Імпортована бібліотека (MP4 PR3) ───────────────────────────────────────
  // Людські підписи параметрів імпортованих знахідок (fallback — ключ+одиниця).
  const LIB_PARAM_LABELS:Record<string,string> = {
    location:"Локалізація", size_mm:"Розмір (мм)", side:"Сторона", segment:"Сегмент",
    severity:"Ступінь", morphology:"Морфологія", density_hu:"Щільність (HU)",
    spleen_hu:"Щільність селезінки (HU)", displacement_mm:"Зміщення (мм)",
    displacement_status:"Зміщення", air_bronchogram:"Повітряна бронхограма",
    stenosis_percent:"Стеноз (%)", level:"Рівень",
  };
  function libParamLabel(key:string, unit?:string|null):string {
    return LIB_PARAM_LABELS[key] || (unit ? `${key} (${unit})` : key);
  }

  // Вставка ЧЕРНЕТКИ імпортованої знахідки: append у опис/висновок, без
  // перезапису. Шаблон НЕперевірений — лікар редагує й підписує сам (нічого не
  // публікується, lifecycle/права/API не зачіпаються).
  function addLibraryFinding() {
    if (!doc || !libSelected) return;
    setCError("");
    const result = renderLibraryFinding(libSelected.finding, libValues);
    if (!result.ok) { setCError(`Заповніть обов'язкові параметри: ${result.missing.join(", ")}.`); return; }
    const baseF = (doc.findings || "").replace(/\s+$/, "");
    const baseC = (doc.conclusion || "").replace(/\s+$/, "");
    patchDoc({
      findings: baseF ? `${baseF}\n${result.description}` : result.description,
      conclusion: baseC ? `${baseC}\n${result.conclusion}` : result.conclusion,
    });
    setActionSuccess("Чернетку імпортованої знахідки додано. Це НЕперевірений шаблон — обов'язково перевірте й відредагуйте текст перед підписом.");
    setLibFinding(""); setLibValues({});
  }

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

  // ── Персональні повні шаблони ────────────────────────────────────────────────
  async function loadUserTemplates() {
    try {
      const response = await fetch("/api/staff/protocols/user-templates", { cache:"no-store" });
      if (!response.ok) return;
      const data = await response.json() as { templates?:UserTemplate[] };
      setUserTemplates(data.templates || []);
    } catch { /* зручність; тихо ігноруємо збій */ }
  }

  async function saveAsTemplate() {
    if (!doc) return;
    setUtError("");
    const title = window.prompt("Назва особистого шаблону (на основі поточного протоколу):", "");
    if (title === null) return;
    const response = await fetch("/api/staff/protocols/user-templates", {
      method:"POST", headers:{"content-type":"application/json"},
      body:JSON.stringify({
        title, baseTemplateKey:doc.templateKey,
        document:{ method:doc.method, methodRef:doc.methodRef, sections:doc.sections,
          findings:doc.findings, conclusion:doc.conclusion, recommendations:doc.recommendations },
      }),
    });
    const data = await response.json().catch(() => ({})) as { ok?:boolean; error?:string };
    if (!response.ok || !data.ok) { setUtError(data.error || "Не вдалося зберегти шаблон"); return; }
    setActionSuccess("Поточний протокол збережено як особистий шаблон.");
    await loadUserTemplates();
  }

  // Застосування шаблону — явна дія, що заповнює заготовчі поля. Підтверджуємо,
  // якщо вже є вміст, щоб не перезаписати роботу мовчки (§6).
  function applyTemplate(tpl:UserTemplate) {
    if (!doc) return;
    let shape:Partial<EditorDoc>;
    try { shape = JSON.parse(tpl.documentJson) as Partial<EditorDoc>; }
    catch { setUtError("Пошкоджений шаблон"); return; }
    const hasContent = doc.findings.trim() || doc.conclusion.trim() || doc.recommendations.trim()
      || Object.values(doc.sections).some((s) => Object.values(s || {}).some((v) => (v || "").trim()));
    if (hasContent && !window.confirm("Застосувати шаблон? Поточні структуровані поля та опис/висновок/рекомендації буде замінено збереженими в шаблоні (номер і статус не змінюються).")) return;
    setDoc((current) => current && ({
      ...current,
      templateKey:tpl.baseTemplateKey,
      method:String(shape.method ?? ""),
      methodRef:String(shape.methodRef ?? ""),
      sections:(shape.sections as EditorDoc["sections"]) || {},
      findings:String(shape.findings ?? ""),
      conclusion:String(shape.conclusion ?? ""),
      recommendations:String(shape.recommendations ?? ""),
    }));
    setDirty(true);
    setActionSuccess("Особистий шаблон застосовано. Відредагуйте за потреби.");
  }

  async function deleteUserTemplate(id:number) {
    const response = await fetch("/api/staff/protocols/user-templates", {
      method:"DELETE", headers:{"content-type":"application/json"},
      body:JSON.stringify({ id }),
    });
    if (response.ok) await loadUserTemplates();
  }

  const canManage = staff?.role === "admin" || staff?.role === "radiologist";
  const canCreateStudy = staff?.role === "admin" || staff?.role === "registrar";
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

  // Імпортовані знахідки бібліотеки, згруповані за ключем ділянки каталогу. Лише
  // записи плану з дією "create" (нові, не дублі, у погоджених ділянках). План
  // рахується один раз (чиста функція planImport, без мережі/БД).
  const libraryByRegion = useMemo(() => {
    const findings = libraryFindingsRaw as PathologyFinding[];
    const plan = planImport({ templates: [], findings }, {
      existingCatalog: FINDINGS_CATALOG,
      existingTemplateKeys: PROTOCOL_TEMPLATES.map((t) => t.key),
    });
    const byId = new Map(findings.map((f) => [f.id, f]));
    const map = new Map<string, { finding: PathologyFinding; possibleDuplicateOf?: string }[]>();
    for (const item of plan.items) {
      if (item.kind !== "finding" || item.action !== "create") continue;
      const finding = byId.get(item.sourceId);
      if (!finding) continue;
      const regionKey = FINDING_REGION_TO_CATALOG[finding.region];
      if (!regionKey) continue;
      const arr = map.get(regionKey) || [];
      arr.push({ finding, possibleDuplicateOf: item.possibleDuplicateOf });
      map.set(regionKey, arr);
    }
    return map;
  }, []);
  const libCandidates = composerRegion ? (libraryByRegion.get(composerRegion.key) || []) : [];
  const libSelected = libCandidates.find((c) => c.finding.id === libFinding);
  const libActiveParams = libSelected ? activeParameters(libSelected.finding) : [];
  const libReady = Boolean(libSelected) && libActiveParams.filter((p) => p.required).every((p) => (libValues[p.key] || "").trim() !== "");

  const composerWarnings:ClinicalWarning[] = (doc && composed.length)
    ? reviewProtocol({ document:docToProtocol(doc), findings:composed })
    : [];
  // Детермінована перевірка суперечностей опис↔висновок (E2) — дорадча, не
  // переписує текст. Рахується з поточного документа в реальному часі.
  const contradictions = doc
    ? findContradictions({ findings:doc.findings, conclusion:doc.conclusion, contrast:(doc.sections.parameters || {}).contrast })
    : [];

  // Опції фільтрів беремо лише з наявної (вже скоупованої) черги — лікарю ніколи
  // не пропонуємо модальність/виконавця поза його доступом.
  const modalityOptions = useMemo(
    () => Array.from(new Set(queue.map((i) => i.equipmentId).filter(Boolean))).sort(),
    [queue]);
  const performerOptions = useMemo(
    () => Array.from(new Set(queue.map((i) => i.assignedRadiologistEmail).filter(Boolean))).sort(),
    [queue]);
  // Дата дослідження: виконане → performedAt, інакше заплановане → desiredDate.
  const itemDate = (item:QueueItem) => (item.performedAt || item.desiredDate || "").slice(0, 10);
  const filtersActive = fModality !== "all" || fPerformer !== "all" || Boolean(fDateFrom) || Boolean(fDateTo);
  function resetFilters() { setFModality("all"); setFPerformer("all"); setFDateFrom(""); setFDateTo(""); }

  const visible = useMemo(() => queue
    .filter((item) => {
      if (filter === "awaiting") return !["ready","signed","issued"].includes(item.documentStatus);
      if (filter === "ready") return item.documentStatus === "ready";
      if (filter === "signed") return item.documentStatus === "signed";
      if (filter === "issued") return item.documentStatus === "issued";
      return true;
    })
    .filter((item) => !query.trim() || `${item.code} ${item.name} ${item.serviceTitle} ${item.serviceCode}`.toLowerCase().includes(query.trim().toLowerCase()))
    .filter((item) => fModality === "all" || item.equipmentId === fModality)
    .filter((item) => fPerformer === "all" || item.assignedRadiologistEmail === fPerformer)
    .filter((item) => { const d = itemDate(item); return !fDateFrom || (Boolean(d) && d >= fDateFrom); })
    .filter((item) => { const d = itemDate(item); return !fDateTo || (Boolean(d) && d <= fDateTo); }),
  [queue,filter,query,fModality,fPerformer,fDateFrom,fDateTo]);

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
          <div className="protocolQueueFilters">
            <button type="button" className="protocolFilterToggle" aria-expanded={filtersOpen} onClick={()=>setFiltersOpen((v)=>!v)}>
              Фільтри{filtersActive ? <b> •</b> : ""}
            </button>
            {filtersActive && <button type="button" className="protocolFilterReset" onClick={resetFilters}>Скинути фільтри</button>}
          </div>
          {filtersOpen && <div className="protocolFilterPanel">
            <label><span>Модальність</span>
              <select value={fModality} onChange={(e)=>setFModality(e.target.value)} aria-label="Фільтр за модальністю">
                <option value="all">Усі модальності</option>
                {modalityOptions.map((m)=><option key={m} value={m}>{EQUIPMENT_LABELS[m] || m}</option>)}
              </select>
            </label>
            <label><span>Виконавець</span>
              <select value={fPerformer} onChange={(e)=>setFPerformer(e.target.value)} aria-label="Фільтр за виконавцем">
                <option value="all">Усі виконавці</option>
                {performerOptions.map((p)=><option key={p} value={p}>{p}</option>)}
              </select>
            </label>
            <label><span>Дата від</span>
              <input type="date" value={fDateFrom} max={fDateTo || undefined} onChange={(e)=>setFDateFrom(e.target.value)} aria-label="Дата дослідження від"/>
            </label>
            <label><span>Дата до</span>
              <input type="date" value={fDateTo} min={fDateFrom || undefined} onChange={(e)=>setFDateTo(e.target.value)} aria-label="Дата дослідження до"/>
            </label>
          </div>}
          {canCreateStudy && <div className="protocolQueueActions">
            <button type="button" className="protocolNewStudyButton" aria-expanded={newStudyOpen} onClick={()=>{ setNewStudyOpen((v)=>!v); setNsError(""); }}>+ Нове дослідження</button>
            <a className="protocolQueueLink" href="/staff/book">Заплановане (розклад)</a>
            <a className="protocolQueueLink" href="/staff/patients">Пацієнти</a>
          </div>}
          {canCreateStudy && newStudyOpen && <div className="protocolNewStudyForm">
            <p className="eyebrow">Швидке дослідження (walk-in) — без онлайн-заявки</p>
            {nsError && <p className="findingComposerWarn" role="alert">{nsError}</p>}
            <label><span>Пацієнт (ПІБ)</span><input value={nsName} maxLength={120} onChange={(e)=>setNsName(e.target.value)}/></label>
            <label><span>Телефон</span>
              <span className="protocolPhoneRow">
                <input value={nsPhone} maxLength={40} inputMode="tel" placeholder="0971234567" onChange={(e)=>{ setNsPhone(e.target.value); if (nsPatientId) unlinkPatient(); }}/>
                <button type="button" className="ghost" disabled={nsLookup.status==="loading"} onClick={()=>void checkPatient()}>{nsLookup.status==="loading" ? "Пошук…" : "Перевірити"}</button>
              </span>
            </label>
            {nsPatientId
              ? <p className="protocolModeHint">Прив’язано до картки пацієнта{nsLookup.label ? `: ${nsLookup.label}` : ""}. <button type="button" className="protocolInlineLink" onClick={unlinkPatient}>Відв’язати</button></p>
              : nsLookup.status==="found" && nsLookup.matches?.[0]
                ? <p className="protocolModeHint">Знайдено картку: {nsLookup.matches[0].displayName || nsLookup.matches[0].patientId}{nsLookup.matches[0].birthDate ? ` · ${nsLookup.matches[0].birthDate}` : ""}. <button type="button" className="protocolInlineLink" onClick={()=>linkPatient(nsLookup.matches![0])}>Прив’язати</button></p>
                : nsLookup.status==="ambiguous"
                  ? <div className="protocolModeHint"><p>{nsLookup.message}</p>{(nsLookup.matches||[]).map((m)=><p key={m.patientId}>{m.displayName || m.patientId}{m.birthDate ? ` · ${m.birthDate}` : ""} <button type="button" className="protocolInlineLink" onClick={()=>linkPatient(m)}>Прив’язати</button></p>)}</div>
                  : (nsLookup.status==="none" || nsLookup.status==="error") ? <p className={nsLookup.status==="error" ? "findingComposerWarn" : "protocolReadonlyHint"}>{nsLookup.message}</p> : null}
            <label><span>Дата народження (необов’язково)</span><input type="date" value={nsDob} onChange={(e)=>setNsDob(e.target.value)}/></label>
            <label><span>Послуга / модальність</span>
              <select value={nsService} onChange={(e)=>setNsService(e.target.value)}>
                {SERVICES.map((s)=><option key={s.code} value={s.code}>{s.title}</option>)}
              </select>
            </label>
            <label><span>Клінічні дані / показання</span><textarea value={nsIndication} maxLength={400} onChange={(e)=>setNsIndication(e.target.value)}/></label>
            <div className="protocolNewStudyActions">
              <button type="button" className="primary" disabled={nsSaving} onClick={()=>void createWalkInStudy()}>{nsSaving ? "Створення…" : "Створити й відкрити опис"}</button>
              <button type="button" className="ghost" onClick={()=>{ setNewStudyOpen(false); setNsError(""); }}>Скасувати</button>
            </div>
          </div>}
          {canCreateStudy && intakeRequests.length > 0 && <div className="intakePanel">
            <button type="button" className="intakePanelHead" aria-expanded={intakeOpen} onClick={()=>{ setIntakeOpen((v)=>!v); void loadIntakeRequests(); }}>📨 Вхідні заявки <b>{intakeRequests.length}</b></button>
            {intakeOpen && <ul className="intakeList">
              {intakeRequests.map((r)=><li key={r.id}>
                <p className="intakeMsg">{r.message}</p>
                <small>{r.channel} · {r.contact}{r.status==="in_progress" ? " · у роботі" : ""} · {formatDateTime(r.createdAt)}</small>
                <div className="intakeActions">
                  <button type="button" className="primary" disabled={intakeBusy===r.id} onClick={()=>startStudyFromIntake(r)}>Створити дослідження</button>
                  {r.status!=="in_progress" && <button type="button" disabled={intakeBusy===r.id} onClick={()=>void claimIntake(r.id)}>В роботу</button>}
                  <button type="button" onClick={()=>{ setConfirmFor(confirmFor===r.id ? null : r.id); setConfirmText(""); }}>Підтвердити</button>
                  <button type="button" className="ghost" disabled={intakeBusy===r.id} onClick={()=>void declineIntake(r.id)}>Відхилити</button>
                </div>
                {confirmFor===r.id && <div className="intakeConfirm">
                  <textarea value={confirmText} maxLength={600} placeholder="Текст підтвердження — без діагнозу, результатів чи зображень" onChange={(e)=>setConfirmText(e.target.value)}/>
                  <button type="button" className="primary" disabled={!confirmText.trim() || intakeBusy===r.id} onClick={()=>void sendIntakeConfirmation(r.id)}>Надіслати в Telegram</button>
                </div>}
              </li>)}
            </ul>}
          </div>}
        </div>
        <div className="protocolQueueList">
          {visible.length === 0 ? (query.trim() || filtersActive
            ? <p className="empty">За цим запитом досліджень не знайдено. <button type="button" className="protocolInlineLink" onClick={()=>{ setQuery(""); resetFilters(); }}>Скинути пошук і фільтри</button></p>
            : <p className="empty">Немає досліджень у цій категорії.</p>
          ) : visible.map((item) => <button
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
          {canCreateStudy && <p>Немає дослідження під рукою? <button type="button" className="protocolInlineLink" onClick={()=>{ setNewStudyOpen(true); setNsError(""); }}>Створити нове дослідження</button> (walk-in, без онлайн-заявки).</p>}
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

          {(booking.referral || booking.clinicalIndication || booking.referralNumber || booking.dateOfBirth) && <section className="protocolReferralBlock">
            <p className="eyebrow">Направлення та клінічні відомості</p>
            <dl>
              {booking.dateOfBirth && <div><dt>Дата народження</dt><dd>{booking.dateOfBirth}</dd></div>}
              {booking.referral && <div><dt>Направлення</dt><dd>{booking.referral}{booking.referralNumber ? ` · № ${booking.referralNumber}` : ""}</dd></div>}
              {booking.clinicalIndication && <div><dt>Клінічні показання</dt><dd>{booking.clinicalIndication}</dd></div>}
            </dl>
          </section>}

          <div className="protocolFilterTabs" role="group" aria-label="Режим роботи">
            <button type="button" aria-pressed={mode==="quick"} className={mode==="quick"?"active":""} onClick={()=>setMode("quick")}>Швидкий</button>
            <button type="button" aria-pressed={mode==="structured"} className={mode==="structured"?"active":""} onClick={()=>setMode("structured")}>Структурований</button>
            <button type="button" aria-pressed={mode==="free"} className={mode==="free"?"active":""} onClick={()=>setMode("free")}>Вільний</button>
          </div>
          {mode==="structured" && canEdit && <p className="protocolModeHint">Структурований режим: нижче доступні конструктор знахідок (КТ ОГК, головного мозку, ОЧП), особисті макроси та шаблони, перевірка суперечностей і попередній перегляд.</p>}
          {mode==="quick" && <p className="protocolReadonlyHint">Швидкий режим: натисніть «Заповнити норму», відкоригуйте номер і висновок — протокол готовий. Структуровані поля приховано (дані збережено). Щоб відкрити конструктор знахідок і макроси — перемкніться на «Структурований».</p>}
          {mode==="free" && <p className="protocolReadonlyHint">Вільний режим: структуровані поля й конструктор приховано; пишіть опис, висновок і рекомендації вручну. Збережені структуровані дані не втрачаються. Конструктор знахідок доступний у «Структурованому» режимі.</p>}

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

            {libCandidates.length > 0 && <div className="libraryImport">
              <p className="eyebrow">Імпортована бібліотека · на перевірці</p>
              <p className="aiDisclaimer">НЕперевірені шаблони (draft). Заповніть параметри й вставте чернетку — текст додасться в опис і висновок, нічого не перезаписуючи. Обов’язково перевірте й відредагуйте перед підписом.</p>
              <div className="findingComposerControls">
                <label><span>Знахідка з бібліотеки</span>
                  <select value={libFinding} onChange={(e)=>{ setLibFinding(e.target.value); setLibValues({}); setCError(""); }}>
                    <option value="">— оберіть —</option>
                    {libCandidates.map((c)=><option key={c.finding.id} value={c.finding.id}>{c.finding.name_uk}</option>)}
                  </select>
                </label>
                {libActiveParams.map((p)=><label key={p.key}><span>{libParamLabel(p.key, p.unit)}{p.required ? "" : " (необов’язково)"}</span>
                  <input inputMode={p.type === "number" ? "decimal" : "text"} value={libValues[p.key] || ""} placeholder={p.unit || ""}
                    onChange={(e)=>setLibValues((prev)=>({ ...prev, [p.key]:e.target.value }))}/>
                </label>)}
              </div>
              {libSelected?.possibleDuplicateOf && <p className="findingComposerWarn" role="status">⚠ Можливий дублікат наявної знахідки: «{libSelected.possibleDuplicateOf}». Перевірте, чи не дублюєте опис.</p>}
              <div className="aiDraftMeta">
                <button type="button" className="primary" disabled={!libReady || saving} onClick={addLibraryFinding}>Вставити чернетку в опис і висновок</button>
              </div>
            </div>}
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

          {canEdit && mode !== "quick" && <section className="protocolMacros">
            <div className="aiAssistHead">
              <div>
                <p className="eyebrow">Мої шаблони</p>
                <b>Особисті заготовки протоколів</b>
                <small>Збережіть поточний протокол як особистий шаблон і застосовуйте його до нових досліджень.</small>
              </div>
              <button type="button" onClick={()=>void saveAsTemplate()}>Зберегти поточний як шаблон</button>
            </div>
            {utError && <p className="findingComposerWarn" role="alert">{utError}</p>}
            {userTemplates.length > 0 ? <ul className="protocolMacrosList">
              {userTemplates.map((t)=><li key={t.id}>
                <button type="button" title={`Базовий шаблон: ${t.baseTemplateKey}`} onClick={()=>applyTemplate(t)}>{t.title}</button>
                <button type="button" className="protocolMacroDelete" aria-label={`Видалити шаблон «${t.title}»`} onClick={()=>void deleteUserTemplate(t.id)}>✕</button>
              </li>)}
            </ul> : <p className="protocolMacrosEmpty">Ще немає збережених шаблонів.</p>}
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

          {contradictions.length > 0 && <section className="protocolContradictions" role="status" aria-live="polite">
            <p className="eyebrow">Перевірка суперечностей</p>
            {contradictions.map((c)=><p key={c.code} className="findingComposerWarn">⚠ {c.message}</p>)}
            <small>Це дорадчі сигнали — текст не змінюється автоматично. Перевірте й відредагуйте за потреби.</small>
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

          {priorStudies.length > 0 && <section className="protocolCompare" aria-label="Порівняння з попереднім дослідженням">
            <p className="eyebrow">Порівняння з попереднім дослідженням</p>
            <label className="protocolCompareSelect"><span>Попереднє дослідження того самого пацієнта</span>
              <select value={compareId ?? ""} onChange={(e)=>void loadComparison(Number(e.target.value) || null)}>
                <option value="">— оберіть —</option>
                {priorStudies.map((p)=><option key={p.id} value={p.id}>{p.service} · {p.performedAt ? formatDateTime(p.performedAt) : p.desiredDate}{p.protocolNumber ? ` · №${p.protocolNumber}` : ""}</option>)}
              </select>
            </label>
            {compareLoading ? <p className="protocolReadonlyHint">Завантаження…</p>
              : compareText && <div className="protocolCompareGrid">
                  <div><b>Попереднє дослідження</b><pre>{compareText}</pre></div>
                  <div><b>Поточне дослідження</b><pre>{renderProtocolText(docToProtocol(doc))}</pre></div>
                </div>}
            {compareId ? <p className="protocolReadonlyHint">Порівняння довідкове (read-only). Динаміку формулює лікар; попередній протокол не змінюється. Різні модальності не означають регрес автоматично.</p> : null}
            {compareId && canEdit && <div className="protocolAutoCompare">
              <button type="button" onClick={runAutoCompare} disabled={composed.length === 0 && comparePriorStructured.length === 0}>Авто-порівняння структурованих знахідок (E3)</button>
              {composed.length === 0 && <small className="protocolFieldHint">Авто-порівняння працює зі структурованими знахідками конструктора. Для поточного дослідження їх ще немає — додайте знахідки через конструктор.</small>}
              {autoDelta && (autoDelta.ok
                ? <div className="protocolAutoCompareResult">
                    <pre>{autoDelta.draft}</pre>
                    <button type="button" className="primary" disabled={!autoDelta.draft.trim() || saving} onClick={insertDynamicsDraft}>Вставити чернетку динаміки у висновок</button>
                  </div>
                : <p className="findingComposerWarn" role="status">⚠ {autoDelta.note}</p>)}
            </div>}
          </section>}

          {revisions.length > 0 && <section className="protocolRevisions" aria-label="Історія версій протоколу">
            <p className="eyebrow">Історія версій та виправлень</p>
            <ol className="protocolRevisionList">
              {revisions.map((r)=><li key={r.version}>
                <b>Версія {r.version}</b>
                <span className={`protocolTag ${r.status}`}>{lifecycleLabel(r.status)}</span>
                {r.number && <span>№ {r.number}</span>}
                <small>{r.savedBy || "—"}{r.createdAt ? ` · ${formatDateTime(r.createdAt)}` : ""}</small>
              </li>)}
            </ol>
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
