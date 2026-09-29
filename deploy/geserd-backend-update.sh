#!/bin/bash
# Update the Geserd backend to exactly what is on GitHub. Run as root:  geserd-backend-update
# (installed by geserd-backend-setup.sh). Pulls, installs dependencies, applies schema.sql (idempotent), restarts, checks health.
set -e
DIR=/var/www/geserd-backend
[ "$(id -u)" = 0 ] || { echo "run as root"; exit 1; }
cd "$DIR"
git fetch -q
git reset --hard @{u}
npm install --omit=dev --no-audit --no-fund --silent
PGOPTIONS='-c client_min_messages=warning' psql "$(grep -m1 '^DATABASE_URL=' .env | cut -d= -f2-)" -q -v ON_ERROR_STOP=1 -f schema.sql
NODE=$(command -v node)
if ! sed "s|^ExecStart=.*|ExecStart=$NODE src/server.js|" deploy/geserd-api.service | cmp -s - /etc/systemd/system/geserd-api.service 2>/dev/null; then
  echo "== unit file changed, reinstalling"
  sed "s|^ExecStart=.*|ExecStart=$NODE src/server.js|" deploy/geserd-api.service > /etc/systemd/system/geserd-api.service
  systemctl daemon-reload
fi
systemctl restart geserd-api
sleep 2
curl -fsS localhost:3001/api/health; echo
git log --oneline -1
