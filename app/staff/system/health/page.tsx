"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import StaffWorkspaceShell from "../../workspace-shell";

type State = "operational" | "attention_required";
type Payload = {
  overall:State;
  checkedAt:string;
  checks:Record<string,{ state:State; detail:string }>;
  imaging:{ pacsConfigured:boolean; pacsEnabled:boolean; mwlConfigured:boolean; mwlActive:boolean; mwlUsed:boolean };
};

const LABELS:Record<string,string> = {
  database:"База даних D1",
  authentication:"Авторизація і tenant",
  bookings:"Запис пацієнтів",
  payments:"Платежі",
  imaging:"PACS / MWL",
};

const STATE_LABELS:Record<State,string> = {
  operational:"Працює",
  attention_required:"Потрібна увага",
};

export default function SystemHealthPage() {
  const [data,setData] = useState<Payload | null>(null);
  const [error,setError] = useState("");
  const [busy,setBusy] = useState(false);

  async function load() {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/staff/system/health", { cache:"no-store" });
      const payload = await response.json() as Payload & { error?:string };
      if (!response.ok) { setError(payload.error || "Не вдалося перевірити стан системи"); return; }
      setData(payload);
    } catch {
      setError("Не вдалося перевірити стан системи");
    } finally {
      setBusy(false);
    }
  }

  useEffect(()=>{
    const timer = window.setTimeout(()=>{ void load(); },0);
    return ()=>window.clearTimeout(timer);
  },[]);

  return <StaffWorkspaceShell
    active="settings"
    title="Стан системи"
    description="Read-only перевірка критичних production-потоків без даних пацієнтів і без секретів."
  >
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:12,flexWrap:"wrap"}}>
      <p><b>Загальний стан:</b> {data ? STATE_LABELS[data.overall] : "—"}</p>
      <button type="button" disabled={busy} onClick={()=>void load()}>{busy ? "Перевіряю…":"Перевірити зараз"}</button>
    </div>
    {error && <p className="staffError" role="alert">{error}</p>}
    {data?.checkedAt && <p><small>Остання перевірка: {new Date(data.checkedAt).toLocaleString("uk-UA")}</small></p>}

    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(260px,1fr))",gap:16,marginTop:16}}>
      {data && Object.entries(data.checks).map(([key,check])=><section className="pacsSettings" style={{display:"block"}} key={key}>
        <h2>{LABELS[key] || key}</h2>
        <p><b>Стан:</b> {STATE_LABELS[check.state]}</p>
        <p>{check.detail}</p>
        {key === "imaging" && <p><Link href="/staff/integrations/health">Відкрити детальну перевірку PACS / MWL</Link></p>}
      </section>)}
    </div>
  </StaffWorkspaceShell>;
}
