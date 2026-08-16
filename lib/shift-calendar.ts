export type ShiftKind = "day" | "evening" | "night" | "duty" | "work" | "off" | "recovery" | "leave" | "sick" | "custom";

export type ShiftDefinition = {
  label:string;
  kind:ShiftKind;
  start?:string;
  end?:string;
};

export type ShiftPreset = {
  code:string;
  name:string;
  source:"Calendar6";
  cycleDays:number;
  teams:readonly (readonly string[])[];
  definitions:Readonly<Record<string, ShiftDefinition>>;
  sourceWarning?:string;
};

export type ShiftAssignment = {
  staffEmail:string;
  presetCode:string;
  teamIndex:number;
  anchorDate:string;
};

export type ShiftOverride = {
  staffEmail:string;
  shiftDate:string;
  kind:ShiftKind;
  label:string;
  startTime:string;
  endTime:string;
  note:string;
};

export type ResolvedShift = ShiftDefinition & {
  token:string;
  source:"preset" | "override";
  note?:string;
};

const OFF = (count:number) => Object.fromEntries(
  Array.from({ length:count }, (_, i) => [`В${i + 1}`, { label:"В", kind:"off" as const }]),
);

export const CALENDAR6_PRESETS:readonly ShiftPreset[] = [
  {
    code:"calendar6-1", name:"День — ніч — троє вдома", source:"Calendar6", cycleDays:5,
    definitions:{
      "Д1":{ label:"Д", kind:"day", start:"08:00", end:"20:00" },
      "Д2":{ label:"Н", kind:"night", start:"20:00", end:"08:00" },
      ...OFF(3),
    },
    teams:[
      ["Д1","Д2","В1","В2","В3"],
      ["В3","Д1","Д2","В1","В2"],
      ["В2","В3","Д1","Д2","В1"],
      ["В1","В2","В3","Д1","Д2"],
      ["Д2","В1","В2","В3","Д1"],
    ],
  },
  {
    code:"calendar6-2", name:"Два дні через два", source:"Calendar6", cycleDays:4,
    definitions:{ "Д1":{ label:"Д", kind:"day" }, ...OFF(1) },
    teams:[
      ["Д1","Д1","В1","В1"],
      ["В1","В1","Д1","Д1"],
    ],
  },
  {
    code:"calendar6-3", name:"Доба — троє", source:"Calendar6", cycleDays:4,
    definitions:{ "Д1":{ label:"ДН", kind:"duty" }, ...OFF(1) },
    teams:[
      ["Д1","В1","В1","В1"],
      ["В1","Д1","В1","В1"],
      ["В1","В1","Д1","В1"],
      ["В1","В1","В1","Д1"],
    ],
  },
  {
    code:"calendar6-4", name:"День — ніч — 48", source:"Calendar6", cycleDays:4,
    definitions:{
      "Д1":{ label:"Д", kind:"day", start:"08:00", end:"20:00" },
      "Д2":{ label:"Н", kind:"night", start:"20:00", end:"08:00" },
      ...OFF(2),
    },
    teams:[
      ["Д2","В1","В2","Д1"],
      ["В1","В2","Д1","Д2"],
      ["В2","Д1","Д2","В1"],
      ["Д1","Д2","В1","В2"],
    ],
  },
  {
    code:"calendar6-5", name:"4 у день / 2 відпочинок", source:"Calendar6", cycleDays:6,
    definitions:{
      "Д1":{ label:"ДМ", kind:"work" },
      "Д2":{ label:"А", kind:"work" },
      "Д3":{ label:"М", kind:"work" },
      ...OFF(2),
    },
    teams:[
      ["Д1","Д1","Д2","Д2","В1","В2"],
      ["Д2","Д2","В1","В2","Д2","Д2"],
    ],
    sourceWarning:"У вихідному Setting.mdb для цього типу заявлено 6 бригад, але заповнено лише 2 матриці; перенесено тільки фактично задані дані.",
  },
  {
    code:"calendar6-6", name:"Три зміни на добу", source:"Calendar6", cycleDays:16,
    definitions:{
      "Д1":{ label:"1", kind:"day", start:"07:30", end:"15:29" },
      "Д2":{ label:"2", kind:"evening", start:"15:30", end:"23:59" },
      "Д3":{ label:"Н", kind:"night", start:"00:00", end:"07:29" },
      ...OFF(4),
    },
    teams:[
      ["Д1","Д1","Д1","Д1","В1","Д2","Д2","Д2","Д2","В2","Д3","Д3","Д3","Д3","В3","В4"],
      ["Д3","Д3","В3","В4","Д1","Д1","Д1","Д1","В1","Д2","Д2","Д2","Д2","В2","Д3","Д3"],
      ["Д2","В2","Д3","Д3","Д3","Д3","В3","В4","Д1","Д1","Д1","Д1","В1","Д2","Д2","Д2"],
      ["В1","Д2","Д2","Д2","Д2","В2","Д3","Д3","Д3","Д3","В3","В4","Д1","Д1","Д1","Д1"],
    ],
  },
  {
    code:"calendar6-7", name:"2 день — 2 ніч — 3 вдома", source:"Calendar6", cycleDays:21,
    definitions:{
      "Д1":{ label:"Д", kind:"day" },
      "Д2":{ label:"Н", kind:"night" },
      ...OFF(1),
    },
    teams:[
      ["Д1","Д1","Д2","Д2","В1","В1","В1","Д2","Д2","В1","В1","Д1","Д1","В1","В1","В1","Д1","Д1","Д2","Д2","В1"],
      ["Д2","Д2","В1","В1","Д1","Д1","В1","В1","В1","Д1","Д1","Д2","Д2","В1","Д1","Д1","Д2","Д2","В1","В1","В1"],
      ["В1","В1","Д1","Д1","Д2","Д2","В1","Д1","Д1","Д2","Д2","В1","В1","В1","Д2","Д2","В1","В1","Д1","Д1","В1"],
    ],
  },
  {
    code:"calendar6-8", name:"2 день — 2 вихідні — 2 ніч — 2 вихідні", source:"Calendar6", cycleDays:8,
    definitions:{
      "Д1":{ label:"Д", kind:"day" },
      "Д2":{ label:"Н", kind:"night" },
      "Д3":{ label:"Н", kind:"night" },
      ...OFF(3),
    },
    teams:[
      ["Д1","Д1","В1","В1","Д2","Д3","В2","В3"],
      ["В2","В3","Д1","Д1","В1","В1","Д2","Д3"],
      ["Д2","Д3","В2","В3","Д1","Д1","В1","В1"],
      ["В1","В1","Д2","Д3","В2","В3","Д1","Д1"],
    ],
  },
] as const;

export const SHIFT_OVERRIDE_KINDS:readonly { value:ShiftKind; label:string; short:string }[] = [
  { value:"day", label:"Денна зміна", short:"Д" },
  { value:"evening", label:"Вечірня зміна", short:"2" },
  { value:"night", label:"Нічна зміна", short:"Н" },
  { value:"duty", label:"Добове чергування", short:"ДН" },
  { value:"work", label:"Робоча зміна", short:"Р" },
  { value:"off", label:"Вихідний", short:"В" },
  { value:"recovery", label:"Відсипний", short:"Відс" },
  { value:"leave", label:"Відпустка", short:"Вп" },
  { value:"sick", label:"Лікарняний", short:"Л" },
  { value:"custom", label:"Інше", short:"•" },
] as const;

export function shiftPreset(code:string):ShiftPreset | null {
  return CALENDAR6_PRESETS.find((preset) => preset.code === code) || null;
}

export function isIsoDate(value:string):boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  if (year < 2000 || year > 2200 || month < 1 || month > 12 || day < 1 || day > 31) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function isMonthKey(value:string):boolean {
  if (!/^\d{4}-\d{2}$/.test(value)) return false;
  const [year, month] = value.split("-").map(Number);
  return year >= 2000 && year <= 2200 && month >= 1 && month <= 12;
}

function dayNumber(value:string):number {
  const [year, month, day] = value.split("-").map(Number);
  return Math.floor(Date.UTC(year, month - 1, day) / 86400000);
}

function mod(value:number, length:number) {
  return ((value % length) + length) % length;
}

export function datesForMonth(monthKey:string):string[] {
  if (!isMonthKey(monthKey)) return [];
  const [year, month] = monthKey.split("-").map(Number);
  const count = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return Array.from({ length:count }, (_, index) => `${monthKey}-${String(index + 1).padStart(2, "0")}`);
}

export function resolvePresetShift(
  presetCode:string,
  teamIndex:number,
  anchorDate:string,
  date:string,
):ResolvedShift | null {
  const preset = shiftPreset(presetCode);
  if (!preset || !isIsoDate(anchorDate) || !isIsoDate(date)) return null;
  const team = preset.teams[teamIndex - 1];
  if (!team || team.length !== preset.cycleDays) return null;
  const index = mod(dayNumber(date) - dayNumber(anchorDate), preset.cycleDays);
  const token = team[index];
  const definition = preset.definitions[token];
  return definition ? { ...definition, token, source:"preset" } : null;
}

export function resolvedOverride(override:ShiftOverride):ResolvedShift {
  const fallback = SHIFT_OVERRIDE_KINDS.find((item) => item.value === override.kind)?.short || "•";
  return {
    token:`override:${override.kind}`,
    source:"override",
    kind:override.kind,
    label:override.label.trim() || fallback,
    start:override.startTime || undefined,
    end:override.endTime || undefined,
    note:override.note || undefined,
  };
}

export function shiftCellText(shift:ResolvedShift | null):string {
  if (!shift) return "—";
  return shift.start || shift.end
    ? `${shift.label} ${shift.start || "?"}–${shift.end || "?"}`
    : shift.label;
}
