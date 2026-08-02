export type EquipmentRecord = {
  id: string;
  type: string;
  manufacturer: string;
  model: string;
  room: string;
  maxKv: string;
  year: string;
  serialNumber: string;
  status: "active" | "maintenance" | "inactive";
  notes: string;
};

export const EQUIPMENT_REGISTRY_KEY = "equipment_registry_v1";

// Точний перелік перенесено зі структури відділення. Технічні поля, яких у
// вихідних даних не було (кВ, заводський номер), залишено для заповнення.
export const EQUIPMENT_REGISTRY_DEFAULTS: EquipmentRecord[] = [
  { id:"siemens-somatom", type:"Комп’ютерний томограф", manufacturer:"Siemens", model:"SOMATOM", room:"Кабінет комп’ютерної томографії", maxKv:"", year:"2021", serialNumber:"", status:"active", notes:"Точну модифікацію уточнити за технічним паспортом. В експлуатації з 2021 року" },
  { id:"sireskop-cx", type:"Рентгенівський діагностичний апарат", manufacturer:"Siemens", model:"Sireskop-CX", room:"Рентгенологічний кабінет №1", maxKv:"", year:"1998", serialNumber:"", status:"active", notes:"В експлуатації з 1998 року" },
  { id:"5d2", type:"Стаціонарний дентальний рентгенапарат", manufacturer:"Актюбрентген", model:"5Д2", room:"Рентгенологічний кабінет №1", maxKv:"", year:"1994", serialNumber:"", status:"active", notes:"В експлуатації з 1994 року" },
  { id:"hyperion-x9-pro", type:"Панорамний рентгенапарат", manufacturer:"MyRay", model:"HYPERION X9 Pro", room:"Рентгенологічний кабінет №2", maxKv:"", year:"", serialNumber:"", status:"active", notes:"" },
  { id:"rxdc", type:"Внутрішньоротовий рентгенапарат", manufacturer:"MyRay", model:"RXDC", room:"Рентгенологічний кабінет №2", maxKv:"", year:"", serialNumber:"", status:"active", notes:"" },
  { id:"imax-6000", type:"Діагностична цифрова система", manufacturer:"", model:"IMAX 6000", room:"Рентгенологічний кабінет №2", maxKv:"", year:"", serialNumber:"", status:"active", notes:"" },
  { id:"12f9-ukraine", type:"Цифровий флюорограф", manufacturer:"", model:"12Ф9-Україна", room:"Кабінет флюорографії", maxKv:"", year:"2017", serialNumber:"", status:"active", notes:"В експлуатації з 2017 року" },
  { id:"9l5f", type:"Пересувний рентгенівський апарат", manufacturer:"", model:"9Л5Ф", room:"Пересувні (палатні) апарати", maxKv:"", year:"1999", serialNumber:"", status:"active", notes:"В експлуатації з 1999 року" },
  { id:"plx-102", type:"Пересувний рентгенівський апарат", manufacturer:"", model:"PLX 102", room:"Пересувні (палатні) апарати", maxKv:"", year:"2011", serialNumber:"", status:"active", notes:"В експлуатації з 2011 року" },
  { id:"m32", type:"Пересувний рентгенівський апарат", manufacturer:"", model:"М32", room:"Пересувні (палатні) апарати", maxKv:"", year:"2022", serialNumber:"", status:"active", notes:"В експлуатації з 2022 року" },
];

const clean = (value:unknown, max:number) => String(value || "").trim().replace(/\s+/g," ").slice(0,max);
export function sanitizeEquipmentRegistry(input:unknown):EquipmentRecord[] {
  const rows = Array.isArray(input) ? input : [];
  return EQUIPMENT_REGISTRY_DEFAULTS.map(base => {
    const src = rows.find(row => row && typeof row === "object" && (row as {id?:unknown}).id === base.id) as Partial<EquipmentRecord> | undefined;
    const status = src?.status === "maintenance" || src?.status === "inactive" || src?.status === "active" ? src.status : base.status;
    return {
      id:base.id, type:clean(src?.type ?? base.type,120) || base.type,
      manufacturer:clean(src?.manufacturer ?? base.manufacturer,80), model:clean(src?.model ?? base.model,120), room:clean(src?.room ?? base.room,100),
      maxKv:clean(src?.maxKv ?? base.maxKv,12), year:clean(src?.year ?? base.year,4), serialNumber:clean(src?.serialNumber ?? base.serialNumber,80),
      status, notes:clean(src?.notes ?? base.notes,500),
    };
  });
}

export function parseEquipmentRegistry(stored:string):EquipmentRecord[] {
  if (!stored) return EQUIPMENT_REGISTRY_DEFAULTS.map(row => ({...row}));
  try { return sanitizeEquipmentRegistry(JSON.parse(stored)); }
  catch { return EQUIPMENT_REGISTRY_DEFAULTS.map(row => ({...row})); }
}
