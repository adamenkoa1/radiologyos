"use client";

import { useEffect, useState } from "react";
import StaffWorkspaceShell from "../workspace-shell";
import WeekCalendar, { type CalBooking, type CalStaffOption, type CalView } from "../week-calendar";

type StaffOption = { email: string; displayName: string; role: string };

export default function StaffAppointmentsPage() {
  const [staff, setStaff] = useState<StaffOption | null>(null);
  const [items, setItems] = useState<CalBooking[]>([]);
  const [options, setOptions] = useState<CalStaffOption[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [forbidden, setForbidden] = useState(false);
  const [initialView, setInitialView] = useState<CalView>("day");
  const [initialDate, setInitialDate] = useState<string | undefined>(undefined);

  useEffect(() => {
    let active = true;
    (async () => {
      const res = await fetch("/api/staff/bookings", { cache: "no-store" });
      if (res.status === 401 || res.status === 403) { if (active) setForbidden(true); return; }
      const data = await res.json().catch(() => ({})) as { bookings?: CalBooking[]; staffOptions?: StaffOption[]; staff?: StaffOption };
      if (!active) return;
      setItems(data.bookings || []);
      setOptions(data.staffOptions || []);
      if (data.staff) setStaff(data.staff);
      setLoaded(true);
    })();
    return () => { active = false; };
  }, []);

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
      : <WeekCalendar bookings={items} options={options} initialView={initialView} initialDate={initialDate} />;

  return (
    <StaffWorkspaceShell
      active="appointments"
      title="Календар і заявки"
      description="Головний робочий екран: час, пацієнт, послуга, маршрут і оплата."
      staffName={staff?.displayName}
      staffRole={staff?.role}
    >
      {body}
    </StaffWorkspaceShell>
  );
}
