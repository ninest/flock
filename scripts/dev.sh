#!/usr/bin/env bash
# Starts Postgres (docker compose), the server, the dashboard and the playground.
# Ports and the dev database can be overridden, e.g. to run a second copy from another worktree:
#   SERVER_PORT=2200 DASHBOARD_PORT=2201 PLAYGROUND_PORT=2202 DEV_DB=flock_mybranch make dev
set -euo pipefail
cd "$(dirname "$0")/.."

# Dev servers live on ports 2000-2999. If a port is taken, use the next free one.
TAKEN=""
pick_port() { # pick_port VAR default
  local port=${!1:-$2}
  while ss -Hltn "sport = :$port" | grep -q . || [[ " $TAKEN " == *" $port "* ]]; do
    echo "Port $port is in use; trying $((port + 1))." >&2
    port=$((port + 1))
  done
  TAKEN="$TAKEN $port"
  printf -v "$1" '%s' "$port"
}
pick_port SERVER_PORT 2100
pick_port DASHBOARD_PORT 2101
pick_port PLAYGROUND_PORT 2102
DEV_DB=${DEV_DB:-flock}
HOST=${DEV_HOST:-hel}

# One shared Postgres for every worktree; reuse it if it is already running.
if ! docker ps --format '{{.Names}}' | grep -qx flock-postgres; then
  docker compose up -d --wait postgres
fi
docker exec flock-postgres psql -U postgres -tAc "SELECT 1 FROM pg_database WHERE datname = '$DEV_DB'" | grep -q 1 \
  || docker exec flock-postgres createdb -U postgres "$DEV_DB"

# Countries come from the bundled GeoIP database; fetch it once (ingest works without it).
[[ -f packages/server/data/dbip-country-lite.mmdb ]] || ./scripts/download-geoip.sh || true

# The server serves the built browser script at /flock.js; build it once, then keep rebuilding on change.
pnpm --filter @flock/script build

trap 'trap - EXIT; kill 0' INT TERM EXIT

# The dev Instance admin, created up front so the seeded playground Project has an owner.
FLOCK_ADMIN_EMAIL=${FLOCK_ADMIN_EMAIL:-admin@flock.test}
FLOCK_DEV_ADMIN_PASSWORD=${FLOCK_DEV_ADMIN_PASSWORD:-flock-dev-password}
export FLOCK_ADMIN_EMAIL
export BETTER_AUTH_SECRET=${BETTER_AUTH_SECRET:-flock-dev-secret-not-for-production-0000}
# Members open the dashboard via Vite, which proxies /api (and its Origin header) to the server.
export FLOCK_PUBLIC_URL=${FLOCK_PUBLIC_URL:-http://$HOST:$DASHBOARD_PORT}
export FLOCK_TRUSTED_ORIGINS=${FLOCK_TRUSTED_ORIGINS:-http://localhost:$DASHBOARD_PORT,http://$HOST:$SERVER_PORT,http://localhost:$SERVER_PORT}

export DATABASE_URL="postgres://postgres:postgres@127.0.0.1:2432/$DEV_DB"
pnpm --silent --filter @flock/server cli admin --email "$FLOCK_ADMIN_EMAIL" --password "$FLOCK_DEV_ADMIN_PASSWORD" --name Admin

pnpm --filter @flock/script dev 2>&1 | sed -u 's/^/[script]     /' &

PORT=$SERVER_PORT FLOCK_SEED_PLAYGROUND=true \
  pnpm --filter @flock/server dev 2>&1 | sed -u 's/^/[server]     /' &
FLOCK_SERVER_URL="http://localhost:$SERVER_PORT" PORT=$DASHBOARD_PORT \
  pnpm --filter @flock/dashboard dev 2>&1 | sed -u 's/^/[dashboard]  /' &
FLOCK_SERVER_PORT=$SERVER_PORT PORT=$PLAYGROUND_PORT \
  pnpm --filter @flock/playground dev 2>&1 | sed -u 's/^/[playground] /' &

sleep 3
cat <<LINKS

  Dashboard   http://$HOST:$DASHBOARD_PORT/   (sign in as $FLOCK_ADMIN_EMAIL / $FLOCK_DEV_ADMIN_PASSWORD)
  Playground  http://$HOST:$PLAYGROUND_PORT/   (raw ingest: http://$HOST:$PLAYGROUND_PORT/ingest)
  Server      http://$HOST:$SERVER_PORT/api/docs

LINKS
wait
