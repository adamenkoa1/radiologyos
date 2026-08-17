#!/usr/bin/env bash
# Deploy RadiologyOS to your own Cloudflare account (Workers + D1 + Assets).
#
# Prerequisites (one-time), see HOSTING.md:
#   1. A Cloudflare account and `wrangler login` completed.
#   2. A D1 database created and its id pasted into wrangler.cloudflare.toml.
#   3. The private `radiologyos-printed-forms` R2 bucket created.
#
# Then run:  bash scripts/deploy-cloudflare.sh
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."
CONFIG="wrangler.cloudflare.toml"

if grep -q "REPLACE_WITH_YOUR_D1_DATABASE_ID" "${CONFIG}"; then
  echo "✗ Set your D1 database_id in ${CONFIG} first (see HOSTING.md)." >&2
  exit 1
fi

if [[ "${RADIOLOGYOS_DEPLOY_CONFIRM:-}" != "DEPLOY" ]]; then
  echo "Production deployment is blocked." >&2
  echo "Review the change, then run with RADIOLOGYOS_DEPLOY_CONFIRM=DEPLOY." >&2
  exit 1
fi

echo "[1/6] Building the artifact (dist/server + dist/client)…"
npm run build

echo "[2/6] Verifying the private printed-form R2 bucket exists…"
npx wrangler r2 bucket info radiologyos-printed-forms --config "${CONFIG}" --json > /tmp/radiologyos-printed-forms-r2.json

echo "[3/6] Recording the current D1 recovery bookmark…"
npx wrangler d1 time-travel info radiologyos --config "${CONFIG}"

echo "[4/6] Applying D1 migrations to the remote database…"
bash scripts/apply-d1-migrations-remote.sh radiologyos "${CONFIG}" drizzle

echo "[5/6] Verifying a secure active administrator credential…"
ADMIN_GUARD_SQL=$(cat <<'SQL'
WITH admins AS (
  SELECT password_hash,
         substr(password_hash,15,instr(substr(password_hash,15),'$')-1) AS iterations
  FROM staff_members
  WHERE role = 'admin' AND active = 1
)
SELECT COUNT(*) AS secure_admins
FROM admins
WHERE substr(password_hash,1,14) = 'pbkdf2$sha256$'
  AND length(password_hash) - length(replace(password_hash,'$','')) = 4
  AND iterations <> ''
  AND iterations NOT GLOB '*[^0-9]*'
  AND CAST(iterations AS INTEGER) >= 1000
  AND length(password_hash) >= 80
  AND password_hash NOT IN ('pbkdf2$sha256$100000$DIdGQmQdc8l2yyObk0lw0A==$btlwHhk42m8+m7NJlqXpZXQZYZ5d8gsRfxFMTqw59gc=');
SQL
)
npx wrangler d1 execute radiologyos --remote --config "${CONFIG}" --json \
  --command "$ADMIN_GUARD_SQL" \
  > /tmp/radiologyos-secure-admin.json
node -e '
  const payload = JSON.parse(require("node:fs").readFileSync("/tmp/radiologyos-secure-admin.json", "utf8"));
  const count = Number(payload?.[0]?.results?.[0]?.secure_admins ?? 0);
  if (count < 1) {
    console.error("Production deploy blocked: create an active administrator with a valid unique PBKDF2 password first.");
    process.exit(1);
  }
'

echo "[6/6] Deploying the Worker and static assets…"
# Runtime configuration such as OUTBOUND_ALLOWED_HOSTS may be managed in the
# Cloudflare Worker environment rather than committed to source control.
npx wrangler deploy --keep-vars --config "${CONFIG}"

echo "✓ Deployed to the custom domains configured in ${CONFIG}."
