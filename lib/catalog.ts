export type EquipmentType = "ct" | "xray" | "fluoro";

export type Service = {
  code: string;
  title: string;
  description: string;
  price: number;
  ehealthCode: string;
  equipmentId: EquipmentType;
  durationMinutes: number;
  group: string;
  featured?: boolean;
};

export const EQUIPMENT = {
  ct: { id: "ct", name: "Комп’ютерний томограф", slotMinutes: 30, start: "08:00", end: "17:00" },
  xray: { id: "xray", name: "Цифровий рентген", slotMinutes: 15, start: "08:00", end: "17:00" },
  fluoro: { id: "fluoro", name: "Флюорограф", slotMinutes: 15, start: "08:00", end: "17:00" },
} as const;

export const SERVICES: Service[] = [
  { code:"101", title:"Цифрова флюорографія органів грудної клітки", description:"Один знімок органів грудної клітки у прямій проєкції та письмовий висновок лікаря-рентгенолога.", price:300, ehealthCode:"", equipmentId:"fluoro", durationMinutes:15, group:"Цифрова флюорографія", featured:true },
  { code:"201", title:"Цифрова рентгенографія однієї анатомічної ділянки", description:"Два стандартні знімки однієї анатомічної ділянки у двох проєкціях.", price:500, ehealthCode:"", equipmentId:"xray", durationMinutes:15, group:"Цифрова рентгенографія", featured:true },
  { code:"202", title:"Додаткова проєкція за медичними показаннями", description:"Додатковий знімок (проєкція) понад дві стандартні, якщо його призначив лікар.", price:250, ehealthCode:"", equipmentId:"xray", durationMinutes:15, group:"Цифрова рентгенографія" },
  { code:"203", title:"Функціональна рентгенографія одного відділу хребта", description:"До трьох знімків одного відділу хребта з функціональними пробами.", price:750, ehealthCode:"", equipmentId:"xray", durationMinutes:30, group:"Цифрова рентгенографія" },
  { code:"204", title:"Оглядова рентгенографія органів черевної порожнини", description:"Оглядовий знімок живота.", price:500, ehealthCode:"", equipmentId:"xray", durationMinutes:15, group:"Цифрова рентгенографія" },
  { code:"205", title:"Рентгенографія стоп під навантаженням", description:"Рентгенографія стоп у положенні стоячи під вагою тіла.", price:500, ehealthCode:"", equipmentId:"xray", durationMinutes:15, group:"Цифрова рентгенографія" },
  { code:"301", title:"Рентгеноскопія стравоходу, шлунка та дванадцятипалої кишки", description:"Дослідження верхніх відділів травного тракту з барієвою суспензією.", price:1200, ehealthCode:"58909-00", equipmentId:"xray", durationMinutes:30, group:"Контрастні рентгенологічні дослідження" },
  { code:"302", title:"Дослідження пасажу барієвої суспензії по тонкій кишці", description:"Серія знімків для оцінки проходження контрасту тонкою кишкою.", price:1500, ehealthCode:"58915-00", equipmentId:"xray", durationMinutes:30, group:"Контрастні рентгенологічні дослідження" },
  { code:"401", title:"КТ головного мозку", description:"Головний мозок і кістки черепа без контрастування.", price:1600, ehealthCode:"56001-00", equipmentId:"ct", durationMinutes:30, group:"КТ без контрастування", featured:true },
  { code:"402", title:"КТ придаткових пазух носа", description:"Пазухи та клітини решітчастого лабіринту.", price:1600, ehealthCode:"56022-01", equipmentId:"ct", durationMinutes:30, group:"КТ без контрастування" },
  { code:"403", title:"КТ лицевого скелета", description:"Кістки обличчя, орбіти та щелепи.", price:1700, ehealthCode:"56022-00", equipmentId:"ct", durationMinutes:30, group:"КТ без контрастування" },
  { code:"404", title:"КТ м’яких тканин шиї", description:"М’які тканини, глотка, гортань і лімфатичні вузли шиї.", price:1500, ehealthCode:"56101-00", equipmentId:"ct", durationMinutes:30, group:"КТ без контрастування" },
  { code:"405", title:"КТ одного відділу хребта", description:"Шийний, грудний або попереково-крижовий відділ.", price:1600, ehealthCode:"", equipmentId:"ct", durationMinutes:30, group:"КТ без контрастування", featured:true },
  { code:"406", title:"КТ двох відділів хребта", description:"Два відділи хребта в межах одного обстеження.", price:3100, ehealthCode:"", equipmentId:"ct", durationMinutes:45, group:"КТ без контрастування" },
  { code:"407", title:"КТ органів грудної клітки", description:"Легені, плевра, середостіння та грудна стінка.", price:1600, ehealthCode:"56301-00", equipmentId:"ct", durationMinutes:30, group:"КТ без контрастування", featured:true },
  { code:"408", title:"КТ органів черевної порожнини", description:"Органи живота, нирки та заочеревинний простір.", price:1800, ehealthCode:"56401-00", equipmentId:"ct", durationMinutes:30, group:"КТ без контрастування", featured:true },
  { code:"409", title:"КТ одного суглоба", description:"Детальна оцінка одного суглоба та прилеглих кісток.", price:1700, ehealthCode:"", equipmentId:"ct", durationMinutes:30, group:"КТ без контрастування" },
  { code:"410", title:"КТ кісток таза та кульшових суглобів", description:"Кістки таза, крижово-клубові та кульшові суглоби.", price:2100, ehealthCode:"", equipmentId:"ct", durationMinutes:30, group:"КТ без контрастування" },
  { code:"411", title:"КТ верхньої або нижньої кінцівки", description:"Вибрана ділянка руки або ноги.", price:1600, ehealthCode:"", equipmentId:"ct", durationMinutes:30, group:"КТ без контрастування" },
  { code:"412", title:"КТ кисті або стопи", description:"Дрібні кістки та суглоби кисті чи стопи.", price:1500, ehealthCode:"", equipmentId:"ct", durationMinutes:30, group:"КТ без контрастування" },
  { code:"501", title:"КТ головного мозку з внутрішньовенним контрастуванням", description:"Контрастне дослідження головного мозку.", price:3700, ehealthCode:"56001-00", equipmentId:"ct", durationMinutes:45, group:"КТ з контрастуванням", featured:true },
  { code:"502", title:"КТ м’яких тканин шиї з внутрішньовенним контрастуванням", description:"Контрастне дослідження шиї та лімфатичних вузлів.", price:3700, ehealthCode:"56101-00", equipmentId:"ct", durationMinutes:45, group:"КТ з контрастуванням" },
  { code:"503", title:"КТ органів грудної клітки з внутрішньовенним контрастуванням", description:"Контрастне дослідження легень, середостіння та грудної стінки.", price:3500, ehealthCode:"56301-00", equipmentId:"ct", durationMinutes:45, group:"КТ з контрастуванням", featured:true },
  { code:"504", title:"КТ органів черевної порожнини з внутрішньовенним контрастуванням", description:"Контрастна оцінка органів живота, нирок і заочеревинного простору.", price:3700, ehealthCode:"56401-00", equipmentId:"ct", durationMinutes:45, group:"КТ з контрастуванням" },
  { code:"601", title:"КТ-ангіографія однієї анатомічної ділянки", description:"Контрастне дослідження судин однієї ділянки.", price:4100, ehealthCode:"", equipmentId:"ct", durationMinutes:45, group:"КТ-ангіографія" },
  { code:"602", title:"КТ-ангіографія двох анатомічних ділянок", description:"Контрастне дослідження судин двох ділянок.", price:5200, ehealthCode:"", equipmentId:"ct", durationMinutes:60, group:"КТ-ангіографія" },
  { code:"603", title:"КТ-ангіопульмонографія", description:"Контрастне дослідження легеневих артерій.", price:3500, ehealthCode:"", equipmentId:"ct", durationMinutes:45, group:"КТ-ангіографія" },
];

export function serviceByCode(code: string) {
  return SERVICES.find(service => service.code === code);
}

export function groupedServices() {
  return SERVICES.reduce<Record<string, Service[]>>((groups, service) => {
    (groups[service.group] ||= []).push(service);
    return groups;
  }, {});
}

export function addMinutes(time: string, minutes: number) {
  const [hours, mins] = time.split(":").map(Number);
  const total = hours * 60 + mins + minutes;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

export function candidateTimes(service: Service) {
  const equipment = EQUIPMENT[service.equipmentId];
  const result: string[] = [];
  for (let time:string = equipment.start; addMinutes(time, service.durationMinutes) <= equipment.end; time = addMinutes(time, equipment.slotMinutes)) {
    result.push(time);
  }
  return result;
}
