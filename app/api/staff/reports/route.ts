import { EQUIPMENT, serviceByCode } from "../../../../lib/catalog";
import { todayInKyiv } from "../../../../lib/booking-rules";
import { requireStaff } from "../../../../lib/staff-auth";

function dbBinding() {
  return (globalThis as typeof globalThis & { __RADIOLOGY_DB__?: D1Database }).__RADIOLOGY_DB__;
}

type ReportRow = {
  serviceCode: string;
  service: string;
  equipmentId: string;
  desiredDate: string;
  patientCategory: string;
  referralType: string;
  marketingSource: string;
  status: string;
  protocolStatus: string;
  paymentStatus: string;
  paymentAmount: number;
  nszuStatus: string;
};

function isValidDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function monthStart(value: string) {
  return `${value.slice(0, 7)}-01`;
}

function equipmentName(id: string) {
  return EQUIPMENT[id as keyof typeof EQUIPMENT]?.name || id || "Не вказано";
}

function amountFor(row: ReportRow) {
  return Number(row.paymentAmount) || serviceByCode(row.serviceCode)?.price || 0;
}

function csvCell(value: string | number) {
  const normalized = String(value).replaceAll('"', '""');
  return `"${normalized}"`;
}

export async function GET(request: Request) {
  const db = dbBinding();
  if (!db) return Response.json({ error: "База тимчасово недоступна" }, { status: 503 });
  const member = await requireStaff(request, db);
  if (!member) return Response.json({ error: "Доступ лише для персоналу" }, { status: 403 });

  const url = new URL(request.url);
  const today = todayInKyiv();
  const from = url.searchParams.get("from") || monthStart(today);
  const to = url.searchParams.get("to") || today;
  if (!isValidDate(from) || !isValidDate(to) || from > to) {
    return Response.json({ error: "Некоректний період звіту" }, { status: 400 });
  }
  const fromDate = new Date(`${from}T12:00:00Z`);
  const toDate = new Date(`${to}T12:00:00Z`);
  const days = Math.round((toDate.getTime() - fromDate.getTime()) / 86_400_000) + 1;
  if (days > 366) return Response.json({ error: "Період звіту не може перевищувати 366 днів" }, { status: 400 });

  const result = await db.prepare(
    `SELECT service_code AS serviceCode, service, equipment_id AS equipmentId,
      desired_date AS desiredDate, patient_category AS patientCategory,
      referral_type AS referralType, marketing_source AS marketingSource,
      status, protocol_status AS protocolStatus, payment_status AS paymentStatus,
      payment_amount AS paymentAmount, nszu_status AS nszuStatus
     FROM bookings WHERE desired_date BETWEEN ? AND ?
     ORDER BY desired_date ASC LIMIT 5000`
  ).bind(from, to).all<ReportRow>();
  const rows = result.results || [];
  const activeRows = rows.filter((row) => row.status !== "cancelled");
  const completedRows = rows.filter((row) => row.status === "completed");
  const protocolReady = (row: ReportRow) => row.protocolStatus === "ready" || row.protocolStatus === "issued";

  const summary = {
    total: rows.length,
    active: activeRows.length,
    completed: completedRows.length,
    cancelled: rows.filter((row) => row.status === "cancelled").length,
    military: activeRows.filter((row) => row.patientCategory === "military").length,
    civilian: activeRows.filter((row) => row.patientCategory !== "military").length,
    protocolsReady: rows.filter(protocolReady).length,
    awaitingProtocol: completedRows.filter((row) => !protocolReady(row)).length,
    pendingPayments: activeRows.filter(
      (row) => row.patientCategory !== "military" && !["paid", "not_required"].includes(row.paymentStatus)
    ).length,
    paidRevenue: rows
      .filter((row) => row.paymentStatus === "paid")
      .reduce((sum, row) => sum + amountFor(row), 0),
    expectedRevenue: activeRows
      .filter((row) => row.patientCategory !== "military")
      .reduce((sum, row) => sum + amountFor(row), 0),
    nszuPending: activeRows.filter(
      (row) => row.referralType === "eh_referral" && row.nszuStatus === "pending"
    ).length,
  };

  const equipment = new Map<string, number>();
  const services = new Map<string, { code:string; title:string; count:number; revenue:number }>();
  const daysMap = new Map<string, {
    date:string; total:number; completed:number; cancelled:number; military:number; civilian:number; revenue:number;
  }>();
  const sources = new Map<string, number>();

  for (const row of rows) {
    const day = daysMap.get(row.desiredDate) || {
      date: row.desiredDate, total: 0, completed: 0, cancelled: 0, military: 0, civilian: 0, revenue: 0,
    };
    day.total += 1;
    if (row.status === "completed") day.completed += 1;
    if (row.status === "cancelled") day.cancelled += 1;
    if (row.status !== "cancelled" && row.patientCategory === "military") day.military += 1;
    if (row.status !== "cancelled" && row.patientCategory !== "military") day.civilian += 1;
    if (row.paymentStatus === "paid") day.revenue += amountFor(row);
    daysMap.set(row.desiredDate, day);

    if (row.status === "cancelled") continue;
    equipment.set(row.equipmentId, (equipment.get(row.equipmentId) || 0) + 1);
    const service = services.get(row.serviceCode) || {
      code: row.serviceCode,
      title: serviceByCode(row.serviceCode)?.title || row.service,
      count: 0,
      revenue: 0,
    };
    service.count += 1;
    if (row.paymentStatus === "paid") service.revenue += amountFor(row);
    services.set(row.serviceCode, service);
    const source = row.marketingSource || "Не вказано";
    sources.set(source, (sources.get(source) || 0) + 1);
  }

  const byEquipment = [...equipment.entries()]
    .map(([id, count]) => ({ id, name: equipmentName(id), count }))
    .sort((a, b) => b.count - a.count);
  const byService = [...services.values()].sort((a, b) => b.count - a.count).slice(0, 12);
  const byDay = [...daysMap.values()].sort((a, b) => a.date.localeCompare(b.date));
  const bySource = [...sources.entries()]
    .map(([source, count]) => ({ source, count }))
    .sort((a, b) => b.count - a.count);

  if (url.searchParams.get("format") === "csv") {
    const header = ["Дата", "Усього", "Завершено", "Скасовано", "Військові", "Цивільні", "Оплачено, грн"];
    const csv = [
      header.map(csvCell).join(";"),
      ...byDay.map((day) => [
        day.date, day.total, day.completed, day.cancelled, day.military, day.civilian, day.revenue,
      ].map(csvCell).join(";")),
    ].join("\r\n");
    return new Response(`\uFEFF${csv}`, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="radiologyos-report-${from}-${to}.csv"`,
        "cache-control": "no-store",
      },
    });
  }

  return Response.json(
    { from, to, summary, byEquipment, byService, byDay, bySource, staff: member },
    { headers: { "cache-control": "no-store" } }
  );
}
