import { todayInKyiv } from "./booking-rules";

// Людино-зрозумілий код заявки: RD-РРММДД-N — префікс + дата створення +
// добовий послідовний номер (лише цифри). Приклад: RD-260810-004.
//
// Номер отримуємо атомарно одним INSERT … ON CONFLICT … RETURNING, тож навіть
// за одночасних запитів кожна заявка дістає унікальний номер — без гонок і
// дублікатів. Лічильник зберігається по днях у app_settings (booking_seq_РРММДД).
export async function nextBookingCode(db: D1Database): Promise<string> {
  const ymd = todayInKyiv().slice(2).replace(/-/g, ""); // 2026-08-10 → 260810
  const key = `booking_seq_${ymd}`;
  const row = await db.prepare(
    `INSERT INTO app_settings (key, value) VALUES (?, '1')
     ON CONFLICT(key) DO UPDATE SET value = CAST(value AS INTEGER) + 1
     RETURNING value`
  ).bind(key).first<{ value: string | number }>();
  const seq = Number(row?.value ?? 1) || 1;
  return `RD-${ymd}-${String(seq).padStart(3, "0")}`;
}
