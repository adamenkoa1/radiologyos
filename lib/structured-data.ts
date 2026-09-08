// Структуровані дані (schema.org / JSON-LD) для медичних сторінок послуг.
// Чиста логіка (без IO): генератори будують вузли графа з декларативних даних
// сторінки й публічного профілю, а валідатор перевіряє обов'язкові поля.
// Реалізує розділ «Schema.org» docs/seo.md: MedicalWebPage + BreadcrumbList +
// MedicalProcedure, мовою uk, з прив'язкою до клініки й датою перегляду.

export type StructuredProfile = {
  name: string;
  department: string;
  url: string; // базовий URL сайту
  telephone: string;
  address: string;
};

export type StructuredPage = {
  path: string;
  title: string;
  description: string;
  intro?: string;
  preparation?: string[];
};

export type JsonLdNode = Record<string, unknown>;

const abs = (base: string, path: string) => new URL(path, base).toString();
const CLINIC_ID = "#clinic";

// Людські назви секцій для «хлібних крихт».
const SECTION_LABELS: Record<string, string> = {
  ct: "КТ",
  xray: "Рентгенографія",
  fluorography: "Флюорографія",
};

export function breadcrumbList(page: StructuredPage, profile: StructuredProfile): JsonLdNode {
  const segments = page.path.split("/").filter(Boolean);
  const items: JsonLdNode[] = [
    { "@type": "ListItem", position: 1, name: "Головна", item: abs(profile.url, "/") },
  ];
  segments.forEach((seg, i) => {
    const url = abs(profile.url, "/" + segments.slice(0, i + 1).join("/") + "/");
    const name = i === segments.length - 1 ? page.title : SECTION_LABELS[seg] || seg;
    items.push({ "@type": "ListItem", position: i + 2, name, item: url });
  });
  return { "@type": "BreadcrumbList", itemListElement: items };
}

export function medicalWebPage(
  page: StructuredPage,
  profile: StructuredProfile,
  reviewedDate: string,
): JsonLdNode {
  return {
    "@type": "MedicalWebPage",
    "@id": abs(profile.url, page.path) + "#webpage",
    url: abs(profile.url, page.path),
    name: page.title,
    description: page.description,
    inLanguage: "uk",
    lastReviewed: reviewedDate,
    dateModified: reviewedDate,
    isPartOf: { "@type": "MedicalClinic", "@id": abs(profile.url, "/") + CLINIC_ID },
    about: { "@type": "MedicalProcedure", name: page.title },
    audience: { "@type": "MedicalAudience", audienceType: "Patient" },
    specialty: "Radiography",
  };
}

export function medicalProcedure(page: StructuredPage, profile: StructuredProfile): JsonLdNode {
  const node: JsonLdNode = {
    "@type": "MedicalProcedure",
    name: page.title,
    procedureType: "https://schema.org/DiagnosticProcedure",
    howPerformed: page.intro || page.description,
    provider: { "@type": "MedicalClinic", "@id": abs(profile.url, "/") + CLINIC_ID },
  };
  const prep = (page.preparation || []).filter((s) => s && s.trim());
  if (prep.length) node.preparation = prep.join(" ");
  return node;
}

// Єдиний граф для однієї <script>-вставки на сторінці.
export function medicalPageGraph(
  page: StructuredPage,
  profile: StructuredProfile,
  reviewedDate: string,
): JsonLdNode {
  return {
    "@context": "https://schema.org",
    "@graph": [
      breadcrumbList(page, profile),
      medicalWebPage(page, profile, reviewedDate),
      medicalProcedure(page, profile),
    ],
  };
}

// Безпечне вбудовування в HTML (екрануємо «<», щоб не закрити <script>).
export function safeJsonLd(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

// --- Валідатор -------------------------------------------------------------

export type SchemaIssue = { node: string; field: string; detail: string };

const REQUIRED: Record<string, string[]> = {
  MedicalWebPage: ["url", "name", "description", "inLanguage", "about"],
  BreadcrumbList: ["itemListElement"],
  MedicalProcedure: ["name"],
  MedicalClinic: ["name"],
};

function validateNode(node: JsonLdNode, out: SchemaIssue[]) {
  const type = String(node["@type"] || "");
  if (!type) {
    out.push({ node: "?", field: "@type", detail: "немає типу" });
    return;
  }
  for (const field of REQUIRED[type] || []) {
    const v = node[field];
    if (v === undefined || v === null || (typeof v === "string" && v.trim() === "")) {
      out.push({ node: type, field, detail: "порожнє або відсутнє" });
    }
  }
  if (type === "BreadcrumbList") {
    const items = (node.itemListElement as JsonLdNode[]) || [];
    if (!items.length) out.push({ node: type, field: "itemListElement", detail: "порожній список" });
    items.forEach((it, i) => {
      if (typeof it.position !== "number") out.push({ node: type, field: `itemListElement[${i}].position`, detail: "немає позиції" });
      if (!it.name) out.push({ node: type, field: `itemListElement[${i}].name`, detail: "немає назви" });
      if (!it.item) out.push({ node: type, field: `itemListElement[${i}].item`, detail: "немає посилання" });
    });
  }
}

// Приймає окремий вузол або граф (@graph). Повертає перелік проблем (порожній —
// якщо все гаразд).
export function validateJsonLd(root: JsonLdNode): SchemaIssue[] {
  const out: SchemaIssue[] = [];
  if (!root["@context"]) out.push({ node: "root", field: "@context", detail: "немає контексту" });
  const graph = (root["@graph"] as JsonLdNode[]) || [root];
  for (const node of graph) validateNode(node, out);
  return out;
}
