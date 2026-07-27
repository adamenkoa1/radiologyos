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

echo "[1/3] Building the artifact (dist/server + dist/client)…"
npm run build

echo "[2/3] Applying D1 migrations to the remote database…"
npx wrangler d1 migrations apply DB --remote --config "${CONFIG}"

echo "[3/3] Deploying the Worker and static assets…"
npx wrangler deploy --config "${CONFIG}"

echo "✓ Deployed. Configure your custom domain in the Cloudflare dashboard"
echo "  (Workers & Pages → your worker → Settings → Domains & Routes)."
