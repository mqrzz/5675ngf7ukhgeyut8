#!/bin/bash
main(){
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
printf '#!/bin/sh\nexec bash /var/www/geserd-backend/deploy/geserd-mail-check.sh "$@"\n' > /usr/local/bin/geserd-mail-check; chmod 755 /usr/local/bin/geserd-mail-check
printf '#!/bin/sh\nexec bash /var/www/geserd-backend/deploy/geserd-mail-auth-setup.sh "$@"\n' > /usr/local/bin/geserd-mail-auth-setup; chmod 755 /usr/local/bin/geserd-mail-auth-setup
printf '#!/bin/sh\nexec bash /var/www/geserd-backend/deploy/geserd-smtp-setup.sh "$@"\n' > /usr/local/bin/geserd-smtp-setup; chmod 755 /usr/local/bin/geserd-smtp-setup
printf '#!/bin/sh\nexec bash /var/www/geserd-backend/deploy/geserd-hostname-setup.sh "$@"\n' > /usr/local/bin/geserd-hostname-setup; chmod 755 /usr/local/bin/geserd-hostname-setup
printf '#!/bin/sh\nexec bash /var/www/geserd-backend/deploy/geserd-admin.sh "$@"\n' > /usr/local/bin/geserd-admin; chmod 755 /usr/local/bin/geserd-admin
printf '#!/bin/sh\nexec bash /var/www/geserd-backend/deploy/geserd-inbound-setup.sh "$@"\n' > /usr/local/bin/geserd-inbound-setup; chmod 755 /usr/local/bin/geserd-inbound-setup
systemctl restart geserd-api
sleep 2
curl -fsS localhost:3001/api/health; echo
git log --oneline -1
}
main "$@"
exit $?
