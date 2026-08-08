"use client";

import { useEffect, useState } from "react";
import StaffWorkspaceShell from "../workspace-shell";
import WeekCalendar, { type CalBooking, type CalEquipmentBlock, type CalStaffOption, type CalView } from "../week-calendar";
import { SCHEDULE_DEFAULTS, type ScheduleConfig } from "../../../lib/schedule";

type StaffOption = { email: string; displayName: string; role: string };

export default function StaffAppointmentsPage() {
  const [staff, setStaff] = useState<StaffOption | null>(null);
  const [items, setItems] = useState<CalBooking[]>([]);
  const [options, setOptions] = useState<CalStaffOption[]>([]);
  const [schedule, setSchedule] = useState<ScheduleConfig>(SCHEDULE_DEFAULTS);
  const [blocks, setBlocks] = useState<CalEquipmentBlock[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [forbidden, setForbidden] = useState(false);
  const [initialView, setInitialView] = useState<CalView>("day");
  const [initialDate, setInitialDate] = useState<string | undefined>(undefined);
  const [busyId, setBusyId] = useState<number | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      const [res, scheduleRes, equipmentRes] = await Promise.all([
        fetch("/api/staff/bookings", { cache: "no-store" }),
        fetch("/api/staff/schedule", { cache: "no-store" }),
        fetch("/api/staff/equipment", { cache: "no-store" }),
      ]);
      if (res.status === 401 || res.status === 403) { if (active) setForbidden(true); return; }
      const data = await res.json().catch(() => ({})) as { bookings?: CalBooking[]; staffOptions?: StaffOption[]; staff?: StaffOption };
      const scheduleData = await scheduleRes.json().catch(() => ({})) as { schedule?: ScheduleConfig };
      const equipmentData = await equipmentRes.json().catch(() => ({})) as { blocks?: CalEquipmentBlock[] };
      if (!active) return;
      setItems(data.bookings || []);
      setOptions(data.staffOptions || []);
      if (data.staff) setStaff(data.staff);
      if (scheduleData.schedule) setSchedule(scheduleData.schedule);
      setBlocks(equipmentData.blocks || []);
      setLoaded(true);
    })();
    return () => { active = false; };
  }, []);

  // Оновити лише заявки (після дії з drawer), не чіпаючи графік/обладнання.
  async function refetchBookings() {
    const res = await fetch("/api/staff/bookings", { cache: "no-store" });
    const data = await res.json().catch(() => ({})) as { bookings?: CalBooking[] };
    if (res.ok && Array.isArray(data.bookings)) setItems(data.bookings);
  }
  const canManage = staff?.role === "admin" || staff?.role === "registrar";
  async function patchBooking(body: Record<string, unknown>) {
    const id = body.id as number;
    setBusyId(id);
    try {
      const res = await fetch("/api/staff/bookings", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      if (res.ok) await refetchBookings();
    } finally { setBusyId(null); }
  }

  // Дозволяємо відкрити календар на конкретній даті/вигляді (напр. після
  // підтвердження запису: /staff/appointments?date=…&view=week).
  useEffect(() => {
    const t = window.setTimeout(() => {
      const p = new URLSearchParams(window.location.search);
      const v = p.get("view"); const d = p.get("date");
      if (v === "day" || v === "week" || v === "list") setInitialView(v);
      if (d && /^\d{4}-\d{2}-\d{2}$/.test(d)) setInitialDate(d);
    }, 0);
    return () => window.clearTimeout(t);
  }, []);

  const body = forbidden
    ? <p className="notice error" role="alert">Доступ лише для персоналу.</p>
    : !loaded
      ? <p className="notice">Завантаження…</p>
      : <WeekCalendar
          bookings={items} options={options} schedule={schedule} blocks={blocks}
          initialView={initialView} initialDate={initialDate} busyId={busyId}
          onConfirm={canManage ? (id) => void patchBooking({ id, confirm: true }) : undefined}
          onReschedule={canManage ? (id, date, time) => void patchBooking({ id, desiredDate: date, desiredTime: time }) : undefined}
        />;

  return (
    <StaffWorkspaceShell
      active="appointments"
      title="Записи і слоти"
      description="Один робочий екран: вільні слоти кабінетів, заявки, запис пацієнта, прибуття та оплата."
      staffName={staff?.displayName}
      staffRole={staff?.role}
    >
      {body}
    </StaffWorkspaceShell>
  );
}
