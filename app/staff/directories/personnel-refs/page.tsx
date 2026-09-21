"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import StaffWorkspaceShell from "../../workspace-shell";

type Row = { id:number; name:string; active:number };
type Kind = "position" | "rank";
type ApiData = { positions:Row[]; ranks:Row[] };

const KINDS:{ kind:Kind; title:string; hint:string }[] = [
  { kind:"position", title:"Посади", hint:"Використовуються як підказки в полі «Основна посада» картки працівника." },
  { kind:"rank", title:"Звання", hint:"Використовуються як підказки в полі «Військове звання» картки працівника." },
];

export default function PersonnelDirectoriesPage() {
  const [data, setData] = useState<ApiData>({ positions:[], ranks:[] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const response = await fetch("/api/staff/personnel/directories", { cache:"no-store" });
      const body = await response.json().catch(() => ({})) as Partial<ApiData> & { error?:string };
      if (!response.ok) throw new Error(body.error || "Не вдалося завантажити довідники");
      setData({ positions:body.positions || [], ranks:body.ranks || [] });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не вдалося завантажити довідники");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function send(method:"POST" | "PATCH", payload:Record<string, unknown>, okMessage:string) {
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/staff/personnel/directories", {
        method, headers:{ "content-type":"application/json" }, body:JSON.stringify(payload),
      });
      const body = await response.json().catch(() => ({})) as { ok?:boolean; error?:string };
      if (!response.ok || !body.ok) throw new Error(body.error || "Не вдалося зберегти зміну");
      await load(); setNotice(okMessage);
    } catch (e) { setError(e instanceof Error ? e.message : "Не вдалося зберегти зміну"); }
    finally { setBusy(false); }
  }

  function addValue(kind:Kind) {
    return (event:FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const form = event.currentTarget;
      const input = form.elements.namedItem("name") as HTMLInputElement | null;
      const name = (input?.value || "").trim();
      if (!name) return;
      form.reset();
      void send("POST", { kind, name }, "Значення додано.");
    };
  }
  function rename(kind:Kind, row:Row) {
    return (event:FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const form = event.currentTarget;
      const input = form.elements.namedItem("name") as HTMLInputElement | null;
      const name = (input?.value || "").trim();
      if (!name || name === row.name) return;
      void send("PATCH", { kind, id:row.id, name }, "Назву оновлено.");
    };
  }
  function toggle(kind:Kind, row:Row) {
    void send("PATCH", { kind, id:row.id, active:row.active ? 0 : 1 }, row.active ? "Значення приховано." : "Значення відновлено.");
  }

  return <StaffWorkspaceShell active="directories" title="Довідники посад і звань" description="Посади та військові звання для кадрових карток. Значення живлять підказки у формі працівника; приховане значення не пропонується для нових карток, але вже збережені картки не змінюються.">
    {notice && <p className="notice success" role="status">{notice}</p>}
    {error && <p className="notice error" role="alert">{error}</p>}

    {KINDS.map(({ kind, title, hint }) => {
      const rows = kind === "position" ? data.positions : data.ranks;
      return <section className="financeJournal" key={kind}>
        <header className="financeToolbar"><div><b>{title}</b><small>{hint}</small></div></header>
        <form className="shiftPlannerToolbar" onSubmit={addValue(kind)}>
          <input name="name" placeholder={kind === "position" ? "Нова посада…" : "Нове звання…"} aria-label={`Додати: ${title}`} maxLength={160} required />
          <button className="button primary" type="submit" disabled={busy}>Додати</button>
        </form>
        {loading ? <p className="notice">Завантаження…</p> : <div className="financeTableWrap"><table className="financeTable">
          <thead><tr><th>Назва</th><th>Статус</th><th/></tr></thead>
          <tbody>{rows.map((row) => <tr key={row.id}>
            <td>
              <form style={{display:"flex",gap:8,alignItems:"center"}} onSubmit={rename(kind, row)}>
                <input name="name" defaultValue={row.name} aria-label={`Назва: ${row.name}`} maxLength={160} style={{flex:1}} />
                <button className="button secondary" type="submit" disabled={busy}>Перейменувати</button>
              </form>
            </td>
            <td><span className={`statusPill ${row.active ? "ok" : ""}`}>{row.active ? "Активне" : "Приховане"}</span></td>
            <td><button className="button secondary" type="button" disabled={busy} onClick={() => toggle(kind, row)}>{row.active ? "Приховати" : "Відновити"}</button></td>
          </tr>)}</tbody>
        </table>{!rows.length && <p className="notice">Значень ще немає.</p>}</div>}
      </section>;
    })}
  </StaffWorkspaceShell>;
}
