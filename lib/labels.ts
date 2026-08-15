// Спільні мовні хелпери для інтерфейсу персоналу: українські підписи ролей і
// правильне відмінювання числівників (слот/слоти/слотів тощо). Виносимо сюди,
// щоб не дублювати ці мапи по десятку сторінок.

export type StaffRoleKey = "admin" | "organization_admin" | "department_head" | "registrar" | "radiologist" | "radiographer";

export const STAFF_ROLE_LABELS: Record<string, string> = {
  admin: "Адміністратор",
  organization_admin: "Системний адміністратор",
  department_head: "Завідувач відділення",
  registrar: "Реєстратор",
  radiologist: "Лікар-рентгенолог",
  radiographer: "Рентгенолаборант",
};

// Український підпис ролі; для невідомого коду повертає сам код.
export function roleLabelUk(role: string | undefined | null): string | undefined {
  if (!role) return undefined;
  return STAFF_ROLE_LABELS[role] || role;
}

// Відмінювання числівника за українськими правилами:
// one — 1, 21, 31…; few — 2-4, 22-24…; many — 0, 5-20, 11-14…
export function pluralUk(n: number, one: string, few: string, many: string): string {
  const abs = Math.abs(Math.trunc(n));
  const mod10 = abs % 10;
  const mod100 = abs % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

// Число + правильна форма слова, напр. countUk(2, "апарат", "апарати", "апаратів").
export function countUk(n: number, one: string, few: string, many: string): string {
  return `${n} ${pluralUk(n, one, few, many)}`;
}
