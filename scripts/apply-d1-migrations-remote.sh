#!/usr/bin/env bash
set -euo pipefail

DATABASE="${1:-radiologyos}"
CONFIG="${2:-wrangler.cloudflare.toml}"
MIGRATIONS_DIR="${3:-drizzle}"

if [[ ! -d "${MIGRATIONS_DIR}" ]]; then
  echo "D1 migration directory not found: ${MIGRATIONS_DIR}" >&2
  exit 1
fi

# Fail closed on an unreplaced D1 id placeholder (prod: REPLACE_WITH_YOUR_D1_DATABASE_ID,
# staging: REPLACE_WITH_STAGING_D1_ID). This stops a migration/deploy from running
# against a template config whose database_id was never filled in, before any D1 call.
if [[ -f "${CONFIG}" ]] && grep -Eq 'REPLACE_WITH_[A-Z_]*D1[A-Z_]*ID' "${CONFIG}"; then
  echo "✗ ${CONFIG} still has a placeholder D1 database_id. Replace it (staging: REPLACE_WITH_STAGING_D1_ID) with your real database id before migrating/deploying." >&2
  exit 1
fi

# Read the first database_name / database_id declared in a wrangler TOML config.
toml_value() { grep -E "^[[:space:]]*$2[[:space:]]*=" "$1" | head -1 | sed -E 's/.*=[[:space:]]*"([^"]*)".*/\1/'; }

PROD_CONFIG="wrangler.cloudflare.toml"

# Guard 1: the selected database must match the database_name declared in the
# chosen config. Stops migrating the wrong database because the arg and the
# config disagree (e.g. passing radiologyos-staging at a config that still
# declares the production database_name).
if [[ -f "${CONFIG}" ]]; then
  CONFIG_DB_NAME="$(toml_value "${CONFIG}" database_name)"
  if [[ -n "${CONFIG_DB_NAME}" && "${CONFIG_DB_NAME}" != "${DATABASE}" ]]; then
    echo "✗ Selected database '${DATABASE}' does not match database_name '${CONFIG_DB_NAME}' in ${CONFIG}. Refusing to migrate a database the selected config does not declare." >&2
    exit 1
  fi
fi

# Guard 2: only the production config may carry the production D1 id. Any other
# config (e.g. wrangler.staging.toml) that points at the production database_id
# is a dangerous misconfiguration — reject it before any D1 call. The production
# id is read from the canonical prod config, not hardcoded, so id rotation is safe.
if [[ -f "${CONFIG}" && -f "${PROD_CONFIG}" && "${CONFIG}" != "${PROD_CONFIG}" ]]; then
  PROD_DB_ID="$(toml_value "${PROD_CONFIG}" database_id)"
  THIS_DB_ID="$(toml_value "${CONFIG}" database_id)"
  if [[ -n "${PROD_DB_ID}" && "${PROD_DB_ID}" != REPLACE_WITH_* && "${THIS_DB_ID}" == "${PROD_DB_ID}" ]]; then
    echo "✗ ${CONFIG} points at the PRODUCTION D1 id (${PROD_DB_ID}). A non-production config must use its own database. Refusing to migrate production through a non-production config." >&2
    exit 1
  fi
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
  node scripts/prepare-d1-migration-remote.mjs \
    "${MIGRATIONS_DIR}/${name}" "${IMPORT_FILE}" "${name}"

  # D1 keeps foreign_keys enabled for every migration. A migration may temporarily defer
  # those checks while rebuilding a referenced table, but it must finish with all
  # relationships valid. Force an explicit validation boundary before the registry insert
  # so a schema migration cannot be marked applied while deferred FK work is unresolved.
  if grep -Eiq '^[[:space:]]*PRAGMA[[:space:]]+defer_foreign_keys[[:space:]]*=[[:space:]]*(ON|TRUE|1)[[:space:]]*;?[[:space:]]*$' "${MIGRATIONS_DIR}/${name}"; then
    printf '\nPRAGMA defer_foreign_keys = OFF;\n' >> "${IMPORT_FILE}"
  fi

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
