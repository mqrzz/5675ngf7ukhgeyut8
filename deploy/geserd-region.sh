#!/bin/bash
set -e
[ "$(id -u)" = 0 ] || { echo "run as root"; exit 1; }
EMAIL=$(echo "$1" | tr 'A-Z' 'a-z'); CC=$(echo "$2" | tr 'a-z' 'A-Z')
[ -n "$EMAIL" ] && [ -n "$CC" ] || { echo "usage: geserd-region you@example.com RU"; exit 1; }
cd /var/www/geserd-backend
URL=$(grep -m1 '^DATABASE_URL=' .env | cut -d= -f2-)
P=$(node -e "const r=require('./src/regions');if(!r.valid(process.argv[1])){process.exit(3)}const p=r.profile(process.argv[1]);console.log([p.country,p.region,p.data_region,p.currency].join(' '))" "$CC") || { echo "country $CC is invalid or blocked"; exit 1; }
set -- $P
N=$(psql "$URL" -tAc "update users set account_country='$1',region='$2',data_region='$3',currency='$4',onboarded_at=coalesce(onboarded_at,now()) where email='${EMAIL//\'/}' returning 1" | head -1)
[ "$N" = "1" ] && echo "ok: $EMAIL country=$1 region=$2 data_region=$3 currency=$4" || echo "no user with email $EMAIL"
