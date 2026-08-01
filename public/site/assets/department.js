/* RadiologyOS — дані про відділення: персонал та обладнання.
   Стандартні значення нижче — демонстраційні приклади; персонал може
   змінити їх у панелі (вкладка «Відділення»). Зміни зберігаються
   в localStorage і мають пріоритет. */

const STAFFLIST_STORE = 'radiologyos_staff_v1';
const EQUIPMENT_STORE = 'radiologyos_equipment_v1';

/* З міркувань безпеки військового об'єкта за замовчуванням публікуються
   лише посади, без ПІБ. Рішення про публікацію імен ухвалює керівництво;
   якщо воно погоджене — ПІБ додаються в панелі (вкладка «Відділення»). */
const DEFAULT_STAFFLIST = [
  { name: '', role: 'Завідувач відділення, лікар-рентгенолог', schedule: 'Пн–Пт 8:00–15:00', phone: '', email: '' },
  { name: '', role: 'Лікар-рентгенолог', schedule: 'Пн–Сб 9:00–17:00', phone: '', email: '' },
  { name: '', role: 'Рентгенлаборант', schedule: 'Пн–Сб 8:00–17:00', phone: '', email: '' }
];

const DEFAULT_EQUIPMENT = [
  { id: 'eq-ct-1', type: 'ct', name: 'Комп\'ютерний томограф', desc: 'Багатозрізова КТ-система для досліджень голови, грудної клітки, черевної порожнини та КТ-ангіографії, з внутрішньовенним контрастуванням і без.' },
  { id: 'eq-xray-1', type: 'xray', name: 'Цифровий рентгенографічний комплекс', desc: 'Рентгенографія всіх анатомічних ділянок у стандартних проекціях з цифровою обробкою зображень.' },
  { id: 'eq-xray-2', type: 'xray', name: 'Цифровий флюорограф', desc: 'Скринінгові дослідження органів грудної клітки з мінімальним дозовим навантаженням.' }
];

function _getList(key, def) {
  try {
    const saved = JSON.parse(localStorage.getItem(key) || 'null');
    if (Array.isArray(saved) && saved.length) return saved;
  } catch (e) {}
  return JSON.parse(JSON.stringify(def));
}

function getStaffList() { return _getList(STAFFLIST_STORE, DEFAULT_STAFFLIST); }
function saveStaffList(list) { localStorage.setItem(STAFFLIST_STORE, JSON.stringify(list)); }
function resetStaffList() { localStorage.removeItem(STAFFLIST_STORE); }

function getEquipment() { return _getList(EQUIPMENT_STORE, DEFAULT_EQUIPMENT); }
function saveEquipment(list) { localStorage.setItem(EQUIPMENT_STORE, JSON.stringify(list)); }
function resetEquipment() { localStorage.removeItem(EQUIPMENT_STORE); }

/* Графік роботи відділення (той самий ключ, що в панелі) */
function getWorkHours() {
  try {
    const wh = JSON.parse(localStorage.getItem('radiologyos_workhours_v1') || 'null');
    if (wh && wh.start && wh.end && Array.isArray(wh.days)) return wh;
  } catch (e) {}
  return { start: '08:00', end: '17:00', days: [1, 2, 3, 4, 5, 6] };
}

function formatWorkDays(days) {
  const names = ['Нд', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
  const order = [1, 2, 3, 4, 5, 6, 0].filter(d => days.includes(d));
  if (!order.length) return '—';
  /* згортаємо послідовні дні у діапазони: Пн–Сб */
  const idx = d => [1, 2, 3, 4, 5, 6, 0].indexOf(d);
  const parts = [];
  let start = order[0], prev = order[0];
  for (let i = 1; i <= order.length; i++) {
    const d = order[i];
    if (d !== undefined && idx(d) === idx(prev) + 1) { prev = d; continue; }
    parts.push(start === prev ? names[start] : names[start] + '–' + names[prev]);
    start = prev = d;
  }
  return parts.join(', ');
}

/* --- Вміст головної сторінки (редагується в панелі: Відділення → Головна сторінка) --- */
const SITECONTENT_STORE = 'radiologyos_sitecontent_v1';

const DEFAULT_SITECONTENT = {
  brandTitle: 'Чернігівський військовий госпіталь',
  brandSubtitle: 'Відділення променевої діагностики',
  milTitle: 'Військовослужбовцям',
  milSub: 'Безоплатні дослідження за направленням',
  civTitle: 'Цивільним особам',
  civSub: 'Платні дослідження — повний прайс і запис',
  phone: '+380 97 280 88 99',
  address: 'м. Чернігів, вул. Полуботка, 40',
  /* сторінка цін */
  pricePageTitle: 'Платні дослідження',
  pricePageSub: 'Вартість указана відповідно до чинних тарифів.',
  priceIntro: 'Цивільним особам — платні послуги. Оберіть потрібне дослідження, натисніть «Записатися» та введіть свої дані. Після опрацювання заявки з вами зв\u2019яжуться і повідомлять дату та час проведення дослідження.',
  priceListTitle: 'Тарифи на платні медичні послуги',
  priceLead: 'Відділення променевої діагностики Чернігівського військового госпіталю військової частини А3120.',
  /* сторінка військових */
  milPageTitle: 'Дослідження для військовослужбовців',
  milPageSub: 'За направленням лікаря та відповідно до чинного законодавства України.',
  milNotice: 'Оберіть потрібний розділ. Для військовослужбовців дослідження виконуються безоплатно за направленням та відповідно до законодавства України.',
  milLead: 'Відділення променевої діагностики Чернігівського військового госпіталю військової частини А3120.',
  brandColor: '#0c7a85',
  storefrontType: 'paid_and_free'
};

// Фірмовий колір застосовується на всіх сторінках вітрини (з кешу
// localStorage; свіже значення тягне головна через /api/site-content).
function applyBrandColor(c) {
  if (!c || !c.brandColor) return;
  var m = /^#([0-9a-f]{6})$/i.exec(c.brandColor);
  var dark = c.brandColor;
  if (m) { var n = parseInt(m[1], 16); var p = function (x) { return ('0' + Math.round(x * 0.82).toString(16)).slice(-2); }; dark = '#' + p((n >> 16) & 255) + p((n >> 8) & 255) + p(n & 255); }
  var r = document.documentElement;
  r.style.setProperty('--brand', c.brandColor);
  r.style.setProperty('--brand-dark', dark);
}
// Застосовуємо контент вітрини на сторінках прайсу/військових/про нас:
// колір теми + тексти груп «Сторінка цивільних» і «Сторінка військових»
// з редактора. Спершу з кешу localStorage (миттєво), потім свіже значення
// з /api/site-content (єдине джерело, як на головній).
function applySiteContent(c) {
  if (!c || typeof c !== 'object') return;
  applyBrandColor(c);
  var set = function (id, v) { var el = document.getElementById(id); if (el && v) { el.textContent = v; } };
  set('scPriceTitle', c.pricePageTitle); set('scPriceSub', c.pricePageSub);
  set('scPriceIntro', c.priceIntro); set('scPriceListTitle', c.priceListTitle); set('scPriceLead', c.priceLead);
  set('scMilPageTitle', c.milPageTitle); set('scMilPageSub', c.milPageSub);
  set('scMilNotice', c.milNotice); set('scMilLead', c.milLead);
}
try { applySiteContent(getSiteContent()); } catch (e) {}
try {
  fetch('/api/site-content').then(function (r) { return r.json(); }).then(function (d) {
    if (d && d.content) { applySiteContent(d.content); try { saveSiteContent(d.content); } catch (e) {} }
  }).catch(function () {});
} catch (e) {}

function getSiteContent() {
  try {
    const saved = JSON.parse(localStorage.getItem(SITECONTENT_STORE) || 'null');
    if (saved && typeof saved === 'object') return Object.assign({}, DEFAULT_SITECONTENT, saved);
  } catch (e) {}
  return Object.assign({}, DEFAULT_SITECONTENT);
}
function saveSiteContent(c) { localStorage.setItem(SITECONTENT_STORE, JSON.stringify(c)); }
function resetSiteContent() { localStorage.removeItem(SITECONTENT_STORE); }

/* --- Апарати відділення ---
   КТ: слоти по 30 хв. Рентген (рентгенографія, флюорографія, скопія): по 15 хв.
   Прив'язка дослідження до апарата — за першою цифрою коду послуги. */
const APPARATUS = [
  { id: 'xray', name: 'Рентген', step: 15, codePrefixes: ['1', '2', '3'] },
  { id: 'ct',   name: 'КТ',      step: 30, codePrefixes: ['4', '5', '6'] }
];

function apparatusForCode(code) {
  const p = String(code || '').trim()[0];
  return (APPARATUS.find(a => a.codePrefixes.includes(p)) || APPARATUS[0]).id;
}

function apparatusById(id) {
  return APPARATUS.find(a => a.id === id) || APPARATUS[0];
}

/* Пошук апарата за назвою дослідження (для записів без коду) */
function apparatusForStudyTitle(title) {
  try {
    if (typeof getPricelist === 'function') {
      for (const g of getPricelist())
        for (const it of g.items)
          if (it.title === title) return apparatusForCode(it.code);
    }
  } catch (e) {}
  return 'xray';
}

/* Часи слотів для апарата в межах робочих годин */
function slotTimesFor(appId, workHours) {
  const step = apparatusById(appId).step;
  const toMins = t => { const [a, b] = t.split(':').map(Number); return a * 60 + b; };
  const pad = n => String(n).padStart(2, '0');
  const out = [];
  for (let m = toMins(workHours.start); m < toMins(workHours.end); m += step)
    out.push(pad(Math.floor(m / 60)) + ':' + pad(m % 60));
  return out;
}

/* --- Стан апаратів та зміни персоналу ---
   Для кожного апарата: чи працює взагалі (active) і хто на зміні
   у кожен день тижня (roster). Значення зміни:
     ''    — не призначено (апарат працює за графіком відділення),
     'OFF' — зміни немає (апарат цього дня недоступний),
     інше  — ім'я лаборанта (працює, ім'я видно в розкладі). */
const APPARATUS_STATE_STORE = 'radiologyos_apparatus_v1';

function defaultApparatusState() {
  const st = {};
  APPARATUS.forEach(a => { st[a.id] = { active: true, roster: {0:'',1:'',2:'',3:'',4:'',5:'',6:''} }; });
  return st;
}

function getApparatusState() {
  try {
    const saved = JSON.parse(localStorage.getItem(APPARATUS_STATE_STORE) || 'null');
    if (saved && typeof saved === 'object') {
      const def = defaultApparatusState();
      APPARATUS.forEach(a => { def[a.id] = Object.assign(def[a.id], saved[a.id] || {}); });
      return def;
    }
  } catch (e) {}
  return defaultApparatusState();
}
function saveApparatusState(st) { localStorage.setItem(APPARATUS_STATE_STORE, JSON.stringify(st)); }

/* Доступність апарата в конкретну дату (без урахування годин/слотів) */
function apparatusAvailableOn(appId, dateISO, state) {
  const st = (state || getApparatusState())[appId];
  if (!st || st.active === false) return false;
  const dow = new Date(dateISO + 'T00:00:00').getDay();
  return st.roster[dow] !== 'OFF';
}

/* Санітизована доступність для пацієнтського боку (без імен) */
function apparatusAvailabilityPublic(state) {
  const st = state || getApparatusState();
  const out = {};
  APPARATUS.forEach(a => {
    out[a.id] = {
      active: st[a.id].active !== false,
      days: [0,1,2,3,4,5,6].filter(d => st[a.id].roster[d] !== 'OFF')
    };
  });
  return out;
}

/* --- Обладнання як одиниці розкладу ---
   Кожна машина має тип (ct → 30 хв, xray → 15 хв). Розклад, зміни
   лаборантів і зайнятість ведуться ПО МАШИНАХ; пацієнт бачить лише тип. */
function getEquipmentUnits() {
  const list = getEquipment();
  let changed = false;
  list.forEach((e, i) => {
    if (!e.id) { e.id = 'eq-' + Date.now().toString(36) + '-' + i; changed = true; }
    if (!e.type) { e.type = /томограф|\bКТ\b/i.test(e.name || '') ? 'ct' : 'xray'; changed = true; }
  });
  if (changed) saveEquipment(list);
  return list;
}
function typeForCode(code) { return apparatusForCode(code); }
function unitById(id) { return getEquipmentUnits().find(e => e.id === id) || null; }
function unitsOfType(type) { return getEquipmentUnits().filter(e => e.type === type); }
function stepForUnit(id) {
  const u = unitById(id);
  return apparatusById(u ? u.type : 'xray').step;
}
function unitLabel(id) {
  const u = unitById(id);
  if (!u) return id;
  return u.name + ' (' + apparatusById(u.type).name + ')';
}

/* Перевизначення стану під машини (легасі ct/xray мапиться на першу машину типу) */
function defaultApparatusState() {
  const st = {};
  getEquipmentUnits().forEach(u => { st[u.id] = { active: true, roster: {0:'',1:'',2:'',3:'',4:'',5:'',6:''} }; });
  return st;
}
function getApparatusState() {
  const def = defaultApparatusState();
  try {
    const saved = JSON.parse(localStorage.getItem(APPARATUS_STATE_STORE) || 'null');
    if (saved && typeof saved === 'object') {
      Object.keys(def).forEach(id => { if (saved[id]) def[id] = Object.assign(def[id], saved[id]); });
      ['ct', 'xray'].forEach(t => {
        if (saved[t]) {
          const first = unitsOfType(t)[0];
          if (first) def[first.id] = Object.assign(def[first.id], saved[t]);
        }
      });
    }
  } catch (e) {}
  return def;
}
function apparatusAvailableOn(unitId, dateISO, state) {
  const st = (state || getApparatusState())[unitId];
  if (!st || st.active === false) return false;
  const dow = new Date(dateISO + 'T00:00:00').getDay();
  return (st.roster || {})[dow] !== 'OFF';
}
function apparatusAvailabilityPublic(state) {
  const st = state || getApparatusState();
  const out = {};
  getEquipmentUnits().forEach(u => {
    const s2 = st[u.id] || { active: true, roster: {} };
    out[u.id] = {
      type: u.type,
      active: s2.active !== false,
      days: [0, 1, 2, 3, 4, 5, 6].filter(d => (s2.roster || {})[d] !== 'OFF')
    };
  });
  return out;
}
