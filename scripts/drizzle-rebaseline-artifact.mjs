import { DatabaseSync } from "node:sqlite";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  unlink,
  writeFile,
} from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const drizzleDir = join(root, "drizzle");
const artifactDir = join(root, ".drizzle-rebaseline-artifact");
const artifactMetaDir = join(artifactDir, "meta");
const workDir = await mkdtemp(join(tmpdir(), "radiologyos-drizzle-rebaseline-"));
const dbPath = join(workDir, "migrated.sqlite");
const quoteIdentifier = (value) => `"${String(value).replaceAll('"', '""')}"`;
const run = (command, args) => spawnSync(command, args, {
  cwd: root,
  encoding: "utf8",
  stdio: "pipe",
  env: { ...process.env, CI: "true" },
});
const printResult = (result) => {
  process.stdout.write(result.stdout || "");
  process.stderr.write(result.stderr || "");
};

function extractChecks(createSql) {
  const checks = [];
  const sqlText = String(createSql || "");
  let quote = "";
  for (let i = 0; i < sqlText.length; i += 1) {
    const ch = sqlText[i];
    if (quote) {
      if (quote === "]") {
        if (ch === "]") quote = "";
      } else if (ch === quote) {
        if ((quote === "'" || quote === '"') && sqlText[i + 1] === quote) i += 1;
        else quote = "";
      }
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") {
      quote = ch;
      continue;
    }
    if (ch === "[") {
      quote = "]";
      continue;
    }
    if (sqlText.slice(i, i + 5).toUpperCase() !== "CHECK") continue;
    const before = sqlText[i - 1] || " ";
    const after = sqlText[i + 5] || " ";
    if (/[A-Za-z0-9_]/.test(before) || /[A-Za-z0-9_]/.test(after)) continue;
    let open = i + 5;
    while (/\s/.test(sqlText[open] || "")) open += 1;
    if (sqlText[open] !== "(") continue;
    let depth = 1;
    let innerQuote = "";
    let end = open + 1;
    for (; end < sqlText.length; end += 1) {
      const inner = sqlText[end];
      if (innerQuote) {
        if (innerQuote === "]") {
          if (inner === "]") innerQuote = "";
        } else if (inner === innerQuote) {
          if ((innerQuote === "'" || innerQuote === '"') && sqlText[end + 1] === innerQuote) end += 1;
          else innerQuote = "";
        }
        continue;
      }
      if (inner === "'" || inner === '"' || inner === "`") innerQuote = inner;
      else if (inner === "[") innerQuote = "]";
      else if (inner === "(") depth += 1;
      else if (inner === ")") {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    if (depth !== 0) throw new Error(`Unbalanced CHECK expression in: ${sqlText}`);
    checks.push(sqlText.slice(open + 1, end).trim());
    i = end;
  }
  return checks;
}

function ensureConstraintSeparator(value) {
  const trailingWhitespace = value.match(/\s*$/)?.[0] || "";
  const body = value.slice(0, value.length - trailingWhitespace.length);
  if (!body || body.endsWith("[") || body.endsWith(",")) return value;
  return `${body},${trailingWhitespace}`;
}

function injectChecks(schema, checksByTable) {
  let output = schema;
  for (const [tableName, expressions] of checksByTable) {
    if (!expressions.length) continue;
    const marker = `sqliteTable("${tableName}",`;
    const start = output.indexOf(marker);
    if (start < 0) throw new Error(`Generated schema is missing table ${tableName}`);
    const next = output.indexOf("\nexport const ", start + marker.length);
    const end = next < 0 ? output.length : next;
    let block = output.slice(start, end);
    const checkLines = expressions
      .map((expression, index) => `\tcheck(${JSON.stringify(`${tableName}_check_${index + 1}`)}, sql.raw(${JSON.stringify(expression)})),`)
      .join("\n");
    const callbackEnd = block.lastIndexOf("]);");
    if (callbackEnd >= 0 && block.includes("(table) => [")) {
      const beforeChecks = ensureConstraintSeparator(block.slice(0, callbackEnd));
      block = `${beforeChecks}${checkLines}\n${block.slice(callbackEnd)}`;
    } else {
      const simpleEnd = block.lastIndexOf("});");
      if (simpleEnd < 0) throw new Error(`Could not add CHECK constraints to ${tableName}`);
      block = `${block.slice(0, simpleEnd)}},\n(table) => [\n${checkLines}\n]);${block.slice(simpleEnd + 3)}`;
    }
    output = `${output.slice(0, start)}${block}${output.slice(end)}`;
  }
  return output;
}

function injectPartialIndexes(schema, partialIndexes) {
  const lines = schema.split("\n");
  for (const { name, predicate } of partialIndexes) {
    const at = lines.findIndex((line) => line.includes(`("${name}")`) && line.includes(".on("));
    if (at < 0) throw new Error(`Generated schema is missing partial index ${name}`);
    lines[at] = lines[at].replace(/,$/, `.where(sql.raw(${JSON.stringify(predicate)})),`);
  }
  return lines.join("\n");
}

try {
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA foreign_keys = ON;");
  const migrations = (await readdir(drizzleDir))
    .filter((name) => /^\d{4}_.+\.sql$/.test(name))
    .sort();
  if (!migrations.length) throw new Error("No committed SQL migrations found");
  const latestMigration = migrations.at(-1);
  const latestTag = latestMigration.slice(0, -4);
  const latestPrefix = latestTag.slice(0, 4);
  const latestIndex = Number(latestPrefix);
  if (!Number.isInteger(latestIndex)) throw new Error(`Invalid latest migration prefix: ${latestPrefix}`);
  const existingJournal = JSON.parse(await readFile(join(drizzleDir, "meta", "_journal.json"), "utf8"));

  for (const migration of migrations) {
    const sql = await readFile(join(drizzleDir, migration), "utf8");
    try {
      db.exec(sql);
    } catch (error) {
      throw new Error(`${migration}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const tableRows = db.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
  const checksByTable = new Map(tableRows.map(({ name, sql }) => [name, extractChecks(sql)]));
  const partialIndexes = db.prepare("SELECT name, tbl_name AS tableName, sql FROM sqlite_master WHERE type = 'index' AND sql IS NOT NULL ORDER BY name").all()
    .map(({ name, tableName, sql }) => {
      const match = String(sql).match(/\bWHERE\b([\s\S]+)$/i);
      return match ? { name, tableName, predicate: match[1].replace(/;\s*$/, "").trim() } : null;
    })
    .filter(Boolean);
  console.log(`Recovered D1 CHECK constraints: ${[...checksByTable.values()].reduce((sum, items) => sum + items.length, 0)}`);
  console.log(`Recovered D1 partial indexes: ${partialIndexes.map(({ name }) => name).join(", ") || "none"}`);

  // drizzle-kit 0.31.10 cannot introspect the repository's raw-SQL views.
  // They remain authoritative in committed migrations; remove them only from
  // this disposable database copy so table/index/FK introspection can finish.
  const views = db.prepare("SELECT name FROM sqlite_master WHERE type = 'view' ORDER BY name").all();
  console.log(`Raw SQL views excluded from Drizzle pull: ${views.map(({ name }) => name).join(", ") || "none"}`);
  for (const { name } of views) db.exec(`DROP VIEW ${quoteIdentifier(name)}`);
  db.close();

  await rm(artifactDir, { recursive: true, force: true });
  const drizzleKit = resolve(root, "node_modules/.bin/drizzle-kit");
  const pull = run(drizzleKit, [
    "pull",
    "--dialect=sqlite",
    `--url=${dbPath}`,
    `--out=${artifactDir}`,
    "--introspect-casing=camel",
  ]);
  printResult(pull);
  if (pull.status !== 0) throw new Error(`drizzle-kit pull failed with exit code ${pull.status}`);

  const pulledSnapshot = join(artifactMetaDir, "0000_snapshot.json");
  const snapshot = JSON.parse(await readFile(pulledSnapshot, "utf8"));

  // drizzle-kit 0.31.10 misplaces/truncates CHECK expressions, loses partial
  // index predicates, emits SQL expression defaults as strings and drops one
  // REAL DEFAULT 0. Rebuild those pieces from sqlite_master, which is the schema
  // produced by the committed migrations, rather than trusting pull output.
  const generatedSchemaPath = join(artifactDir, "schema.ts");
  let currentTable = "";
  let generatedSchema = (await readFile(generatedSchemaPath, "utf8"))
    .replaceAll('.default("sql`(CURRENT_TIMESTAMP)`")', '.default(sql`(CURRENT_TIMESTAMP)`)')
    .replaceAll(
      '.default("sql`(lower(hex(randomblob(16))))`")',
      '.default(sql`(lower(hex(randomblob(16))))`)',
    )
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("check("))
    .map((line) => {
      const tableMatch = line.match(/sqliteTable\("([^"]+)"/);
      if (tableMatch) currentTable = tableMatch[1];
      if (currentTable === "inventory_items" && line.includes('minStock: real("min_stock").notNull(),')) {
        return line.replace('.notNull(),', '.default(0).notNull(),');
      }
      return line;
    })
    .join("\n");
  generatedSchema = injectChecks(generatedSchema, checksByTable);
  generatedSchema = injectPartialIndexes(generatedSchema, partialIndexes);
  await writeFile(generatedSchemaPath, generatedSchema);

  // Keep snapshot normalization conservative in this diagnostic pass. The next
  // generated snapshot is copied into the artifact when CHECK/predicate metadata
  // differs, giving the exact Drizzle v6 representation to apply safely.
  for (const table of Object.values(snapshot.tables || {})) {
    table.checkConstraints = {};
    const id = table.columns?.id;
    if (id?.primaryKey && id?.autoincrement) id.notNull = true;
  }
  await writeFile(pulledSnapshot, `${JSON.stringify(snapshot, null, 2)}\n`);

  // Convert drizzle-kit pull's synthetic 0000 metadata into a baseline anchored
  // to the latest real committed migration. Keep the existing journal entries
  // as historical metadata so old migration provenance remains inspectable, then
  // append idx=89. The historical missing 0085 filename is deliberately kept;
  // the next generated migration must therefore be 0090.
  const baselineSnapshot = join(artifactMetaDir, `${latestPrefix}_snapshot.json`);
  await rename(pulledSnapshot, baselineSnapshot);
  const gitTime = run("git", ["log", "-1", "--format=%ct", "--", `drizzle/${latestMigration}`]);
  const whenSeconds = Number(String(gitTime.stdout || "").trim());
  const baselineEntry = {
    idx: latestIndex,
    version: "6",
    when: Number.isFinite(whenSeconds) && whenSeconds > 0 ? whenSeconds * 1000 : 0,
    tag: latestTag,
    breakpoints: true,
  };
  const journal = {
    version: "7",
    dialect: "sqlite",
    entries: [
      ...(Array.isArray(existingJournal.entries)
        ? existingJournal.entries.filter((entry) => entry.idx < latestIndex && entry.tag !== latestTag)
        : []),
      baselineEntry,
    ],
  };
  await writeFile(join(artifactMetaDir, "_journal.json"), `${JSON.stringify(journal, null, 2)}\n`);
  for (const name of await readdir(artifactDir)) {
    if (name.endsWith(".sql")) await unlink(join(artifactDir, name));
  }
  await rm(join(artifactDir, "relations.ts"), { force: true });

  // Stage the generated declarations and baseline metadata in this disposable
  // CI checkout. Normal lint/type/build/tests below therefore validate exactly
  // what will later be committed, while production and committed SQL stay untouched.
  await copyFile(generatedSchemaPath, join(root, "db/schema.ts"));
  await rm(join(drizzleDir, "meta"), { recursive: true, force: true });
  await mkdir(join(drizzleDir, "meta"), { recursive: true });
  await copyFile(baselineSnapshot, join(drizzleDir, "meta", `${latestPrefix}_snapshot.json`));
  await copyFile(join(artifactMetaDir, "_journal.json"), join(drizzleDir, "meta", "_journal.json"));

  const eslint = resolve(root, "node_modules/.bin/eslint");
  const lintFix = run(eslint, ["--fix", "db/schema.ts"]);
  printResult(lintFix);
  if (lintFix.status !== 0) throw new Error(`eslint --fix db/schema.ts failed with exit code ${lintFix.status}`);
  await copyFile(join(root, "db/schema.ts"), generatedSchemaPath);

  const beforeSql = new Set((await readdir(drizzleDir)).filter((name) => /^\d{4}_.+\.sql$/.test(name)));
  console.log("--- drizzle generate no-op proof ---");
  const generate = run(drizzleKit, ["generate"]);
  printResult(generate);
  if (generate.status !== 0) throw new Error(`drizzle-kit generate failed with exit code ${generate.status}`);
  const afterSql = (await readdir(drizzleDir)).filter((name) => /^\d{4}_.+\.sql$/.test(name));
  const generatedMigrations = afterSql.filter((name) => !beforeSql.has(name));
  if (generatedMigrations.length) {
    for (const name of generatedMigrations) {
      await copyFile(join(drizzleDir, name), join(artifactDir, `drift-${name}`));
      const prefix = name.slice(0, 4);
      const generatedSnapshot = join(drizzleDir, "meta", `${prefix}_snapshot.json`);
      try {
        await copyFile(generatedSnapshot, join(artifactDir, `drift-${prefix}_snapshot.json`));
      } catch {
        // The SQL file itself is sufficient when drizzle-kit omits a snapshot.
      }
    }
    throw new Error(`Rebaseline is not a no-op; generated: ${generatedMigrations.join(", ")}`);
  }

  const files = (await readdir(artifactDir, { recursive: true })).sort();
  console.log(`Rebaseline source: ${latestMigration} (${migrations.length} committed migrations)`);
  console.log(`Baseline journal idx: ${latestIndex}; next expected migration: ${String(latestIndex + 1).padStart(4, "0")}`);
  console.log(`Artifact files: ${files.join(", ")}`);
} finally {
  await rm(workDir, { recursive: true, force: true });
}
