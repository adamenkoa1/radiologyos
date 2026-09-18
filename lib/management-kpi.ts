// «Червоні зони» для завідувача: беремо операційні метрики й перетворюємо на
// KPI-картки зі статусом ok / warn / alert за порогами. Чиста логіка (без
// залежностей) — маршрут лише збирає числа з БД і викликає buildRedZones.

export type KpiStatus = "ok" | "warn" | "alert";

export type KpiCard = {
  key: string;
  label: string;
  value: number;
  unit: string;
  status: KpiStatus;
  hint: string;
};

// Для всіх метрик діє правило «більше = гірше» (черги, несправності, борг).
export function evaluateThreshold(value: number, warnAt: number, alertAt: number): KpiStatus {
  if (value >= alertAt) return "alert";
  if (value >= warnAt) return "warn";
  return "ok";
}

export type ManagementMetrics = {
  criticalFindings: number;   // критичні знахідки, ще не доведені (status = 'open')
  overdueProtocols: number;   // виконано >2 діб тому, протокол не готовий/виданий
  readyToIssue: number;       // протокол готовий, але не виданий пацієнту
  needImaging: number;        // виконано, але немає прив'язаних знімків
  newBookings: number;        // непідтверджені записи (status = 'new')
  openFaults: number;         // відкриті несправності обладнання
  activeDowntime: number;     // активний простій обладнання
  receivablesDue: number;     // несплачений залишок, грн
};

const STATUS_ORDER: Record<KpiStatus, number> = { alert: 0, warn: 1, ok: 2 };
// Клінічна терміновість важливіша за суму боргу — критичні знахідки й
// несправності мають бути вгорі серед однакового статусу.
const KEY_PRIORITY: Record<string, number> = { criticalFindings: 0, openFaults: 1, overdueProtocols: 2 };
const priorityOf = (key: string) => (key in KEY_PRIORITY ? KEY_PRIORITY[key] : 9);

export function buildRedZones(m: ManagementMetrics): KpiCard[] {
  const cards: KpiCard[] = [
    {
      key: "criticalFindings", label: "Критичні знахідки", value: m.criticalFindings, unit: "",
      status: evaluateThreshold(m.criticalFindings, 1, 1),
      hint: "Ургентні знахідки, які ще не доведено лікарю/пацієнту. Потребують негайної комунікації.",
    },
    {
      key: "overdueProtocols", label: "Прострочені протоколи", value: m.overdueProtocols, unit: "",
      status: evaluateThreshold(m.overdueProtocols, 1, 5),
      hint: "Дослідження виконано понад 2 доби тому, а протокол ще не готовий і не виданий.",
    },
    {
      key: "readyToIssue", label: "Готові, не видані", value: m.readyToIssue, unit: "",
      status: evaluateThreshold(m.readyToIssue, 5, 15),
      hint: "Протоколи готові, але результат ще не видано пацієнтам.",
    },
    {
      key: "needImaging", label: "Дослідження без знімків", value: m.needImaging, unit: "",
      status: evaluateThreshold(m.needImaging, 1, 5),
      hint: "Дослідження проведено, але жодного знімка (imaging study) не прив'язано.",
    },
    {
      key: "newBookings", label: "Непідтверджені записи", value: m.newBookings, unit: "",
      status: evaluateThreshold(m.newBookings, 10, 25),
      hint: "Нові записи, які ще ніхто не підтвердив у реєстратурі.",
    },
    {
      key: "openFaults", label: "Несправності обладнання", value: m.openFaults, unit: "",
      status: evaluateThreshold(m.openFaults, 1, 1),
      hint: m.activeDowntime > 0 ? `Активний простій: ${m.activeDowntime}.` : "Відкриті несправності апаратів.",
    },
    {
      key: "receivablesDue", label: "Дебіторська заборгованість", value: m.receivablesDue, unit: "грн",
      status: evaluateThreshold(m.receivablesDue, 50000, 200000),
      hint: "Несплачений залишок за проведені послуги (пороги орієнтовні — можна відкалібрувати).",
    },
  ];
  return cards.sort((a, b) =>
    STATUS_ORDER[a.status] - STATUS_ORDER[b.status]
    || priorityOf(a.key) - priorityOf(b.key)
    || b.value - a.value);
}

export function attentionCount(cards: KpiCard[]): number {
  return cards.filter((c) => c.status !== "ok").length;
}
