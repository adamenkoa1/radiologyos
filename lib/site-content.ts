// Налаштовуваний контент публічного сайту клініки. Редагується разом зі
// структурою відділення (/staff/structure), зберігається у app_settings під
// ключем `site_content` (єдиний JSON), застосовується на статичному лендингу
// через /api/site-content. Порожнє текстове поле означає «лишити типове
// значення з HTML» — застосування на сторінці ставить текст лише коли він є.

export type SiteContent = {
  brandTitle: string;
  brandSubtitle: string;
  slogan: string;
  milTitle: string;
  milSub: string;
  civTitle: string;
  civSub: string;
  phone: string;
  address: string;
  workHours: string;
  about: string;
  howTitle: string;
  howIntro: string;
  howQueueTitle: string;
  howQueue: string;
  howFluoroTitle: string;
  howFluoro: string;
  howXrayTitle: string;
  howXray: string;
  howExceptionsTitle: string;
  howExceptions: string;
  bariumTitle: string;
  bariumPurpose: string;
  bariumPreparation: string;
  bariumProcedure: string;
  bariumTransit: string;
  howResultTitle: string;
  howResult: string;
  civHowTitle: string;
  civHowBooking: string;
  civHowArrival: string;
  civHowPayment: string;
  civHowResult: string;
  accessNotice: string;
  pricePageTitle: string;
  pricePageSub: string;
  priceIntro: string;
  priceListTitle: string;
  priceLead: string;
  milPageTitle: string;
  milPageSub: string;
  milNotice: string;
  milLead: string;
  brandColor: string;
  logoUrl: string;
  storefrontType: StorefrontType;
  published: boolean;
};

// Види вітрини: лише платні послуги, або платні + безкоштовні (військовим).
export type StorefrontType = "paid_and_free" | "paid_only";
export const STOREFRONT_TYPES: StorefrontType[] = ["paid_and_free", "paid_only"];

export const SITE_CONTENT_KEY = "site_content";

// Обмеження довжини для звичайних текстових полів (brandColor/logoUrl/
// storefrontType валідуються окремо нижче).
const FIELD_MAX = {
  brandTitle: 120, brandSubtitle: 160, slogan: 160,
  milTitle: 80, milSub: 200, civTitle: 80, civSub: 200,
  phone: 40, address: 200, workHours: 120, about: 800,
  howTitle: 120, howIntro: 300,
  howQueueTitle: 100, howQueue: 400, howFluoroTitle: 100, howFluoro: 300,
  howXrayTitle: 100, howXray: 400, howExceptionsTitle: 120, howExceptions: 400,
  bariumTitle: 140, bariumPurpose: 700, bariumPreparation: 900, bariumProcedure: 700, bariumTransit: 900,
  howResultTitle: 100, howResult: 1000,
  civHowTitle: 120, civHowBooking: 400, civHowArrival: 400, civHowPayment: 300, civHowResult: 400, accessNotice: 500,
  pricePageTitle: 120, pricePageSub: 200, priceIntro: 800, priceListTitle: 160, priceLead: 300,
  milPageTitle: 120, milPageSub: 200, milNotice: 800, milLead: 300,
} as const;

export const SITE_CONTENT_DEFAULTS: SiteContent = {
  brandTitle: "Чернігівський військовий госпіталь",
  brandSubtitle: "Відділення променевої діагностики",
  slogan: "Точна діагностика-вчасна допомога. Досвід, якому можна довіряти.",
  milTitle: "Військовослужбовцям",
  milSub: "Безоплатні дослідження за направленням",
  civTitle: "Цивільним особам",
  civSub: "Платні дослідження — повний прайс і запис",
  phone: "+380 97 280 88 99",
  address: "м. Чернігів, вул. Полуботка, 40",
  workHours: "08:30–17:30 · екстрені дослідження для військовослужбовців — цілодобово (24/7)",
  about: "Екстрені дослідження для військовослужбовців проводяться цілодобово — 24/7. Планові дослідження проводяться відповідно до режиму роботи відділення: 08:30–17:30. Цивільні пацієнти можуть пройти платні дослідження за попереднім записом.",
  howTitle: "Як пройти дослідження військовослужбовцю",
  howIntro: "Візьміть направлення у військового лікаря та зверніться до відділення у години прийому.",
  howQueueTitle: "Направлення і жива черга",
  howQueue: "Усі дослідження, крім рентгенографії з барієм та комп’ютерної томографії, проводяться в порядку живої черги.",
  howFluoroTitle: "До 12:00",
  howFluoro: "До 12:00 — флюорографія, зокрема для проходження ВЛК.",
  howXrayTitle: "Після 13:00",
  howXray: "Після 13:00 — рентгенографія кісток і суглобів та інші рентгенографічні дослідження за направленням.",
  howExceptionsTitle: "За попереднім записом",
  howExceptions: "Рентгенографія з барієм і комп’ютерна томографія проводяться за попереднім записом.",
  bariumTitle: "Як підготуватися до рентгенографії з барієм",
  bariumPurpose: "Дослідження призначають для оцінювання стравоходу, шлунка та дванадцятипалої кишки, зокрема при підозрі на грижу стравохідного отвору діафрагми або виразкові зміни. При виразці шлунка чи дванадцятипалої кишки через 1 годину може виконуватися контрольний знімок для оцінки евакуації контрасту зі шлунка та дванадцятипалої кишки.",
  bariumPreparation: "Дослідження проводиться натще: щонайменше за 6 годин не їжте, не пийте та не жуйте гумку. Необхідні ліки можна приймати лише за погодженням із лікарем або відділенням, запиваючи невеликою кількістю води. Якщо маєте цукровий діабет або можлива вагітність, обов’язково повідомте про це під час запису. Наявність барію сульфату та порядок його надання уточніть у відділенні — самостійно купувати контраст без підтвердження не потрібно.",
  bariumProcedure: "Під час дослідження пацієнт випиває суспензію барію сульфату, а лікар-рентгенолог у режимі рентгеноскопії спостерігає за її проходженням. За медичними показаннями дослідження виконують у різних положеннях, зокрема в положенні Тренделенбурга.",
  bariumTransit: "Якщо призначено погодинне дослідження пасажу барію, контрольні знімки зазвичай виконують через 1 і 2 години, а надалі — приблизно кожні 3 години за вказівкою лікаря-рентгенолога. Спостереження може тривати до 24 годин, тому пацієнт має бути доступним для повторних знімків у визначений час. Точний графік повідомить відділення.",
  howResultTitle: "Коли буде опис",
  howResult: "Опис дослідження разом із рентгенівськими знімками вноситься до електронної медичної карти в медичній інформаційній системі та через добу після дослідження доступний лікарям. Тому забирати паперовий примірник не обов’язково. За потреби паперовий опис можна отримати через добу на другому поверсі — там, де проводилося дослідження. Екстрені дослідження проводяться цілодобово — 24/7, а опис надається одразу.",
  civHowTitle: "Як пройти дослідження цивільному пацієнту",
  civHowBooking: "Оберіть потрібне дослідження на сайті та запишіться на зручний доступний час.",
  civHowArrival: "Приїдьте до госпіталю у підтверджений час і пред’явіть документ, що посвідчує особу.",
  civHowPayment: "Оплатіть дослідження перед його проведенням.",
  civHowResult: "Пройдіть дослідження та отримайте результат у відділенні або на електронну пошту.",
  accessNotice: "Вхід на територію госпіталю для військовослужбовців і цивільних пацієнтів здійснюється після ідентифікації особи. Обов’язково майте при собі документ, що посвідчує особу.",
  pricePageTitle: "Платні дослідження",
  pricePageSub: "Вартість указана відповідно до чинних тарифів.",
  priceIntro: "Цивільним особам — платні послуги. Оберіть потрібне дослідження, натисніть «Записатися» та введіть свої дані.",
  priceListTitle: "Тарифи на платні медичні послуги",
  priceLead: "Відділення променевої діагностики Чернігівського військового госпіталю.",
  milPageTitle: "Дослідження для військовослужбовців",
  milPageSub: "За направленням лікаря та відповідно до чинного законодавства України.",
  milNotice: "Оберіть потрібний розділ. Для військовослужбовців дослідження виконуються безоплатно за направленням.",
  milLead: "Відділення променевої діагностики Чернігівського військового госпіталю.",
  brandColor: "#0c7a85",
  logoUrl: "",
  storefrontType: "paid_and_free",
  published: true,
};

const TEXT_FIELDS = Object.keys(FIELD_MAX) as Array<keyof typeof FIELD_MAX>;

// Приводить довільний ввід до валідного SiteContent: обрізає тексти за
// довжиною, published — булеве. Відсутні поля беруться з типових значень.
export function sanitizeSiteContent(input: unknown): SiteContent {
  const src = (input && typeof input === "object") ? input as Record<string, unknown> : {};
  const out = { ...SITE_CONTENT_DEFAULTS };
  for (const field of TEXT_FIELDS) {
    if (typeof src[field] === "string") {
      out[field] = (src[field] as string).trim().slice(0, FIELD_MAX[field]);
    }
  }
  // Одноразово оновлюємо попередній типовий слоган. Власний текст,
  // введений адміністратором, не змінюємо.
  if (
    out.slogan === "" ||
    out.slogan === "Точна діагностика. Вчасна допомога. Підтримка військових." ||
    out.slogan === "Точна діагностика. Вчасна допомога." ||
    out.slogan === "Точна діагностика-вчасна допомога."
  ) {
    out.slogan = SITE_CONTENT_DEFAULTS.slogan;
  }
  // Оновлюємо лише попередні типові тексти; власні тексти адміністратора
  // залишаються без змін.
  if (
    out.workHours === "Пн–Сб · 08:00–17:00" ||
    out.workHours === "Військовослужбовцям — 24/7 · цивільним — за попереднім записом" ||
    out.workHours === "Екстрені дослідження для військовослужбовців — цілодобово · цивільним — за попереднім записом"
  ) {
    out.workHours = SITE_CONTENT_DEFAULTS.workHours;
  }
  if (
    out.about === "Відділення променевої діагностики працює цілодобово та об’єднує кабінет комп’ютерної томографії й рентгенологічні кабінети лікувального корпусу. Обладнання регулярно проходить технічне обслуговування, а у 2025 році вдосконалено проведення КТ із контрастуванням." ||
    out.about === "Відділення променевої діагностики працює для військовослужбовців цілодобово — 24/7. Цивільні пацієнти можуть пройти платні дослідження за попереднім записом." ||
    out.about === "Екстрені дослідження для військовослужбовців проводяться цілодобово. Цивільні пацієнти можуть пройти платні дослідження за попереднім записом."
  ) {
    out.about = SITE_CONTENT_DEFAULTS.about;
  }
  if (out.howIntro === "Візьміть направлення лікаря та зверніться до відділення у години прийому.") {
    out.howIntro = SITE_CONTENT_DEFAULTS.howIntro;
  }
  if (
    out.howXray === "Після 12:00 — рентгенографія: дослідження кісток при травмах та інші рентгенографічні дослідження за направленням." ||
    out.howXray === "Після 12:00 — рентгенографія кісток і суглобів та інші рентгенографічні дослідження за направленням."
  ) {
    out.howXray = SITE_CONTENT_DEFAULTS.howXray;
  }
  if (out.howExceptionsTitle === "За попереднім погодженням") out.howExceptionsTitle = SITE_CONTENT_DEFAULTS.howExceptionsTitle;
  if (out.howExceptions === "Рентгенографія з барієм і комп’ютерна томографія проводяться за попереднім погодженням.") out.howExceptions = SITE_CONTENT_DEFAULTS.howExceptions;
  if (out.bariumPurpose === "Дослідження призначають для оцінювання стравоходу, шлунка та дванадцятипалої кишки, зокрема при підозрі на грижу стравохідного отвору діафрагми або виразкові зміни. Погодинне дослідження пасажу барію допомагає оцінити його проходження кишечником і моторно-евакуаторну функцію.") {
    out.bariumPurpose = SITE_CONTENT_DEFAULTS.bariumPurpose;
  }
  if (
    out.howResult === "Опис планових рентгенографічних знімків та результат флюорографії — через добу після проведення дослідження. При екстрених дослідженнях опис надається одразу." ||
    out.howResult === "Опис дослідження вноситься до медичної інформаційної системи та доступний усім військовим лікарям разом із прикріпленими рентгенівськими знімками. Паперовий опис можна отримати через добу на другому поверсі — там, де проводилося дослідження. Забирати паперовий примірник не обов’язково. При екстрених дослідженнях опис надається одразу." ||
    out.howResult === "Опис дослідження разом із прикріпленими рентгенівськими знімками вноситься до медичної інформаційної системи та доступний усім військовим лікарям. Тому забирати паперовий примірник не обов’язково. За потреби паперовий опис можна отримати через добу на другому поверсі — там, де проводилося дослідження. Екстрені дослідження проводяться цілодобово — 24/7, а опис надається одразу."
  ) {
    out.howResult = SITE_CONTENT_DEFAULTS.howResult;
  }
  // Фірмовий колір — лише валідний HEX (#RRGGBB), інакше типовий.
  const color = String(src.brandColor ?? "").trim();
  out.brandColor = /^#[0-9a-fA-F]{6}$/.test(color) ? color.toLowerCase() : SITE_CONTENT_DEFAULTS.brandColor;
  // Поле лишається в контракті для сумісності зі старими налаштуваннями,
  // але логотип більше не показується на сайті.
  out.logoUrl = "";
  // Вид вітрини.
  out.storefrontType = src.storefrontType === "paid_only" ? "paid_only" : "paid_and_free";
  out.published = src.published === undefined ? SITE_CONTENT_DEFAULTS.published : Boolean(src.published);
  return out;
}

// Читання збереженого JSON зі стовпця app_settings у повний SiteContent.
export function parseSiteContent(stored: string): SiteContent {
  if (!stored) return { ...SITE_CONTENT_DEFAULTS };
  try {
    return sanitizeSiteContent(JSON.parse(stored));
  } catch {
    return { ...SITE_CONTENT_DEFAULTS };
  }
}
