"use client";

// Спільна права панель-drawer із контекстом запису (Єдиний Workspace).
// Використовується у Календарі та на Пульті: клік по запису відкриває контекст
// без переходу на іншу сторінку. Дані приходять пропсами — без бекенду.

import { useEffect, useState } from "react";
import { type CalBooking } from "./week-calendar";
import { stateLabel } from "../../lib/study-state";

const EQUIP: Record<string, string> = { ct: "КТ", xray: "Рентген", fluoro: "Флюорограф" };
const GROUPS: Record<string, string[]> = {
  planned: ["new", "requested", "needs_verification", "scheduled", "rescheduled"],
  confirmed: ["confirmed"], arrived: ["arrived"], inroom: ["queued", "in_progress"],
  done: ["performed", "images_ready", "reporting", "protocol_ready", "issued", "completed"],
  cancelled: ["cancelled", "no_show"],
};
function groupOf(status: string): string {
  for (const [group, list] of Object.entries(GROUPS)) if (list.includes(status)) return group;
  return "planned";
}
const isContrast = (svc: string) => /контраст|ангіограф/i.test(svc || "");
const digits = (p: string) => (p || "").replace(/[^\d]/g, "");

export default function BookingDrawer({ booking, all, doctorName = "", onClose, onOpen, onConfirm, confirming = false, onReschedule, rescheduling = false }: {
  booking: CalBooking;
  all: CalBooking[];
  doctorName?: string;
  onClose: () => void;
  onOpen: (id: number) => void;
  onConfirm?: (id: number) => void;
  confirming?: boolean;
  onReschedule?: (id: number, date: string, time: string) => void;
  rescheduling?: boolean;
}) {
  const b = booking;
  const ph = digits(b.phone);
  const history = ph
    ? all.filter(x => x.id !== b.id && digits(x.phone) === ph)
        .sort((a, c) => (c.desiredDate + c.desiredTime).localeCompare(a.desiredDate + a.desiredTime))
    : [];
  const canConfirm = !!onConfirm && (b.status === "new" || b.status === "rescheduled");
  const canReschedule = !!onReschedule && b.status !== "cancelled" && b.status !== "completed" && b.status !== "issued";

  // Перенесення прямо з панелі: дата + вільний слот (перевірка доступності).
  const [reschedOpen, setReschedOpen] = useState(false);
  const [rDate, setRDate] = useState(b.desiredDate);
  const [rTime, setRTime] = useState(b.desiredTime);
  const [rTimes, setRTimes] = useState<string[]>([]);
  const [rLoading, setRLoading] = useState(false);

  // Разове повідомлення пацієнту (результат готовий, затримка, жива черга).
  const NOTIFY_PRESETS = [
    "Ваш результат готовий — можна забрати опис у відділенні.",
    "Невелика затримка за розкладом, дякуємо за очікування.",
    "Підійдіть, будь ласка, до реєстратури відділення.",
  ];
  const [notifyOpen, setNotifyOpen] = useState(false);
  const [msg, setMsg] = useState("");
  const [sending, setSending] = useState(false);
  const [notifyResult, setNotifyResult] = useState("");
  async function sendNotify() {
    if (msg.trim().length < 3) return;
    setSending(true); setNotifyResult("");
    try {
      const res = await fetch("/api/staff/notify", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ bookingId: b.id, message: msg.trim() }),
      });
      const data = await res.json().catch(() => ({})) as { error?: string; summary?: { sent: number; skipped: number; failed: number } };
      if (!res.ok) { setNotifyResult(data.error || "Не вдалося надіслати"); return; }
      const s = data.summary || { sent: 0, skipped: 0, failed: 0 };
      if (s.sent > 0) { setNotifyResult("✓ Надіслано пацієнту"); setMsg(""); }
      else if (s.failed > 0) setNotifyResult("⚠ Не доставлено — перевірте канал або номер");
      else setNotifyResult("Пропущено: канал вимкнено або пацієнт у «не турбувати»");
    } catch { setNotifyResult("Помилка мережі — спробуйте ще раз"); }
    finally { setSending(false); }
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Вільні слоти на обрану дату для послуги запису.
  useEffect(() => {
    const ctrl = new AbortController();
    const t = window.setTimeout(() => {
      if (!reschedOpen || !rDate || !b.serviceCode) { setRTimes([]); return; }
      setRLoading(true);
      fetch(`/api/availability?date=${encodeURIComponent(rDate)}&serviceCode=${encodeURIComponent(b.serviceCode)}`, { signal: ctrl.signal, cache: "no-store" })
        .then(r => r.ok ? r.json() : { times: [] })
        .then(d => setRTimes(Array.isArray(d.times) ? d.times : []))
        .catch(() => {})
        .finally(() => setRLoading(false));
    }, 0);
    return () => { ctrl.abort(); window.clearTimeout(t); };
  }, [reschedOpen, rDate, b.serviceCode]);

  return <div className="apptDrawer" role="dialog" aria-modal="false" aria-label={`Заявка ${b.name || ""}`}>
    <div className="apptDrawerBackdrop" onClick={onClose} />
    <aside className="apptDrawerPanel">
      <div className="apptDrawerHead">
        <div>
          <h3>{ph ? <a className="patLink" href={`/staff/patients?phone=${ph}`}>{b.name || "Без імені"}</a> : (b.name || "Без імені")}</h3>
          <small><span className="codeTag">{b.code}</span> · {b.desiredDate} · {b.desiredTime || "—"}{doctorName ? ` · 👨‍⚕️ ${doctorName}` : ""}</small>
        </div>
        <button type="button" className="apptDrawerClose" onClick={onClose} aria-label="Закрити">✕</button>
      </div>

      <div className="apptDrawerChips">
        <span className={`apptTag ${b.patientCategory === "military" ? "mil" : "paid"}`}>{b.patientCategory === "military" ? "Військовий" : "Цивільний"}</span>
        {isContrast(b.service) && <span className="apptTag contrast">Контраст</span>}
        {b.patientCategory === "civilian" && <span className={`apptTag ${b.paymentStatus === "paid" ? "paid" : "pay"}`}>{b.paymentStatus === "paid" ? `Оплачено${b.paymentAmount ? ` · ${b.paymentAmount} грн` : ""}` : `Перевірити оплату${b.paymentAmount ? ` · ${b.paymentAmount} грн` : ""}`}</span>}
        <span className={`apptBadge grp-${groupOf(b.status)}`}>{stateLabel(b.status)}</span>
      </div>

      <dl className="apptDrawerFacts">
        <div><dt>Дослідження</dt><dd>{b.service}{b.equipmentId ? ` · ${EQUIP[b.equipmentId] || b.equipmentId}` : ""}</dd></div>
        <div><dt>Дата й час</dt><dd>{b.desiredDate} · {b.desiredTime || "—"}</dd></div>
        {doctorName && <div><dt>Лікар</dt><dd>{doctorName}</dd></div>}
        <div><dt>Телефон</dt><dd>{b.phone || "—"}</dd></div>
      </dl>

      {isContrast(b.service) && <p className="apptDrawerNote">Дослідження з контрастуванням — попередьте про підготовку (креатинін, алергоанамнез, натще).</p>}

      <div className="apptDrawerHistory">
        <div className="apptDrawerHistoryHead"><b>Попередні дослідження</b><span>{history.length}</span></div>
        {history.length === 0
          ? <p className="apptDrawerHistoryEmpty">Перше звернення (за номером телефону).</p>
          : <ul>{history.slice(0, 8).map(h => <li key={h.id}>
              <button type="button" onClick={() => onOpen(h.id)}>
                <span className="ihDate">{h.desiredDate}</span>
                <span className="ihSvc">{h.service}{h.equipmentId ? ` · ${EQUIP[h.equipmentId] || h.equipmentId}` : ""}</span>
                <span className="ihStatus">{stateLabel(h.status)}</span>
              </button></li>)}
            {history.length > 8 && <li className="ihMore">…і ще {history.length - 8}</li>}
          </ul>}
      </div>

      {canReschedule && reschedOpen && <div className="apptDrawerResched">
        <div className="apptDrawerReschedRow">
          <label><span>Дата</span><input type="date" value={rDate} onChange={e=>setRDate(e.target.value)} /></label>
          <label><span>Час</span><select value={rTime} onChange={e=>setRTime(e.target.value)}>
            <option value="">{rLoading ? "…" : "—"}</option>
            {(rTimes.includes(rTime) || !rTime ? rTimes : [rTime, ...rTimes]).map(t => <option key={t} value={t}>{t}</option>)}
          </select></label>
        </div>
        {!rLoading && b.serviceCode && rTimes.length === 0 && <p className="apptDrawerReschedHint">На цю дату вільних слотів немає.</p>}
        <div className="apptDrawerReschedActions">
          <button type="button" className="apptDrawerBtn primary" disabled={rescheduling || !rDate || !rTime} onClick={()=>onReschedule!(b.id, rDate, rTime)}>{rescheduling ? "…" : `Перенести на ${rDate} ${rTime}`}</button>
          <button type="button" className="apptDrawerBtn" onClick={()=>setReschedOpen(false)}>Скасувати</button>
        </div>
      </div>}

      {notifyOpen && <div className="apptDrawerResched">
        <div className="apptDrawerNotifyPresets">
          {NOTIFY_PRESETS.map((p, i) => <button key={i} type="button" className="apptDrawerChipBtn" onClick={()=>setMsg(p)}>{p.length > 30 ? p.slice(0, 30) + "…" : p}</button>)}
        </div>
        <textarea className="apptDrawerNotifyText" rows={3} maxLength={500} value={msg} onChange={e=>setMsg(e.target.value)} placeholder="Текст повідомлення пацієнту (WhatsApp / SMS)…" />
        {notifyResult && <p className="apptDrawerReschedHint">{notifyResult}</p>}
        <div className="apptDrawerReschedActions">
          <button type="button" className="apptDrawerBtn primary" disabled={sending || msg.trim().length < 3} onClick={sendNotify}>{sending ? "…" : "Надіслати повідомлення"}</button>
          <button type="button" className="apptDrawerBtn" onClick={()=>{ setNotifyOpen(false); setNotifyResult(""); }}>Закрити</button>
        </div>
      </div>}

      <div className="apptDrawerActions">
        {canConfirm && <button type="button" className="apptDrawerBtn confirm" disabled={confirming} onClick={() => onConfirm!(b.id)}>{confirming ? "…" : "✓ Підтвердити"}</button>}
        {canReschedule && !reschedOpen && <button type="button" className="apptDrawerBtn" onClick={()=>setReschedOpen(true)}>↻ Перенести</button>}
        {ph && <button type="button" className="apptDrawerBtn" onClick={()=>setNotifyOpen(v=>!v)}>✉ Повідомити</button>}
        {ph && <a className="apptDrawerBtn" href={`tel:${b.phone}`}>📞 Подзвонити</a>}
        {ph && <a className="apptDrawerBtn wa" href={`https://wa.me/${ph}`} target="_blank" rel="noreferrer">WhatsApp</a>}
        {ph && <a className="apptDrawerBtn" href={`/staff/patients?phone=${ph}`}>Картка пацієнта →</a>}
        <a className="apptDrawerBtn primary" href={`/staff?open=${b.id}#bookings`}>Відкрити повну заявку →</a>
      </div>
    </aside>
  </div>;
}
