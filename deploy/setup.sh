#!/usr/bin/env bash
# Sets up Starlights (aurora-server) on this machine with Docker. Safe to run again: it skips what is done.
#   1. writes .env with random passwords (once)
#   2. builds and starts the containers (database, API, web app)
#   3. has the app download Aurora Legacy's elements and the 5etools data from GitHub, import them and build the
#      Compendium of Lore (the links are on the app's Content page; change them there)
# Needs: Docker with the compose plugin, curl, openssl, python3. About 3 GB of disk; the first build takes a while.
set -euo pipefail
cd "$(dirname "$0")"
for tool in docker curl openssl python3; do command -v "$tool" >/dev/null || { echo "please install $tool first" >&2; exit 1; }; done

if [ ! -f .env ]; then
  sa="Sl$(openssl rand -hex 12)9"
  master=$(openssl rand -base64 12 | tr -d '/+=')
  sed -e "s/^STARLIGHTS_SA_PASSWORD=.*/STARLIGHTS_SA_PASSWORD=$sa/" \
      -e "s/^STARLIGHTS_ADMIN_KEY=.*/STARLIGHTS_ADMIN_KEY=$(openssl rand -hex 24)/" \
      -e "s/^STARLIGHTS_MASTER_PASSWORD=.*/STARLIGHTS_MASTER_PASSWORD=$master/" .env.example > .env
  chmod 600 .env
  echo "wrote .env (your admin password is in it: STARLIGHTS_MASTER_PASSWORD)"
fi

mkdir -p data/portraits data/homebrew data/aurora-sheets data/art data/lore data/content data/mssql
# the API runs as user 1654 and SQL Server as 10001: give them their folders
docker run --rm -v "$PWD/data:/d" alpine sh -c 'chown -R 1654:1654 /d/portraits /d/homebrew /d/content /d/lore && chown -R 10001:0 /d/mssql'

STARLIGHTS_COMMIT=$(git -C .. rev-parse --short HEAD 2>/dev/null || echo unknown) docker compose build -q
docker compose up -d
port=$(grep -E '^STARLIGHTS_PORT=' .env | cut -d= -f2-)
echo -n "waiting for the API"
until curl -fsS "http://localhost:${port:-8093}/api/characters/creation-options" >/dev/null 2>&1; do echo -n .; sleep 3; done
echo

# downloads, imports and builds everything (the first time about 10 minutes)
./admin.sh update
echo "Starlights is running on http://localhost:${port:-8093}"
echo "Admin password (key button in the header): $(grep -E '^STARLIGHTS_MASTER_PASSWORD=' .env | cut -d= -f2-)"
