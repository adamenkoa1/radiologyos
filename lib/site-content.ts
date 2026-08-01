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
  pricePageTitle: 120, pricePageSub: 200, priceIntro: 800, priceListTitle: 160, priceLead: 300,
  milPageTitle: 120, milPageSub: 200, milNotice: 800, milLead: 300,
} as const;

export const SITE_CONTENT_DEFAULTS: SiteContent = {
  brandTitle: "Чернігівський військовий госпіталь",
  brandSubtitle: "Відділення променевої діагностики",
  slogan: "Точна діагностика-вчасна допомога.",
  milTitle: "Військовослужбовцям",
  milSub: "Безоплатні дослідження за направленням",
  civTitle: "Цивільним особам",
  civSub: "Платні дослідження — повний прайс і запис",
  phone: "+380 97 280 88 99",
  address: "м. Чернігів, вул. Полуботка, 40",
  workHours: "Екстрені дослідження для військовослужбовців — цілодобово · цивільним — за попереднім записом",
  about: "Екстрені дослідження для військовослужбовців проводяться цілодобово. Цивільні пацієнти можуть пройти платні дослідження за попереднім записом.",
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
    out.slogan === "Точна діагностика. Вчасна допомога. Підтримка військових." ||
    out.slogan === "Точна діагностика. Вчасна допомога."
  ) {
    out.slogan = SITE_CONTENT_DEFAULTS.slogan;
  }
  // Оновлюємо лише попередні типові тексти; власні тексти адміністратора
  // залишаються без змін.
  if (
    out.workHours === "Пн–Сб · 08:00–17:00" ||
    out.workHours === "Військовослужбовцям — 24/7 · цивільним — за попереднім записом"
  ) {
    out.workHours = SITE_CONTENT_DEFAULTS.workHours;
  }
  if (
    out.about === "Відділення променевої діагностики працює цілодобово та об’єднує кабінет комп’ютерної томографії й рентгенологічні кабінети лікувального корпусу. Обладнання регулярно проходить технічне обслуговування, а у 2025 році вдосконалено проведення КТ із контрастуванням." ||
    out.about === "Відділення променевої діагностики працює для військовослужбовців цілодобово — 24/7. Цивільні пацієнти можуть пройти платні дослідження за попереднім записом."
  ) {
    out.about = SITE_CONTENT_DEFAULTS.about;
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
