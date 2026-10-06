#!/usr/bin/env bash
# Sets up Starlights (aurora-server) on this machine with Docker. Safe to run again: it skips what is done.
#   1. writes .env with random passwords (once)
#   2. fetches the content into ./data: Aurora Legacy's elements and the 5etools data (both public GitHub repositories)
#   3. builds and starts the containers (database, API, web app)
#   4. imports the content and builds the Compendium of Lore
# Needs: Docker with the compose plugin, git, curl, openssl. About 3 GB of disk; the first build takes a while.
set -euo pipefail
cd "$(dirname "$0")"
for tool in docker git curl openssl; do command -v "$tool" >/dev/null || { echo "please install $tool first" >&2; exit 1; }; done

if [ ! -f .env ]; then
  sa="Sl$(openssl rand -hex 12)9"
  master=$(openssl rand -base64 12 | tr -d '/+=')
  sed -e "s/^STARLIGHTS_SA_PASSWORD=.*/STARLIGHTS_SA_PASSWORD=$sa/" \
      -e "s/^STARLIGHTS_ADMIN_KEY=.*/STARLIGHTS_ADMIN_KEY=$(openssl rand -hex 24)/" \
      -e "s/^STARLIGHTS_MASTER_PASSWORD=.*/STARLIGHTS_MASTER_PASSWORD=$master/" .env.example > .env
  chmod 600 .env
  echo "wrote .env (your admin password is in it: STARLIGHTS_MASTER_PASSWORD)"
fi

mkdir -p data/portraits data/homebrew data/aurora-sheets data/art data/lore data/mssql
[ -d data/aurora-elements/.git ] || git clone -q --depth 1 https://github.com/AuroraLegacy/elements.git data/aurora-elements
[ -d data/5etools-src/.git ] || git clone -q --depth 1 https://github.com/5etools-mirror-3/5etools-src.git data/5etools-src
# the API runs as user 1654 and SQL Server as 10001: give them their folders
docker run --rm -v "$PWD/data:/d" alpine sh -c 'chown -R 1654:1654 /d/portraits /d/homebrew && chown -R 10001:0 /d/mssql'

docker compose build -q
docker compose up -d
port=$(grep -E '^STARLIGHTS_PORT=' .env | cut -d= -f2-)
echo -n "waiting for the API"
until curl -fsS "http://localhost:${port:-8093}/api/characters/creation-options" >/dev/null 2>&1; do echo -n .; sleep 3; done
echo

./admin.sh init
./admin.sh import AuroraLegacy.index
./admin.sh import 5etools
./admin.sh import starlights
./admin.sh lore
echo "Starlights is running on http://localhost:${port:-8093}"
echo "Admin password (key button in the header): $(grep -E '^STARLIGHTS_MASTER_PASSWORD=' .env | cut -d= -f2-)"
