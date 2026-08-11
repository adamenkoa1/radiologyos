#!/usr/bin/env bash
# Deploy RadiologyOS to your own Cloudflare account (Workers + D1 + Assets).
#
# Prerequisites (one-time), see HOSTING.md:
#   1. A Cloudflare account and `wrangler login` completed.
#   2. A D1 database created and its id pasted into wrangler.cloudflare.toml.
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

echo "[1/4] Building the artifact (dist/server + dist/client)…"
npm run build

echo "[2/4] Recording the current D1 recovery bookmark…"
npx wrangler d1 time-travel info radiologyos --config "${CONFIG}"

echo "[3/4] Applying D1 migrations to the remote database…"
npx wrangler d1 migrations apply radiologyos --remote --config "${CONFIG}"

echo "[4/4] Deploying the Worker and static assets…"
npx wrangler deploy --config "${CONFIG}"

echo "✓ Deployed to the custom domains configured in ${CONFIG}."
