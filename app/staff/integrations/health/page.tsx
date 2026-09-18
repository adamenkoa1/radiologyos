"use client";

import { useEffect, useState } from "react";
import StaffWorkspaceShell from "../../workspace-shell";

type Health = {
  pacs:{ state:string; configured:boolean; enabled:boolean; reachable:boolean; viewerConfigured:boolean; aeTitleConfigured:boolean; updatedAt:string; autoLinkReady:boolean };
  mwl:{ state:string; configured:boolean; active:boolean; createdAt:string; rotatedAt:string; lastUsedAt:string; ready:boolean };
  overall:string;
};

const LABELS:Record<string,string> = {
  operational:"Працює",
  attention_required:"Потрібна увага",
  not_configured:"Не налаштовано",
  disabled:"Вимкнено",
  unreachable:"PACS недоступний",
  awaiting_first_use:"Очікує першого підключення",
};

export default function IntegrationHealthPage() {
  const [data,setData] = useState<Health | null>(null);
  const [error,setError] = useState("");
  const [busy,setBusy] = useState(false);

  async function load() {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/staff/integrations/health", { cache:"no-store" });
      const payload = await response.json() as Health & { error?:string };
      if (!response.ok) { setError(payload.error || "Не вдалося перевірити інтеграції"); return; }
      setData(payload);
    } catch {
      setError("Не вдалося перевірити інтеграції");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  return <StaffWorkspaceShell
    active="imaging"
    title="Стан PACS / MWL"
    description="Операційна перевірка інтеграцій без показу токенів, паролів або інших секретів."
  >
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:12,flexWrap:"wrap"}}>
      <p><b>Загальний стан:</b> {data ? (LABELS[data.overall] || data.overall) : "—"}</p>
      <button type="button" disabled={busy} onClick={()=>void load()}>{busy ? "Перевіряю…" : "Перевірити зараз"}</button>
    </div>
    {error && <p className="staffError" role="alert">{error}</p>}

    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(280px,1fr))",gap:16,marginTop:16}}>
      <section className="pacsSettings" style={{display:"block"}}>
        <h2>PACS / DICOMweb</h2>
        <p><b>Стан:</b> {data ? (LABELS[data.pacs.state] || data.pacs.state) : "—"}</p>
        <p><b>Auto-link:</b> {data?.pacs.autoLinkReady ? "готовий" : "не готовий"}</p>
        <p><b>Viewer:</b> {data?.pacs.viewerConfigured ? "налаштований" : "не налаштований"}</p>
        <p><b>AE Title:</b> {data?.pacs.aeTitleConfigured ? "налаштований" : "не налаштований"}</p>
        {data?.pacs.updatedAt && <p><b>Оновлено:</b> {data.pacs.updatedAt}</p>}
        {!data?.pacs.configured && <p>Додайте DICOMweb URL у налаштуваннях PACS.</p>}
        {data?.pacs.configured && data?.pacs.enabled && !data?.pacs.reachable && <p>Перевірте мережеву доступність PACS та allowlist вихідних хостів.</p>}
      </section>

      <section className="pacsSettings" style={{display:"block"}}>
        <h2>Modality Worklist bridge</h2>
        <p><b>Стан:</b> {data ? (LABELS[data.mwl.state] || data.mwl.state) : "—"}</p>
        <p><b>Токен:</b> {data?.mwl.active ? "активний" : data?.mwl.configured ? "вимкнений" : "не створений"}</p>
        {data?.mwl.rotatedAt && <p><b>Остання ротація:</b> {data.mwl.rotatedAt}</p>}
        {data?.mwl.lastUsedAt && <p><b>Останнє використання:</b> {data.mwl.lastUsedAt}</p>}
        {data?.mwl.active && !data?.mwl.lastUsedAt && <p>Bridge готовий, але локальний сервіс ще не звертався до feed.</p>}
        {!data?.mwl.active && <p>Створіть або активуйте bridge token у розділі Modality Worklist.</p>}
      </section>
    </div>
  </StaffWorkspaceShell>;
}
