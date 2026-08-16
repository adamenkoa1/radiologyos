#!/usr/bin/env bash
set -euo pipefail

DATABASE="${1:-radiologyos}"
CONFIG="${2:-wrangler.cloudflare.toml}"
MIGRATIONS_DIR="${3:-drizzle}"

if [[ ! -d "${MIGRATIONS_DIR}" ]]; then
  echo "D1 migration directory not found: ${MIGRATIONS_DIR}" >&2
  exit 1
fi

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "${TMP_DIR}"' EXIT

run_json() {
  local output="$1"
  shift
  npx wrangler d1 execute "${DATABASE}" --remote --config "${CONFIG}" --json "$@" > "${output}"
}

# Keep the migration registry identical to Wrangler's built-in D1 migration table.
run_json "${TMP_DIR}/init.json" --command "CREATE TABLE IF NOT EXISTS d1_migrations(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE,
  applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
);"

read_applied() {
  run_json "${TMP_DIR}/applied.json" --command "SELECT name FROM d1_migrations ORDER BY id;"
  node - "${TMP_DIR}/applied.json" "${TMP_DIR}/applied.txt" <<'NODE'
const fs = require("node:fs");
const [input, output] = process.argv.slice(2);
const payload = JSON.parse(fs.readFileSync(input, "utf8"));
const rows = payload?.[0]?.results ?? [];
const names = rows.map((row) => String(row.name ?? "")).filter(Boolean);
fs.writeFileSync(output, names.join("\n") + (names.length ? "\n" : ""));
NODE
}

read_applied
mapfile -t MIGRATIONS < <(find "${MIGRATIONS_DIR}" -maxdepth 1 -type f -name '*.sql' -printf '%f\n' | LC_ALL=C sort)

for name in "${MIGRATIONS[@]}"; do
  if [[ ! "${name}" =~ ^[0-9]+_[A-Za-z0-9._-]+\.sql$ ]]; then
    echo "Unsafe D1 migration filename: ${name}" >&2
    exit 1
  fi
  if grep -Fqx -- "${name}" "${TMP_DIR}/applied.txt"; then
    continue
  fi

  echo "Applying D1 migration via file import: ${name}"
  IMPORT_FILE="${TMP_DIR}/${name}"
  cat "${MIGRATIONS_DIR}/${name}" > "${IMPORT_FILE}"
  printf "\nINSERT INTO d1_migrations (name) VALUES ('%s');\n" "${name}" >> "${IMPORT_FILE}"

  # --file uses Wrangler's remote D1 import path rather than the /query path used
  # by `d1 migrations apply`. The migration and registry insert are submitted in
  # the same SQL file, so a failed import cannot mark an unapplied migration done.
  npx wrangler d1 execute "${DATABASE}" --remote --config "${CONFIG}" --file "${IMPORT_FILE}"

  VERIFY_SQL="SELECT COUNT(*) AS applied FROM d1_migrations WHERE name='${name}';"
  run_json "${TMP_DIR}/verify.json" --command "${VERIFY_SQL}"
  node - "${TMP_DIR}/verify.json" "${name}" <<'NODE'
const fs = require("node:fs");
const [input, name] = process.argv.slice(2);
const payload = JSON.parse(fs.readFileSync(input, "utf8"));
const count = Number(payload?.[0]?.results?.[0]?.applied ?? 0);
if (count !== 1) {
  console.error(`D1 migration registry verification failed for ${name}`);
  process.exit(1);
}
NODE
  printf '%s\n' "${name}" >> "${TMP_DIR}/applied.txt"
done

read_applied
node - "${MIGRATIONS_DIR}" "${TMP_DIR}/applied.txt" <<'NODE'
const fs = require("node:fs");
const path = require("node:path");
const [dir, appliedFile] = process.argv.slice(2);
const local = fs.readdirSync(dir).filter((name) => name.endsWith(".sql")).sort();
const applied = new Set(fs.readFileSync(appliedFile, "utf8").split(/\r?\n/).filter(Boolean));
const missing = local.filter((name) => !applied.has(name));
if (missing.length) {
  console.error(`D1 migration verification failed; still unapplied: ${missing.join(", ")}`);
  process.exit(1);
}
console.log(`D1 migrations verified: ${local.length} local migration(s) are recorded as applied.`);
NODE
