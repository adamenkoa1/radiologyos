// Детектор «мертвого» CSS: збирає імена класів, оголошені в app/styles/*.css,
// і шукає їх у всьому вихідному корпусі (app, public, lib, tests, scripts,
// worker, db). Клас вважається живим, якщо він трапляється точно, як префікс
// динамічної композиції (`${base}-suffix`) чи як хвіст (`prefix-${x}`).
//
// Використовується тестом-охоронцем tests/dead-css.test.mjs, щоб новий
// невживаний селектор не потрапляв у бандл непоміченим.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SKIP_DIRS = new Set([
  "node_modules", ".git", "dist", "build", ".next", ".wrangler",
]);

function walk(dir, exts, out = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      walk(full, exts, out);
    } else if (exts.some((x) => e.name.endsWith(x))) {
      out.push(full);
    }
  }
  return out;
}

// Прибираємо коментарі й url(...), щоб не ловити токени з data-URI.
function stripCss(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/url\(([^)]*)\)/g, " ");
}

// Префікси, які збираються в рантаймі (`${prefix}${value}`) — кожен клас під
// ними досяжний динамічно. Синхронізовано з DYNAMIC_PREFIXES у тесті.
export const DYNAMIC_PREFIXES = [
  "st-", "priority-", "cmdkType-", "route-", "tint-",
  "state-", "grp-", "kind-", "mod-", "r-",
];

const CLASS_RE = /\.(-?[_a-zA-Z][_a-zA-Z0-9-]*)/g;
const TOKEN_RE = /[_a-zA-Z][_a-zA-Z0-9-]*/g;

export function findDeadClasses() {
  const styleDir = path.join(ROOT, "app/styles");
  const cssFiles = walk(styleDir, [".css"]);

  // 1) Оголошені класи.
  const defs = new Map(); // class -> Set(basename)
  for (const f of cssFiles) {
    const src = stripCss(fs.readFileSync(f, "utf8"));
    for (const m of src.matchAll(CLASS_RE)) {
      const cls = m[1];
      if (!defs.has(cls)) defs.set(cls, new Set());
      defs.get(cls).add(path.basename(f));
    }
  }

  // 2) Корпус усього, що може посилатися на клас (крім самих стилів).
  const corpusFiles = [
    ...walk(path.join(ROOT, "app"), [".tsx", ".ts", ".jsx", ".js", ".html"]),
    ...walk(path.join(ROOT, "public"), [".html", ".js", ".ts", ".css", ".svg"]),
    ...walk(path.join(ROOT, "lib"), [".ts", ".tsx", ".js"]),
    ...walk(path.join(ROOT, "tests"), [".mjs", ".ts", ".js"]),
    ...walk(path.join(ROOT, "scripts"), [".mjs", ".ts", ".js"]),
    ...walk(path.join(ROOT, "worker"), [".ts", ".js"]),
    ...walk(path.join(ROOT, "db"), [".ts", ".js", ".sql"]),
  ];
  const cssSet = new Set(cssFiles);
  let blob = "";
  for (const f of corpusFiles) {
    if (cssSet.has(f)) continue;
    try {
      blob += "\n" + fs.readFileSync(f, "utf8");
    } catch {}
  }

  const tokenSet = new Set();
  for (const m of blob.matchAll(TOKEN_RE)) tokenSet.add(m[0]);

  // Індекс частин дефісних токенів для перевірки динамічної композиції.
  const prefixParts = new Set();
  const suffixParts = new Set();
  for (const tok of tokenSet) {
    if (!tok.includes("-")) continue;
    prefixParts.add(tok.slice(0, tok.indexOf("-")));
    suffixParts.add(tok.slice(tok.lastIndexOf("-") + 1));
  }

  const referenced = (cls) => {
    if (DYNAMIC_PREFIXES.some((p) => cls.startsWith(p))) return true;
    if (tokenSet.has(cls)) return true;
    if (prefixParts.has(cls)) return true;
    if (suffixParts.has(cls)) return true;
    return blob.includes(cls + "-") || blob.includes("-" + cls);
  };

  const dead = [];
  for (const cls of defs.keys()) if (!referenced(cls)) dead.push(cls);
  dead.sort();
  return { dead, definedCount: defs.size };
}
