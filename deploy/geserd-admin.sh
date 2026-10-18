#!/bin/bash
set -e
[ "$(id -u)" = 0 ] || { echo "run as root"; exit 1; }
EMAIL=$(echo "$1" | tr 'A-Z' 'a-z'); [ -n "$EMAIL" ] || { echo "usage: geserd-admin you@example.com   (add -r to remove)"; exit 1; }
VAL=true; ROLE="'owner'"
if [ "$2" = "-r" ]; then VAL=false; ROLE=null; elif [ -n "$2" ]; then case "$2" in owner|director|admin|support) ROLE="'$2'";; *) echo "role must be owner, director, admin or support"; exit 1;; esac; fi
URL=$(grep -m1 '^DATABASE_URL=' /var/www/geserd-backend/.env | cut -d= -f2-)
N=$(psql "$URL" -tAc "update users set is_admin=$VAL,staff_role=$ROLE where email='${EMAIL//\'/}' returning 1" | head -1)
[ "$N" = "1" ] && echo "ok: $EMAIL admin=$VAL" || echo "no user with email $EMAIL (sign in once first)"
