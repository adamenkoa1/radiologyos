#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ "${SITES_ENV_READY:-}" != "1" ]]; then
  exec "${script_dir}/sites-env.sh" -- "$0" "$@"
fi

command -v timeout >/dev/null || {
  echo "build-verified.sh requires GNU timeout." >&2
  exit 69
}

vinext="${SITES_PROJECT_ROOT}/node_modules/.bin/vinext"
if [[ ! -x "${vinext}" ]]; then
  echo "vinext is unavailable. Run npm run install:ci and wait for it to finish before building." >&2
  exit 69
fi

echo "Running bounded vinext build..."
timeout \
  --signal=TERM \
  --kill-after="${SITES_BUILD_KILL_AFTER:-10s}" \
  "${SITES_BUILD_TIMEOUT:-3m}" \
  "${vinext}" build

# Публічний статичний сайт /site/* не має кеш-хешів у іменах файлів, тож без
# явного правила браузер/edge кешують стару версію і оновлення «не видно».
# Просимо щоразу перевіряти свіжість (revalidate; 304 коли без змін).
headers_file="${SITES_PROJECT_ROOT}/dist/client/_headers"
if [[ -f "${headers_file}" ]] && ! grep -q '^/site/\*' "${headers_file}"; then
  printf '\n# Публічний сайт: без кеш-хешів — завжди перевіряти свіжість\n/site/*\n  Cache-Control: no-cache\n' >> "${headers_file}"
fi

"${script_dir}/validate-artifact.sh"
