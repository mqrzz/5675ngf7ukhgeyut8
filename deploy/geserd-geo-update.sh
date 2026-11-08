#!/bin/bash
main(){
set -e
[ "$(id -u)" = 0 ] || { echo "run as root"; exit 1; }
DIR=/var/lib/geserd/geo
mkdir -p "$DIR"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
OK=0
for OFF in 0 1 2; do
  Y=$(date -d "$(date +%Y-%m-01) -$OFF month" +%Y-%m)
  URL="https://download.db-ip.com/free/dbip-country-lite-$Y.mmdb.gz"
  if curl -fsSL --max-time 120 -o "$TMP/db.gz" "$URL"; then
    gunzip -f "$TMP/db.gz"
    SZ=$(stat -c %s "$TMP/db")
    if [ "$SZ" -gt 1000000 ]; then
      mv "$TMP/db" "$DIR/dbip-country.mmdb.new"
      mv "$DIR/dbip-country.mmdb.new" "$DIR/dbip-country.mmdb"
      chmod 644 "$DIR/dbip-country.mmdb"
      echo "geo database $Y installed ($SZ bytes)"
      OK=1
      break
    fi
  fi
done
[ "$OK" = 1 ] || { echo "could not download the geo database"; exit 1; }
printf '17 4 3 * * root /usr/local/bin/geserd-geo-update >/var/log/geserd-geo-update.log 2>&1\n' > /etc/cron.d/geserd-geo-update
chmod 644 /etc/cron.d/geserd-geo-update
sleep 1
curl -fsS "localhost:3001/api/geo?debug&ip=87.149.1.1" || true
echo
}
main "$@"
