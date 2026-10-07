#!/usr/bin/env bash
# Content admin for a Starlights install made with setup.sh (reads .env next to this script).
#
#   ./admin.sh update [--force]      bring in the newest content from the links on the Content page (Aurora Legacy,
#                                    5etools): downloads what changed, imports it, rebuilds the Compendium, updates
#                                    characters. --force downloads and rebuilds everything. Waits until it is done.
#   ./admin.sh status                what the content update is doing or last did
#   ./admin.sh import <index> [--update|--replace]
#                                    import one index again: AuroraLegacy.index, 5etools, starlights, homebrew
#   ./admin.sh reprocess             run every character through the rules again
set -euo pipefail
cd "$(dirname "$0")"
[ -f .env ] || { echo "no .env here: run ./setup.sh first" >&2; exit 1; }
KEY=$(grep -E '^STARLIGHTS_ADMIN_KEY=' .env | cut -d= -f2-)
PORT=$(grep -E '^STARLIGHTS_PORT=' .env | cut -d= -f2-)
BASE="${STARLIGHTS_API:-http://localhost:${PORT:-8093}/api}"
api() { curl -fsS -H "X-Admin-Key: $KEY" -H 'Content-Type: application/json' "$@"; }

status() {
  api "$BASE/admin/content-sources" | python3 -c '
import json, sys
j = json.load(sys.stdin)["job"]
print("\n".join(j["log"][-8:]) or "nothing has run yet")
sys.exit(3 if j["running"] else (0 if j["succeeded"] in (True, None) else 1))'
}

case "${1:-}" in
  update)
    force=false; [ "${2:-}" = "--force" ] && force=true
    api -X POST -d "{\"force\":$force}" "$BASE/admin/content-sources/update" >/dev/null
    echo -n "updating the content"
    while true; do
      sleep 5
      code=0; out=$(status 2>&1) || code=$?
      [ "$code" = 3 ] && { echo -n .; continue; }
      echo; echo "$out"; exit "$code"
    done ;;
  status) status || true ;;
  import)
    replace=false update=false
    case "${3:-}" in --replace) replace=true ;; --update) update=true ;; esac
    api -X POST -d "{\"index\":\"${2:-AuroraLegacy.index}\",\"replace\":$replace,\"update\":$update}" "$BASE/elements/import-aurora"; echo ;;
  reprocess) api -X POST -d '{}' "$BASE/admin/reprocess-characters"; echo ;;
  *) sed -n '2,12p' "$0"; exit 1 ;;
esac
