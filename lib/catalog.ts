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
  { code:"101", title:"Цифрова флюорографія органів грудної клітки", description:"Один знімок органів грудної клітки у прямій проєкції та письмовий висновок.", price:300, ehealthCode:"", equipmentId:"fluoro", durationMinutes:15, group:"Цифрова флюорографія", featured:true },
  { code:"201", title:"Цифрова рентгенографія однієї анатомічної ділянки", description:"Два стандартні знімки однієї ділянки.", price:500, ehealthCode:"", equipmentId:"xray", durationMinutes:15, group:"Цифрова рентгенографія", featured:true },
  { code:"203", title:"Функціональна рентгенографія одного відділу хребта", description:"До трьох знімків із функціональними пробами.", price:750, ehealthCode:"", equipmentId:"xray", durationMinutes:30, group:"Цифрова рентгенографія" },
  { code:"204", title:"Оглядова рентгенографія органів черевної порожнини", description:"Оглядовий знімок живота.", price:500, ehealthCode:"", equipmentId:"xray", durationMinutes:15, group:"Цифрова рентгенографія" },
  { code:"301", title:"Рентгеноскопія стравоходу, шлунка та дванадцятипалої кишки", description:"Дослідження верхніх відділів травного тракту з барієвою суспензією.", price:1200, ehealthCode:"58909-00", equipmentId:"xray", durationMinutes:30, group:"Контрастні рентгенологічні дослідження" },
  { code:"302", title:"Дослідження проходження барію по тонкій кишці", description:"Серія знімків для оцінки проходження контрасту.", price:1500, ehealthCode:"58915-00", equipmentId:"xray", durationMinutes:30, group:"Контрастні рентгенологічні дослідження" },
  { code:"303", title:"Додатковий відстрочений знімок під час дослідження пасажу", description:"Один додатковий відстрочений знімок.", price:150, ehealthCode:"", equipmentId:"xray", durationMinutes:15, group:"Контрастні рентгенологічні дослідження" },
  { code:"401", title:"КТ головного мозку", description:"Головний мозок і кістки черепа без контрастування.", price:1500, ehealthCode:"56001-00", equipmentId:"ct", durationMinutes:30, group:"КТ без контрастування", featured:true },
  { code:"402", title:"КТ придаткових пазух носа", description:"Пазухи та клітини решітчастого лабіринту.", price:1400, ehealthCode:"56022-01", equipmentId:"ct", durationMinutes:30, group:"КТ без контрастування" },
  { code:"403", title:"КТ кісток лицевого скелета", description:"Кістки обличчя, орбіти та щелепи.", price:1600, ehealthCode:"56022-00", equipmentId:"ct", durationMinutes:30, group:"КТ без контрастування" },
  { code:"404", title:"КТ м’яких тканин шиї", description:"М’які тканини, глотка, гортань і лімфатичні вузли.", price:1600, ehealthCode:"56101-00", equipmentId:"ct", durationMinutes:30, group:"КТ без контрастування" },
  { code:"405", title:"КТ одного відділу хребта", description:"Шийний, грудний або попереково-крижовий відділ.", price:1500, ehealthCode:"", equipmentId:"ct", durationMinutes:30, group:"КТ без контрастування", featured:true },
  { code:"406", title:"КТ двох відділів хребта", description:"Два відділи хребта в межах одного обстеження.", price:2400, ehealthCode:"", equipmentId:"ct", durationMinutes:45, group:"КТ без контрастування" },
  { code:"407", title:"КТ поперекового відділу хребта та кульшових суглобів", description:"Поперековий відділ і обидва кульшові суглоби.", price:2100, ehealthCode:"", equipmentId:"ct", durationMinutes:45, group:"КТ без контрастування" },
  { code:"408", title:"КТ органів грудної клітки", description:"Легені, плевра, середостіння та грудна стінка.", price:1500, ehealthCode:"56301-00", equipmentId:"ct", durationMinutes:30, group:"КТ без контрастування", featured:true },
  { code:"409", title:"КТ органів черевної порожнини та заочеревинного простору", description:"Органи живота, нирки та заочеревинні структури.", price:1900, ehealthCode:"56401-00", equipmentId:"ct", durationMinutes:30, group:"КТ без контрастування", featured:true },
  { code:"410", title:"КТ органів малого таза", description:"Органи та тканини малого таза.", price:1900, ehealthCode:"56409-00", equipmentId:"ct", durationMinutes:30, group:"КТ без контрастування" },
  { code:"411", title:"КТ органів черевної порожнини та малого таза", description:"Комплексне дослідження живота й малого таза.", price:2400, ehealthCode:"56401-00", equipmentId:"ct", durationMinutes:45, group:"КТ без контрастування" },
  { code:"412", title:"КТ органів грудної клітки та черевної порожнини", description:"Комплексне дослідження грудної клітки та живота.", price:2700, ehealthCode:"56301-00", equipmentId:"ct", durationMinutes:45, group:"КТ без контрастування" },
  { code:"413", title:"КТ грудної клітки, черевної порожнини та малого таза", description:"Комплексне обстеження трьох анатомічних ділянок.", price:3000, ehealthCode:"56301-00", equipmentId:"ct", durationMinutes:60, group:"КТ без контрастування" },
  { code:"414", title:"КТ одного суглоба", description:"Детальна оцінка одного суглоба.", price:1550, ehealthCode:"", equipmentId:"ct", durationMinutes:30, group:"КТ без контрастування" },
  { code:"415", title:"КТ двох симетричних суглобів", description:"Порівняльне дослідження парних суглобів.", price:2000, ehealthCode:"", equipmentId:"ct", durationMinutes:30, group:"КТ без контрастування" },
  { code:"416", title:"КТ кісток таза та кульшових суглобів", description:"Кістки таза та кульшові суглоби.", price:1800, ehealthCode:"", equipmentId:"ct", durationMinutes:30, group:"КТ без контрастування" },
  { code:"417", title:"КТ верхньої або нижньої кінцівки", description:"Вибрана ділянка руки або ноги.", price:1600, ehealthCode:"", equipmentId:"ct", durationMinutes:30, group:"КТ без контрастування" },
  { code:"418", title:"КТ кисті або стопи", description:"Дрібні кістки та суглоби кисті чи стопи.", price:1500, ehealthCode:"", equipmentId:"ct", durationMinutes:30, group:"КТ без контрастування" },
  { code:"501", title:"КТ головного мозку з внутрішньовенним контрастуванням", description:"Контрастне дослідження головного мозку.", price:3200, ehealthCode:"56001-00", equipmentId:"ct", durationMinutes:45, group:"КТ з контрастуванням", featured:true },
  { code:"502", title:"КТ м’яких тканин шиї з внутрішньовенним контрастуванням", description:"Контрастне дослідження шиї та лімфатичних вузлів.", price:3200, ehealthCode:"56101-00", equipmentId:"ct", durationMinutes:45, group:"КТ з контрастуванням" },
  { code:"503", title:"КТ органів грудної клітки з внутрішньовенним контрастуванням", description:"Контрастне дослідження грудної клітки.", price:3400, ehealthCode:"56301-00", equipmentId:"ct", durationMinutes:45, group:"КТ з контрастуванням", featured:true },
  { code:"504", title:"КТ органів черевної порожнини з контрастуванням", description:"Контрастна оцінка органів живота та нирок.", price:3500, ehealthCode:"56401-00", equipmentId:"ct", durationMinutes:45, group:"КТ з контрастуванням" },
  { code:"505", title:"КТ органів малого таза з внутрішньовенним контрастуванням", description:"Контрастне дослідження малого таза.", price:3500, ehealthCode:"56409-00", equipmentId:"ct", durationMinutes:45, group:"КТ з контрастуванням" },
  { code:"506", title:"КТ органів черевної порожнини та малого таза з контрастуванням", description:"Комплексне контрастне дослідження живота й малого таза.", price:3900, ehealthCode:"56401-00", equipmentId:"ct", durationMinutes:60, group:"КТ з контрастуванням" },
  { code:"507", title:"КТ органів грудної клітки та черевної порожнини з контрастуванням", description:"Комплексне контрастне дослідження грудної клітки та живота.", price:4200, ehealthCode:"56301-00", equipmentId:"ct", durationMinutes:60, group:"КТ з контрастуванням" },
  { code:"508", title:"КТ грудної клітки, черевної порожнини та малого таза з контрастуванням", description:"Комплексне контрастне обстеження трьох ділянок.", price:4400, ehealthCode:"56301-00", equipmentId:"ct", durationMinutes:75, group:"КТ з контрастуванням" },
  { code:"509", title:"Додаткове пероральне контрастування", description:"Пероральне контрастування травного тракту.", price:200, ehealthCode:"", equipmentId:"ct", durationMinutes:30, group:"КТ з контрастуванням" },
  { code:"601", title:"КТ-ангіографія однієї анатомічної ділянки", description:"Контрастне дослідження судин однієї ділянки.", price:3600, ehealthCode:"", equipmentId:"ct", durationMinutes:45, group:"КТ-ангіографія" },
  { code:"602", title:"КТ-ангіографія двох анатомічних ділянок", description:"Контрастне дослідження судин двох ділянок.", price:4600, ehealthCode:"", equipmentId:"ct", durationMinutes:60, group:"КТ-ангіографія" },
  { code:"603", title:"КТ-ангіопульмонографія", description:"Контрастне дослідження легеневих артерій.", price:3400, ehealthCode:"", equipmentId:"ct", durationMinutes:45, group:"КТ-ангіографія" },
  { code:"604", title:"КТ-ангіографія аорти та артерій нижніх кінцівок", description:"Контрастна оцінка аорти й артерій ніг.", price:3600, ehealthCode:"", equipmentId:"ct", durationMinutes:60, group:"КТ-ангіографія" },
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
