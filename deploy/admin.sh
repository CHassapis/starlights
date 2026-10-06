#!/usr/bin/env bash
# Content admin for a Starlights install made with setup.sh (reads .env next to this script).
#
#   ./admin.sh init                  once, on an empty database: the base rules
#   ./admin.sh import [index] [--update|--replace]
#                                    index: AuroraLegacy.index (default, everything), 5etools (deities Aurora lacks),
#                                    starlights (the built-in extras), homebrew (the Homebrew page's files)
#   ./admin.sh reprocess             run every character through the rules again (after an import)
#   ./admin.sh lore                  build the Compendium of Lore from the 5etools data
#   ./admin.sh update                fetch the newest Aurora Legacy and 5etools content and import what changed
set -euo pipefail
cd "$(dirname "$0")"
[ -f .env ] || { echo "no .env here: run ./setup.sh first" >&2; exit 1; }
KEY=$(grep -E '^STARLIGHTS_ADMIN_KEY=' .env | cut -d= -f2-)
PORT=$(grep -E '^STARLIGHTS_PORT=' .env | cut -d= -f2-)
BASE="${STARLIGHTS_API:-http://localhost:${PORT:-8093}/api}"

import() {
  local replace=false update=false
  case "${2:-}" in --replace) replace=true ;; --update) update=true ;; esac
  curl -fsS -X POST -H "X-Admin-Key: $KEY" -H 'Content-Type: application/json' \
    -d "{\"index\":\"$1\",\"replace\":$replace,\"update\":$update}" "$BASE/elements/import-aurora"
  echo
}

case "${1:-}" in
  init)
    if curl -fsS "$BASE/elements/compendium" | grep -q '"type":"Character Creation"'; then
      echo "already initialized" >&2; exit 0
    fi
    curl -fsS -H "X-Admin-Key: $KEY" "$BASE/elements/initialize"; echo ;;
  import) import "${2:-AuroraLegacy.index}" "${3:-}" ;;
  reprocess)
    curl -fsS -X POST -H "X-Admin-Key: $KEY" -H 'Content-Type: application/json' -d '{}' "$BASE/admin/reprocess-characters"; echo ;;
  lore)
    mkdir -p data/lore
    docker run --rm --user "$(id -u):$(id -g)" -v "$PWD/../src/frontend/apps/builder-app:/app:ro" \
      -v "$PWD/data/5etools-src:/src:ro" -v "$PWD/data/lore:/out" -w /app node:22-slim \
      node lore-ingest/ingest.ts --src /src --out /out ;;
  update)
    before=$(git -C data/aurora-elements rev-parse HEAD)
    git -C data/aurora-elements pull -q --ff-only
    [ "$before" = "$(git -C data/aurora-elements rev-parse HEAD)" ] || import AuroraLegacy.index --update
    before=$(git -C data/5etools-src rev-parse HEAD)
    # the 5etools mirror rewrites its history with each release: take the newest commit as it is
    git -C data/5etools-src fetch -q --depth 1 origin main && git -C data/5etools-src reset -q --hard FETCH_HEAD
    if [ "$before" != "$(git -C data/5etools-src rev-parse HEAD)" ]; then import 5etools --update; "$0" lore; fi
    "$0" reprocess ;;
  *) sed -n '2,11p' "$0"; exit 1 ;;
esac
