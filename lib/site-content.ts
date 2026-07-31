// Налаштовуваний контент публічної вітрини (сайту клініки). Редагується
// адміністратором у кабінеті (/staff/site), зберігається у app_settings під
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
  slogan: "Понад 30 000 досліджень на рік — близько 100 за робочий день: КТ, рентген, флюорографія.",
  milTitle: "Військовослужбовцям",
  milSub: "Безоплатні дослідження за направленням",
  civTitle: "Цивільним особам",
  civSub: "Платні дослідження — повний прайс і запис",
  phone: "+380 97 280 88 99",
  address: "м. Чернігів, вул. Полуботка, 40",
  workHours: "Пн–Сб · 08:00–17:00",
  about: "Відділення променевої діагностики Чернігівського військового госпіталю виконує понад 30 000 досліджень на рік — близько 100 за робочий день. За 2024 рік: флюорографія — 16 778, рентгенографія — 11 012, комп’ютерна томографія — 2 373, рентгеноскопія — 289. Роботу виконують дев’ять діагностичних апаратів, зокрема сучасні комп’ютерні томографи SOMATOM. Військовослужбовцям — безоплатно за направленням, цивільним особам — платно з онлайн-записом. Невідкладна допомога — цілодобово.",
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
  // Фірмовий колір — лише валідний HEX (#RRGGBB), інакше типовий.
  const color = String(src.brandColor ?? "").trim();
  out.brandColor = /^#[0-9a-fA-F]{6}$/.test(color) ? color.toLowerCase() : SITE_CONTENT_DEFAULTS.brandColor;
  // Логотип — https-посилання або data:image (файл, зменшений у браузері).
  // Обмежуємо розмір, щоб не роздувати конфіг у базі.
  const logo = String(src.logoUrl ?? "").trim();
  const logoOk = (/^https:\/\//.test(logo) || /^data:image\/(png|jpe?g|webp|gif|svg\+xml);/.test(logo)) && logo.length <= 300000;
  out.logoUrl = logoOk ? logo : "";
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
