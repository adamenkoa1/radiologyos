// Єдина редагована модель відділення: госпіталь, ліцензія, кабінети,
// обладнання, штат, режим роботи та підсумки досліджень. Тут немає ПІБ,
// дат народження, домашніх адрес чи інших персональних даних працівників.

export type StructureDevice = {
  name: string;
  kind: string;
  details?: string;
  status?: "active" | "stored";
};

export type StructureRoom = { id: string; name: string; devices: StructureDevice[] };
export type StructureHoursRow = { service: string; intake: string; issue?: string };
export type StructureStatistic = { id: string; label: string; value: number };

export type DepartmentStructure = {
  hospital: { name: string; unit: string; address: string; edrpou: string };
  license: {
    number: string;
    series: string;
    authority: string;
    activity: string;
    issued: string;
    validUntil: string;
    changes: string;
  };
  department: { name: string; emergency: string; about: string };
  statistics2025: {
    title: string;
    year: number;
    breakdown: StructureStatistic[];
    complexShare: number;
    militaryExamined: number;
  };
  rooms: StructureRoom[];
  personnel: Array<{ position: string; note: string }>;
  hours: {
    outpatient: { title: string; rows: StructureHoursRow[] };
    inpatient: { title: string; rows: StructureHoursRow[] };
  };
};

export const DEPARTMENT_STRUCTURE_KEY = "department_structure";

export const DEPARTMENT_STRUCTURE_DEFAULTS: DepartmentStructure = {
  hospital: {
    name: "Чернігівський військовий госпіталь",
    unit: "Військова частина А3120",
    address: "14013, м. Чернігів, вул. Гетьмана Полуботка, 40",
    edrpou: "08296098",
  },
  license: {
    number: "№ ОВ 011260",
    series: "Серія АА № 005287",
    authority: "Державна інспекція ядерного регулювання України",
    activity: "Використання джерел іонізуючого випромінювання · діагностична радіологія",
    issued: "08.11.2019",
    validUntil: "08.11.2027",
    changes: "Змін до ліцензії: 4 (останнє продовження — наказ від 18.11.2022 № 682)",
  },
  department: {
    name: "Відділення променевої діагностики",
    emergency: "Надання невідкладної допомоги здійснюється цілодобово",
    about: "Відділення об’єднує кабінет комп’ютерної томографії на першому поверсі та рентгенологічні кабінети на другому поверсі лікувального корпусу. Роботу служби організовано цілодобово, обладнання регулярно проходить технічне обслуговування. У 2025 році вдосконалено проведення КТ із контрастуванням.",
  },
  statistics2025: {
    title: "Усього досліджень за 2025 рік",
    year: 2025,
    breakdown: [
      { id: "copies", label: "Скопій", value: 590 },
      { id: "radiographs", label: "Рентгенографій", value: 10444 },
      { id: "fluorograms", label: "Флюорограм", value: 16513 },
      { id: "ct", label: "Комп’ютерних томографій", value: 2861 },
      { id: "ultrasound", label: "УЗД", value: 9406 },
    ],
    complexShare: 45,
    militaryExamined: 17000,
  },
  rooms: [
    { id: "ct", name: "Кабінет комп'ютерної томографії", devices: [
      { name: "Комп'ютерний томограф Siemens SOMATOM go.Up", kind: "КТ", details: "В експлуатації з 2021 року" },
    ] },
    { id: "xray", name: "Рентгенологічний кабінет №1", devices: [
      { name: "Рентгенівський діагностичний апарат Sireskop-CX", kind: "Рентген", details: "В експлуатації з 1998 року" },
      { name: "Стаціонарний дентальний рентгенапарат 5Д2 (Актюбрентген)", kind: "Дентальний", details: "В експлуатації з 1994 року" },
    ] },
    { id: "dental", name: "Рентгенологічний кабінет №2", devices: [
      { name: "Панорамний рентгенапарат HYPERION X9 Pro", kind: "Панорамний" },
      { name: "Внутрішньоротовий рентгенапарат RXDC", kind: "Дентальний" },
      { name: "Діагностична система IMAX 6000", kind: "Цифровий" },
    ] },
    { id: "fluoro", name: "Флюорографія", devices: [
      { name: "Цифровий флюорограф 12Ф9-Україна", kind: "Флюорограф", details: "В експлуатації з 2017 року" },
    ] },
    { id: "mobile", name: "Пересувні (палатні) апарати", devices: [
      { name: "Апарат рентгенівський діагностичний пересувний 9Л5Ф", kind: "Пересувний", details: "В експлуатації з 1999 року" },
      { name: "Апарат рентгенівський діагностичний пересувний PLX 102", kind: "Пересувний", details: "В експлуатації з 2011 року" },
      { name: "Апарат рентгенівський діагностичний пересувний М32", kind: "Пересувний", details: "В експлуатації з 2022 року" },
    ] },
    { id: "stored", name: "Демонтоване обладнання (на зберіганні)", devices: [
      { name: "Комплекс рентгенівський діагностичний SHIMADZU UD 150L-30EX", kind: "Демонтовано", details: "На зберіганні", status: "stored" },
      { name: "Флюорограф 12Ф7Ц", kind: "Демонтовано", details: "На зберіганні", status: "stored" },
    ] },
  ],
  personnel: [
    { position: "Начальник відділення променевої діагностики", note: "Відповідальна особа з радіаційної безпеки" },
    { position: "Начальник ПРК", note: "" },
    { position: "Лікарі-рентгенологи", note: "" },
    { position: "Рентгенолаборанти", note: "" },
  ],
  hours: {
    outpatient: {
      title: "Амбулаторні пацієнти",
      rows: [
        { service: "Флюорографія ОГК", intake: "9:30–13:00, 14:00–16:00", issue: "Видача: 14:00–15:00 / наступного дня" },
        { service: "Рентгенографія всіх органів", intake: "10:00–13:00, 14:00–15:00", issue: "Видача: 14:00–15:00 / наступного дня" },
      ],
    },
    inpatient: {
      title: "Стаціонарні хворі",
      rows: [
        { service: "Флюорографія ОГК", intake: "7:00–9:30, 16:00–17:30" },
        { service: "Рентгенографія всіх органів", intake: "8:30–10:00, 16:00–17:30" },
      ],
    },
  },
};

// Зворотно сумісний експорт для серверних і тестових модулів.
export const DEPARTMENT_STRUCTURE = DEPARTMENT_STRUCTURE_DEFAULTS;

export function cloneDepartmentStructure(value: DepartmentStructure = DEPARTMENT_STRUCTURE_DEFAULTS): DepartmentStructure {
  return JSON.parse(JSON.stringify(value)) as DepartmentStructure;
}

export function totalStudies2025(structure: DepartmentStructure): number {
  return structure.statistics2025.breakdown.reduce((sum, item) => sum + item.value, 0);
}

const text = (value: unknown, fallback: string, max = 500) => {
  if (typeof value !== "string") return fallback;
  const clean = value.trim().slice(0, max);
  return clean || fallback;
};
const number = (value: unknown, fallback: number, max = 10000000) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.min(max, Math.round(parsed))) : fallback;
};

export function sanitizeDepartmentStructure(input: unknown): DepartmentStructure {
  const defaults = cloneDepartmentStructure();
  const src = input && typeof input === "object" ? input as Partial<DepartmentStructure> : {};
  const hospital = src.hospital ?? defaults.hospital;
  const license = src.license ?? defaults.license;
  const department = src.department ?? defaults.department;
  const stats = src.statistics2025 ?? defaults.statistics2025;

  const rooms = Array.isArray(src.rooms) ? src.rooms.slice(0, 20).map((room, roomIndex) => {
    const fallback = defaults.rooms[roomIndex] ?? { id: `room-${roomIndex + 1}`, name: "Кабінет", devices: [] };
    const devices = Array.isArray(room?.devices) ? room.devices.slice(0, 50).map((device, deviceIndex) => {
      const deviceFallback = fallback.devices[deviceIndex] ?? { name: "Обладнання", kind: "Інше" };
      return {
        name: text(device?.name, deviceFallback.name, 220),
        kind: text(device?.kind, deviceFallback.kind, 60),
        details: text(device?.details, deviceFallback.details ?? "", 160),
        status: device?.status === "stored" ? "stored" as const : "active" as const,
      };
    }) : fallback.devices;
    return {
      id: text(room?.id, fallback.id, 50).replace(/[^a-zA-Z0-9_-]/g, "-") || `room-${roomIndex + 1}`,
      name: text(room?.name, fallback.name, 160),
      devices,
    };
  }) : defaults.rooms;

  const personnel = Array.isArray(src.personnel) ? src.personnel.slice(0, 30).map((item, index) => {
    const fallback = defaults.personnel[index] ?? { position: "Посада", note: "" };
    return { position: text(item?.position, fallback.position, 160), note: text(item?.note, fallback.note, 220) };
  }) : defaults.personnel;

  const sanitizeHours = (block: unknown, fallback: DepartmentStructure["hours"]["outpatient"]) => {
    const source = block && typeof block === "object" ? block as typeof fallback : fallback;
    return {
      title: text(source.title, fallback.title, 100),
      rows: Array.isArray(source.rows) ? source.rows.slice(0, 30).map((row, index) => {
        const rowFallback = fallback.rows[index] ?? { service: "Послуга", intake: "За записом" };
        return {
          service: text(row?.service, rowFallback.service, 160),
          intake: text(row?.intake, rowFallback.intake, 160),
          issue: text(row?.issue, rowFallback.issue ?? "", 180),
        };
      }) : fallback.rows,
    };
  };

  const breakdown = Array.isArray(stats.breakdown) ? stats.breakdown.slice(0, 20).map((item, index) => {
    const fallback = defaults.statistics2025.breakdown[index] ?? { id: `metric-${index + 1}`, label: "Дослідження", value: 0 };
    return {
      id: text(item?.id, fallback.id, 50).replace(/[^a-zA-Z0-9_-]/g, "-") || `metric-${index + 1}`,
      label: text(item?.label, fallback.label, 120),
      value: number(item?.value, fallback.value),
    };
  }) : defaults.statistics2025.breakdown;

  return {
    hospital: {
      name: text(hospital.name, defaults.hospital.name, 160),
      unit: text(hospital.unit, defaults.hospital.unit, 120),
      address: text(hospital.address, defaults.hospital.address, 220),
      edrpou: text(hospital.edrpou, defaults.hospital.edrpou, 20),
    },
    license: {
      number: text(license.number, defaults.license.number, 60),
      series: text(license.series, defaults.license.series, 80),
      authority: text(license.authority, defaults.license.authority, 200),
      activity: text(license.activity, defaults.license.activity, 240),
      issued: text(license.issued, defaults.license.issued, 30),
      validUntil: text(license.validUntil, defaults.license.validUntil, 30),
      changes: text(license.changes, defaults.license.changes, 260),
    },
    department: {
      name: text(department.name, defaults.department.name, 160),
      emergency: text(department.emergency, defaults.department.emergency, 180),
      about: text(department.about, defaults.department.about, 1200),
    },
    statistics2025: {
      title: text(stats.title, defaults.statistics2025.title, 140),
      year: number(stats.year, 2025, 2100),
      breakdown,
      complexShare: number(stats.complexShare, defaults.statistics2025.complexShare, 100),
      militaryExamined: number(stats.militaryExamined, defaults.statistics2025.militaryExamined),
    },
    rooms,
    personnel,
    hours: {
      outpatient: sanitizeHours(src.hours?.outpatient, defaults.hours.outpatient),
      inpatient: sanitizeHours(src.hours?.inpatient, defaults.hours.inpatient),
    },
  };
}

export function parseDepartmentStructure(stored: string): DepartmentStructure {
  if (!stored) return cloneDepartmentStructure();
  try {
    return sanitizeDepartmentStructure(JSON.parse(stored));
  } catch {
    return cloneDepartmentStructure();
  }
}
