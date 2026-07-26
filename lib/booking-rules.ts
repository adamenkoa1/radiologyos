import { candidateTimes, serviceByCode } from "./catalog";

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

export function isTimeForService(value: string, serviceCode: string) {
  const service = serviceByCode(serviceCode);
  return !!service && candidateTimes(service).includes(value);
}
