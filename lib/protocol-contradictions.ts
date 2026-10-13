// Детермінована перевірка суперечностей опис↔висновок (MASTER PROMPT 3, E2).
//
// Призначення: ловити ОЧЕВИДНІ, однозначні конфлікти між текстом опису й
// висновку протоколу простими детермінованими правилами — без AI, без мережі,
// без передачі даних пацієнта кудись. Складні семантичні випадки лишаються для
// майбутнього AI-шару (E), який теж лише пропонує.
//
// Інваріант безпеки: модуль НІЧОГО не переписує. Він повертає ДОРАДЧІ
// попередження з поясненням; рішення — за лікарем. Правила навмисно
// консервативні (низький рівень хибних спрацювань): краще пропустити сумнівний
// випадок, ніж заважати лікарю хибним сигналом.

export type ContradictionCode =
  | "laterality_description_vs_conclusion"
  | "gallbladder_distension_without_finding"
  | "ascites_present_but_denied"
  | "fracture_level_mismatch"
  | "protrusion_called_herniation"
  | "occlusion_on_native_ct"
  | "unit_mm_cm_mismatch";

export type Contradiction = { code: ContradictionCode; message: string };

export type ContradictionInput = {
  findings: string;
  conclusion: string;
  // Значення поля «Контрастування» зі структурованих параметрів, якщо є.
  contrast?: string;
};

// Присутня сторона в тексті (обидві можливі → двобічно, не конфлікт).
function sides(text: string): { right: boolean; left: boolean } {
  const t = text.toLowerCase();
  const bilateral = /двобічн|з обох бок|обох|білатераль/.test(t);
  return {
    right: /справа|правій|правого|правої|права|правостороннь|правобічн/.test(t) || bilateral,
    left: /зліва|лівій|лівого|лівої|ліва|лівостороннь|лівобічн/.test(t) || bilateral,
  };
}

// Українські літери: JS \w/\b — лише ASCII, тож для кирилиці не працюють.
const CYR = "а-яіїєґ'’";
// Заперечення поряд (кирилично-безпечне: межі слова через не-літеру).
const NEGATION = new RegExp(`(?:^|[^${CYR}])не(?:[^${CYR}]|$)|немає|відсутн|не виявлено|не визначаєть|без `);

// Негатив у безпосередній близькості до ключового слова (у межах фрагмента).
function negatedNear(text: string, keyword: RegExp): boolean {
  const lower = text.toLowerCase();
  const m = keyword.exec(lower);
  if (!m) return false;
  const start = Math.max(0, m.index - 40);
  const window = lower.slice(start, m.index + m[0].length + 40);
  return NEGATION.test(window);
}

const GALLBLADDER = new RegExp(`жовчн[${CYR}]*\\s+міхур[${CYR}]*`);
const ASCITES = new RegExp(`асцит|вільн[${CYR}]*\\s+рідин[${CYR}]*`);

function has(text: string, re: RegExp): boolean {
  return re.test(text.toLowerCase());
}

// Рівні хребта/хребців: латиниця або кирилиця C/Th/T/L/S + число.
function vertebralLevels(text: string): Set<string> {
  const out = new Set<string>();
  // Кирилично-безпечні межі: перед сегментом — не-літера/початок, після числа —
  // не-цифра/не-літера. \b тут не годиться (ASCII-only).
  const re = new RegExp(`(?:^|[^a-zа-яіїєґ])(th|t|c|l|s|с|т|л)\\s?-?\\s?(\\d{1,2})(?![\\da-zа-яіїєґ])`, "gi");
  let m: RegExpExecArray | null;
  const lower = text.toLowerCase();
  while ((m = re.exec(lower))) {
    let seg = m[1].toLowerCase();
    if (seg === "с") seg = "c";
    if (seg === "т" || seg === "th") seg = "th";
    if (seg === "л") seg = "l";
    if (seg === "t") seg = "th"; // поодинокий T трактуємо як грудний Th
    out.add(`${seg}${Number(m[2])}`);
  }
  return out;
}

export function findContradictions(input: ContradictionInput): Contradiction[] {
  const findings = input.findings || "";
  const conclusion = input.conclusion || "";
  const out: Contradiction[] = [];
  if (!findings.trim() && !conclusion.trim()) return out;

  // 1. Латералізація: опис однозначно про один бік, висновок — про протилежний.
  const df = sides(findings), dc = sides(conclusion);
  const descrRightOnly = df.right && !df.left;
  const descrLeftOnly = df.left && !df.right;
  const conclRightOnly = dc.right && !dc.left;
  const conclLeftOnly = dc.left && !dc.right;
  if ((descrRightOnly && conclLeftOnly) || (descrLeftOnly && conclRightOnly)) {
    out.push({
      code: "laterality_description_vs_conclusion",
      message: "Латералізація в описі і висновку протилежна (одне — справа, інше — зліва). Звірте сторону.",
    });
  }

  // 2. Жовчний міхур: опис — не збільшений/без змін, висновок — дистензія/збільшення.
  const gbNormalInFindings = GALLBLADDER.test(findings.toLowerCase())
    && negatedNear(findings, GALLBLADDER);
  const gbDistensionInConclusion = /дистензі/.test(conclusion.toLowerCase())
    || (GALLBLADDER.test(conclusion.toLowerCase()) && /збільшен|розширен|перерозтягнут/.test(conclusion.toLowerCase()));
  if (gbNormalInFindings && gbDistensionInConclusion) {
    out.push({
      code: "gallbladder_distension_without_finding",
      message: "В описі жовчний міхур без змін, а у висновку — дистензія/збільшення. Узгодьте опис і висновок.",
    });
  }

  // 3. Асцит/вільна рідина: присутня в описі — заперечена у висновку (чи навпаки).
  const ascitesAffirmedFindings = ASCITES.test(findings.toLowerCase()) && !negatedNear(findings, ASCITES);
  const ascitesDeniedConclusion = ASCITES.test(conclusion.toLowerCase()) && negatedNear(conclusion, ASCITES);
  const ascitesAffirmedConclusion = ASCITES.test(conclusion.toLowerCase()) && !negatedNear(conclusion, ASCITES);
  const ascitesDeniedFindings = ASCITES.test(findings.toLowerCase()) && negatedNear(findings, ASCITES);
  if ((ascitesAffirmedFindings && ascitesDeniedConclusion) || (ascitesDeniedFindings && ascitesAffirmedConclusion)) {
    out.push({
      code: "ascites_present_but_denied",
      message: "Наявність вільної рідини (асциту) в описі і висновку суперечлива. Звірте твердження.",
    });
  }

  // 4. Рівень перелому: опис і висновок називають перелом на різних рівнях.
  if (has(findings, /перелом/) && has(conclusion, /перелом/)) {
    const lf = vertebralLevels(findings), lc = vertebralLevels(conclusion);
    if (lf.size === 1 && lc.size === 1) {
      const a = [...lf][0], b = [...lc][0];
      if (a !== b) {
        out.push({
          code: "fracture_level_mismatch",
          message: `Рівень перелому в описі (${a.toUpperCase()}) і висновку (${b.toUpperCase()}) різний. Звірте рівень.`,
        });
      }
    }
  }

  // 5. Протрузія в описі → грижа у висновку без морфологічного підтвердження.
  const protrusionFindings = has(findings, /протрузі/) && !has(findings, /грижа|грижов|екструзі|секвестр/);
  const herniationConclusion = has(conclusion, /грижа|грижов/);
  if (protrusionFindings && herniationConclusion) {
    out.push({
      code: "protrusion_called_herniation",
      message: "В описі — протрузія, у висновку — грижа. Тип випинання визначає морфологія, а не лише розмір; узгодьте формулювання.",
    });
  }

  // 6. Судинна оклюзія у висновку на нативному КТ (без контрастування).
  if ((input.contrast || "").trim() === "Без контрастування") {
    if (has(conclusion, /оклюз|тромбоз|тромбоембол|\bтела\b|емболі/)) {
      out.push({
        code: "occlusion_on_native_ct",
        message: "Висновок стверджує судинну оклюзію/тромбоз, але дослідження без контрастування — таку оцінку нативне КТ достовірно не дає.",
      });
    }
  }

  // 7. Та сама величина в описі в мм, а у висновку в см (ймовірна помилка ×10).
  const mmNums = new Set<string>();
  for (const m of findings.toLowerCase().matchAll(new RegExp(`(\\d{1,3}(?:[.,]\\d)?)\\s*мм(?![${CYR}])`, "g"))) mmNums.add(m[1].replace(",", "."));
  for (const m of conclusion.toLowerCase().matchAll(new RegExp(`(\\d{1,3}(?:[.,]\\d)?)\\s*см(?![${CYR}])`, "g"))) {
    if (mmNums.has(m[1].replace(",", "."))) {
      out.push({
        code: "unit_mm_cm_mismatch",
        message: `Розмір «${m[1]}» вказано в описі в мм, а у висновку — в см. Імовірна помилка одиниць (×10). Звірте.`,
      });
      break;
    }
  }

  return out;
}
