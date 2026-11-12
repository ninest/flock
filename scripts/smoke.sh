#!/usr/bin/env bash
# Smoke test a running Instance from the outside, over HTTP only.
#   scripts/smoke.sh http://localhost:2100 [ingest key]
# Waits up to 60 s for /api/health, then checks the dashboard and, given an
# Environment key, that a Pageview is accepted. Used by CI against the Docker
# image, the compose file and the previous release's image.
set -euo pipefail
base="${1:?usage: smoke.sh BASE_URL [KEY]}"
key="${2:-}"

for _ in $(seq 60); do
  curl -fsS "$base/api/health" >/dev/null 2>&1 && break
  sleep 1
done
health="$(curl -fsS "$base/api/health")"
[[ "$health" == '{"status":"ok"}' ]] || { echo "health: unexpected body: $health"; exit 1; }
echo "ok: /api/health"

curl -fsS -H 'accept: text/html' "$base/" | grep -q '<div id="root">' || { echo "dashboard: index.html not served"; exit 1; }
echo "ok: dashboard"

curl -fsS "$base/api/openapi.json" | grep -q '"/api/ingest"' || { echo "openapi: /api/ingest missing"; exit 1; }
echo "ok: /api/openapi.json"

if [[ -n "$key" ]]; then
  uuid="$(cat /proc/sys/kernel/random/uuid)"
  body="{\"key\":\"$key\",\"events\":[{\"uuid\":\"$uuid\",\"name\":\"\$pageview\",\"properties\":{\"\$url\":\"https://smoke.test/\"}}]}"
  result="$(curl -fsS -X POST -H 'content-type: application/json' --data "$body" "$base/api/ingest")"
  echo "$result" | grep -q '"accepted":1' || { echo "ingest: unexpected result: $result"; exit 1; }
  echo "ok: ingest"
fi
