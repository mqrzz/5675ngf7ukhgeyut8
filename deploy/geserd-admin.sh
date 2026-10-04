#!/bin/bash
set -e
[ "$(id -u)" = 0 ] || { echo "run as root"; exit 1; }
EMAIL=$(echo "$1" | tr 'A-Z' 'a-z'); [ -n "$EMAIL" ] || { echo "usage: geserd-admin you@example.com   (add -r to remove)"; exit 1; }
VAL=true; [ "$2" = "-r" ] && VAL=false
URL=$(grep -m1 '^DATABASE_URL=' /var/www/geserd-backend/.env | cut -d= -f2-)
N=$(psql "$URL" -tAc "update users set is_admin=$VAL where email='${EMAIL//\'/}' returning 1" | head -1)
[ "$N" = "1" ] && echo "ok: $EMAIL admin=$VAL" || echo "no user with email $EMAIL (sign in once first)"
