export const SERVICES = [
  "КТ головного мозку",
  "КТ органів грудної клітки",
  "КТ черевної порожнини",
  "КТ одного відділу хребта",
  "Цифрова рентгенографія однієї ділянки",
  "Цифрова флюорографія",
  "КТ головного мозку з контрастуванням",
  "КТ грудної клітки з контрастуванням",
  "КТ-ангіографія однієї ділянки",
] as const;

export const TIMES = [
  "08:00", "08:30", "09:00", "09:30", "10:00", "10:30", "11:00",
  "11:30", "12:00", "12:30", "13:00", "13:30", "14:00", "14:30",
  "15:00", "15:30", "16:00",
] as const;

export function todayInKyiv() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Kyiv",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export function isBookableDate(date: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const parsed = new Date(`${date}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) return false;
  const today = todayInKyiv();
  const latest = new Date(`${today}T12:00:00Z`);
  latest.setUTCDate(latest.getUTCDate() + 180);
  return date >= today && date <= latest.toISOString().slice(0, 10) && parsed.getUTCDay() !== 0;
}

export function isService(value: string) {
  return (SERVICES as readonly string[]).includes(value);
}

export function isTime(value: string) {
  return (TIMES as readonly string[]).includes(value);
}

