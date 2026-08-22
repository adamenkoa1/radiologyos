"use client";

import { useEffect, useMemo, useState } from "react";
import StaffWorkspaceShell from "../workspace-shell";
import { roleLabelUk } from "../../../lib/labels";

type StaffInfo = { email: string; displayName: string; role: string };
type Tariff = { code: string; title: string; group: string; defaultPrice: number; price: number; custom: boolean; active: boolean };

const money = new Intl.NumberFormat("uk-UA");

export default function StaffTariffsPage() {
  const [staff, setStaff] = useState<StaffInfo | null>(null);
  const [tariffs, setTariffs] = useState<Tariff[]>([]);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [activeEdits, setActiveEdits] = useState<Record<string, boolean>>({});
  const [status, setStatus] = useState<"idle" | "saving">("idle");
  const [loaded, setLoaded] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const isAdmin = staff?.role === "admin";

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch("/api/staff/tariffs", { cache: "no-store" });
        const data = await res.json().catch(() => ({})) as { tariffs?: Tariff[]; staff?: StaffInfo; error?: string };
        if (!active) return;
        if (data.tariffs) setTariffs(data.tariffs);
        if (data.staff) setStaff(data.staff);
        if (!res.ok) setError(data.error || "Не вдалося завантажити тарифи");
      } catch {
        if (active) setError("Не вдалося завантажити тарифи — перевірте зʼєднання");
      } finally {
        if (active) setLoaded(true);
      }
    })();
    return () => { active = false; };
  }, []);

  const groups = useMemo(() => {
    const map = new Map<string, Tariff[]>();
    for (const t of tariffs) { if (!map.has(t.group)) map.set(t.group, []); map.get(t.group)!.push(t); }
    return [...map.entries()];
  }, [tariffs]);

  async function save() {
    setStatus("saving"); setNotice(""); setError("");
    const prices: Record<string, number> = {};
    for (const [code, raw] of Object.entries(edits)) {
      const n = Number(raw);
      if (raw.trim() !== "" && Number.isFinite(n)) prices[code] = Math.round(n);
    }
    try {
      const res = await fetch("/api/staff/tariffs", {
        method: "PUT", headers: { "content-type": "application/json" },
        body: JSON.stringify({ prices, active: activeEdits }),
      });
      const data = await res.json().catch(() => ({})) as { ok?: boolean; error?: string; tariffs?: Tariff[] };
      if (!res.ok || !data.ok) throw new Error(data.error || "Не вдалося зберегти");
      if (data.tariffs) setTariffs(data.tariffs);
      setEdits({});
      setActiveEdits({});
      setNotice("Тарифи збережено");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не вдалося зберегти");
    } finally {
      setStatus("idle");
    }
  }

  const dirty = Object.keys(edits).length > 0 || Object.keys(activeEdits).length > 0;

  return (
    <StaffWorkspaceShell
      active="tariffs"
      title="Тарифи"
      description="Прайс на платні дослідження для цивільних пацієнтів. Військовим — безоплатно."
      staffName={staff?.displayName}
      staffRole={roleLabelUk(staff?.role)}
    >
      <div className="tariffPage">
        {isAdmin && (
          <div className="tariffBar">
            <span>Змініть ціну в полі або вимкніть/увімкніть позицію, тоді натисніть «Зберегти». Порожнє поле чи значення, що дорівнює стандартному, повертає тариф до типового; вимкнена позиція зникає з онлайн-запису.</span>
            <button className="button" onClick={save} disabled={!dirty || status === "saving"}>
              {status === "saving" ? "Зберігаємо…" : "Зберегти тарифи"}
            </button>
          </div>
        )}
        {notice && <p className="notice success" role="status">{notice}</p>}
        {error && <p className="notice error" role="alert">{error}</p>}

        {!loaded ? <p className="notice">Завантаження тарифів…</p> :
         groups.length === 0 ? <p className="dashListEmpty">Тарифів не знайдено.</p> :
         groups.map(([group, items]) => (
          <section className="tariffGroup" key={group}>
            <h2>{group}</h2>
            <table className="tariffTable">
              <thead><tr><th>Код</th><th>Дослідження</th><th>Ціна, грн</th><th>Стан</th></tr></thead>
              <tbody>
                {items.map((t) => {
                  const value = edits[t.code] ?? String(t.price);
                  const isActive = activeEdits[t.code] ?? t.active;
                  return (
                    <tr key={t.code} style={isActive ? undefined : { opacity: 0.55 }}>
                      <td className="tariffCode">{t.code}</td>
                      <td>{t.title}{t.custom && <span className="tariffCustom">змінено</span>}{!isActive && <span className="tariffCustom">вимкнено</span>}</td>
                      <td className="tariffPrice">
                        {isAdmin ? (
                          <input inputMode="numeric" value={value}
                            onChange={(e) => setEdits((prev) => ({ ...prev, [t.code]: e.target.value.replace(/\D/g, "") }))} />
                        ) : (
                          <b>{money.format(t.price)}</b>
                        )}
                      </td>
                      <td className="tariffState">
                        {isAdmin ? (
                          <button type="button" className={`button ${isActive ? "secondary" : ""}`}
                            aria-pressed={isActive}
                            onClick={() => setActiveEdits((prev) => {
                              const next = { ...prev };
                              const target = !isActive;
                              if (target === t.active) delete next[t.code];
                              else next[t.code] = target;
                              return next;
                            })}>
                            {isActive ? "Вимкнути" : "Увімкнути"}
                          </button>
                        ) : (
                          <span>{isActive ? "Активна" : "Вимкнена"}</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>
        ))}
      </div>
    </StaffWorkspaceShell>
  );
}
