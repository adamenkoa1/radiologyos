"use client";

import { useEffect, useState } from "react";
import StaffWorkspaceShell from "../../workspace-shell";

type Status = {
  configured:boolean;
  active:boolean;
  createdBy:string;
  createdAt:string;
  rotatedAt:string;
  lastUsedAt:string;
};

export default function MwlBridgeAdminPage() {
  const [status,setStatus] = useState<Status | null>(null);
  const [token,setToken] = useState("");
  const [error,setError] = useState("");
  const [busy,setBusy] = useState(false);

  async function load() {
    const response = await fetch("/api/staff/integrations/mwl-token", { cache:"no-store" });
    const data = await response.json() as Status & { error?:string };
    if (!response.ok) { setError(data.error || "Немає доступу"); return; }
    setStatus(data); setError("");
  }

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  async function rotate() {
    setBusy(true); setError(""); setToken("");
    const response = await fetch("/api/staff/integrations/mwl-token", {
      method:"POST", headers:{ "content-type":"application/json" }, body:"{}",
    });
    const data = await response.json() as { token?:string; error?:string };
    setBusy(false);
    if (!response.ok || !data.token) { setError(data.error || "Не вдалося створити токен"); return; }
    setToken(data.token);
    await load();
  }

  async function disable() {
    setBusy(true); setError(""); setToken("");
    const response = await fetch("/api/staff/integrations/mwl-token", { method:"DELETE" });
    const data = await response.json() as { ok?:boolean; error?:string };
    setBusy(false);
    if (!response.ok || !data.ok) { setError(data.error || "Не вдалося вимкнути bridge"); return; }
    await load();
  }

  return <StaffWorkspaceShell
    active="imaging"
    title="Modality Worklist bridge"
    description="Захищений канал для локального DICOM/MWL bridge. Токен має доступ до мінімального набору даних, потрібного модальностям."
  >
    {error && <p className="staffError" role="alert">{error}</p>}
    <section className="pacsSettings" style={{display:"block"}}>
      <h2>Bridge token</h2>
      <p><b>Стан:</b> {status?.active ? "активний" : status?.configured ? "вимкнений" : "не налаштовано"}</p>
      {status?.rotatedAt && <p><b>Остання ротація:</b> {status.rotatedAt}</p>}
      {status?.lastUsedAt && <p><b>Останнє використання:</b> {status.lastUsedAt}</p>}
      <div style={{display:"flex",gap:10,flexWrap:"wrap",margin:"16px 0"}}>
        <button type="button" disabled={busy} onClick={()=>void rotate()}>{status?.configured ? "Ротувати токен" : "Створити токен"}</button>
        {status?.active && <button type="button" className="ghost" disabled={busy} onClick={()=>void disable()}>Вимкнути bridge</button>}
      </div>
      {token && <div className="staffSuccess" role="status">
        <b>Скопіюйте токен зараз — повторно він не показується.</b>
        <pre style={{whiteSpace:"pre-wrap",wordBreak:"break-all",userSelect:"all"}}>{token}</pre>
      </div>}
      <p>Feed: <code>/api/integrations/mwl</code>. Передавайте токен лише в заголовку <code>Authorization: Bearer …</code>. Не додавайте його до URL або логів.</p>
      <p>Рекомендовано, щоб цей endpoint викликав лише локальний bridge-сервіс, який уже всередині захищеної мережі надає DIMSE MWL або DICOMweb Modality Scheduled Procedure Step сервіс апаратам.</p>
    </section>
  </StaffWorkspaceShell>;
}
