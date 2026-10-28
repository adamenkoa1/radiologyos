// Фільтри черги опису на /staff/protocols: модальність, виконавець, діапазон
// дат. Поєднуються з пошуком і вкладками статусів; опції беруться лише з уже
// скоупованої серверної черги (без розширення доступу); є скидання й стан
// «немає результатів». Перевірка через інспекцію джерела.

import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const read = (p) => readFile(new URL(`../${p}`, import.meta.url), "utf8");

test("filter state and reset helper exist", async () => {
  const page = await read("app/staff/protocols/page.tsx");
  assert.match(page, /const \[fModality,setFModality\] = useState\("all"\)/);
  assert.match(page, /const \[fPerformer,setFPerformer\] = useState\("all"\)/);
  assert.match(page, /const \[fDateFrom,setFDateFrom\] = useState\(""\)/);
  assert.match(page, /const \[fDateTo,setFDateTo\] = useState\(""\)/);
  assert.match(page, /function resetFilters\(\) \{ setFModality\("all"\); setFPerformer\("all"\); setFDateFrom\(""\); setFDateTo\(""\); \}/);
});

test("filter options are derived from the (already scoped) queue, not a global source", async () => {
  const page = await read("app/staff/protocols/page.tsx");
  // модальності/виконавці — лише з наявної черги (яку сервер уже обмежив роллю)
  assert.match(page, /modalityOptions = useMemo\(\s*\(\) => Array\.from\(new Set\(queue\.map\(\(i\) => i\.equipmentId\)/);
  assert.match(page, /performerOptions = useMemo\(\s*\(\) => Array\.from\(new Set\(queue\.map\(\(i\) => i\.assignedRadiologistEmail\)/);
});

test("visible list applies all three filters in addition to tab + search", async () => {
  const page = await read("app/staff/protocols/page.tsx");
  const vis = page.slice(page.indexOf("const visible = useMemo"), page.indexOf("const counts = useMemo"));
  // статус-вкладка + пошук збережені
  assert.match(vis, /filter === "awaiting"/);
  assert.match(vis, /\.toLowerCase\(\)\.includes\(query\.trim\(\)\.toLowerCase\(\)\)/);
  // три нові фільтри
  assert.match(vis, /fModality === "all" \|\| item\.equipmentId === fModality/);
  assert.match(vis, /fPerformer === "all" \|\| item\.assignedRadiologistEmail === fPerformer/);
  assert.match(vis, /!fDateFrom \|\| \(Boolean\(d\) && d >= fDateFrom\)/);
  assert.match(vis, /!fDateTo \|\| \(Boolean\(d\) && d <= fDateTo\)/);
  // усі фільтри в залежностях useMemo
  assert.match(vis, /\[queue,filter,query,fModality,fPerformer,fDateFrom,fDateTo\]/);
});

test("date basis is performed date, falling back to desired date (10-char ISO)", async () => {
  const page = await read("app/staff/protocols/page.tsx");
  assert.match(page, /const itemDate = \(item:QueueItem\) => \(item\.performedAt \|\| item\.desiredDate \|\| ""\)\.slice\(0, 10\)/);
});

test("filter UI: modality + performer selects, two date inputs, labelled for a11y", async () => {
  const page = await read("app/staff/protocols/page.tsx");
  assert.match(page, /className="protocolFilterPanel"/);
  assert.match(page, /aria-label="Фільтр за модальністю"/);
  assert.match(page, /aria-label="Фільтр за виконавцем"/);
  assert.match(page, /aria-label="Дата дослідження від"/);
  assert.match(page, /aria-label="Дата дослідження до"/);
  // модальність рендериться через людські ярлики з fallback на id
  assert.match(page, /EQUIPMENT_LABELS\[m\] \|\| m/);
  // діапазон дат узгоджений (max/min)
  assert.match(page, /max=\{fDateTo \|\| undefined\}/);
  assert.match(page, /min=\{fDateFrom \|\| undefined\}/);
});

test("reset button appears only when a filter is active", async () => {
  const page = await read("app/staff/protocols/page.tsx");
  assert.match(page, /const filtersActive = fModality !== "all" \|\| fPerformer !== "all" \|\| Boolean\(fDateFrom\) \|\| Boolean\(fDateTo\)/);
  assert.match(page, /\{filtersActive && <button type="button" className="protocolFilterReset" onClick=\{resetFilters\}>Скинути фільтри<\/button>\}/);
});

test("empty state distinguishes no-results (search/filter) from empty category, with a reset", async () => {
  const page = await read("app/staff/protocols/page.tsx");
  assert.match(page, /\(query\.trim\(\) \|\| filtersActive/);
  assert.match(page, /За цим запитом досліджень не знайдено\./);
  assert.match(page, /setQuery\(""\); resetFilters\(\);/);
  assert.match(page, /Немає досліджень у цій категорії\./);
});

test("filter styles exist in workspace CSS (light + mobile) and dark theme", async () => {
  const css = await read("app/styles/02-workspace.css");
  for (const cls of ["protocolQueueFilters", "protocolFilterToggle", "protocolFilterReset", "protocolFilterPanel"]) {
    assert.match(css, new RegExp(`\\.${cls}\\b`), `${cls} styled`);
  }
  assert.match(css, /@media\(max-width:560px\)\{\.protocolFilterPanel\{grid-template-columns:1fr\}/);
  const dark = await read("app/styles/08-dark-theme.css");
  assert.match(dark, /\.themeDark \.protocolFilterPanel\b/);
});
