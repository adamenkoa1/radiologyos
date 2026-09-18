// Ефективний CSS кабінету: точка входу app/globals.css тепер лише список
// @import зон із app/styles/. Тести стилів читають конкатенацію (у порядку
// @import), тож перевірки правил лишаються валідними після розбиття моноліту.

import { readFile } from "node:fs/promises";

export async function globalsCss() {
  const entryUrl = new URL("../../app/globals.css", import.meta.url);
  const entry = await readFile(entryUrl, "utf8");
  const rel = [...entry.matchAll(/@import\s+"\.\/([^"]+)"/g)].map((m) => m[1]);
  const parts = await Promise.all(
    rel.map((p) => readFile(new URL(`../../app/${p}`, import.meta.url), "utf8")),
  );
  return entry + "\n" + parts.join("\n");
}
