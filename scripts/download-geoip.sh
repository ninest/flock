#!/bin/sh
# Downloads DB-IP's free "IP to Country Lite" database (CC BY 4.0, about 8 MB) to the given
# path, default packages/server/data/dbip-country-lite.mmdb. DB-IP publishes it monthly;
# early in a month the new file may not exist yet, so this falls back to last month's.
# Used by `make dev` and the Docker build. POSIX sh, so it runs on Alpine (busybox wget).
set -eu
cd "$(dirname "$0")/.."
OUT=${1:-packages/server/data/dbip-country-lite.mmdb}
mkdir -p "$(dirname "$OUT")"

this_month=$(date -u +%Y-%m)
# The 1st of this month minus one day is in last month (busybox and GNU date both take @epoch).
first=$(date -u -d "$(date -u +%Y-%m-01)" +%s 2>/dev/null || date -u -j -f %Y-%m-%d "$(date -u +%Y-%m-01)" +%s)
last_month=$(date -u -d "@$((first - 86400))" +%Y-%m 2>/dev/null || date -u -r "$((first - 86400))" +%Y-%m)

for month in "$this_month" "$last_month"; do
  url="https://download.db-ip.com/free/dbip-country-lite-$month.mmdb.gz"
  if wget -q -O "$OUT.gz" "$url" 2>/dev/null || curl -fsSL -o "$OUT.gz" "$url" 2>/dev/null; then
    gunzip -f "$OUT.gz"
    echo "GeoIP database $month written to $OUT"
    exit 0
  fi
  rm -f "$OUT.gz"
done
echo "Could not download the DB-IP country database" >&2
exit 1
