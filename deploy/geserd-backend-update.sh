#!/bin/bash
main(){
set -e
DIR=/var/www/geserd-backend
[ "$(id -u)" = 0 ] || { echo "run as root"; exit 1; }
cd "$DIR"
echo "== 1/5 code from GitHub"
git fetch -q || { echo "!! git fetch failed: check network and that the repo has the new files pushed"; exit 1; }
git reset --hard @{u}
echo "== 2/5 packages"
npm install --omit=dev --no-audit --no-fund --silent || { echo "!! npm install failed"; exit 1; }
echo "== 3/5 database schema"
PGOPTIONS='-c client_min_messages=warning' psql "$(grep -m1 '^DATABASE_URL=' .env | cut -d= -f2-)" -q -v ON_ERROR_STOP=1 -f schema.sql || { echo "!! schema.sql failed, the service was NOT restarted. Send me the lines above."; exit 1; }
echo "== 4/5 service files and commands"
NODE=$(command -v node)
if ! sed "s|^ExecStart=.*|ExecStart=$NODE src/server.js|" deploy/geserd-api.service | cmp -s - /etc/systemd/system/geserd-api.service 2>/dev/null; then
  echo "== unit file changed, reinstalling"
  sed "s|^ExecStart=.*|ExecStart=$NODE src/server.js|" deploy/geserd-api.service > /etc/systemd/system/geserd-api.service
  systemctl daemon-reload
fi
printf '#!/bin/sh\nexec bash /var/www/geserd-backend/deploy/geserd-mail-check.sh "$@"\n' > /usr/local/bin/geserd-mail-check; chmod 755 /usr/local/bin/geserd-mail-check
printf '#!/bin/sh\nexec bash /var/www/geserd-backend/deploy/geserd-inbound-check.sh "$@"\n' > /usr/local/bin/geserd-inbound-check; chmod 755 /usr/local/bin/geserd-inbound-check
printf '#!/bin/sh\nexec bash /var/www/geserd-backend/deploy/geserd-mail-auth-setup.sh "$@"\n' > /usr/local/bin/geserd-mail-auth-setup; chmod 755 /usr/local/bin/geserd-mail-auth-setup
printf '#!/bin/sh\nexec bash /var/www/geserd-backend/deploy/geserd-smtp-setup.sh "$@"\n' > /usr/local/bin/geserd-smtp-setup; chmod 755 /usr/local/bin/geserd-smtp-setup
printf '#!/bin/sh\nexec bash /var/www/geserd-backend/deploy/geserd-hostname-setup.sh "$@"\n' > /usr/local/bin/geserd-hostname-setup; chmod 755 /usr/local/bin/geserd-hostname-setup
printf '#!/bin/sh\nexec bash /var/www/geserd-backend/deploy/geserd-admin.sh "$@"\n' > /usr/local/bin/geserd-admin; chmod 755 /usr/local/bin/geserd-admin
printf '#!/bin/sh\nexec bash /var/www/geserd-backend/deploy/geserd-inbound-setup.sh "$@"\n' > /usr/local/bin/geserd-inbound-setup; chmod 755 /usr/local/bin/geserd-inbound-setup
printf '#!/bin/sh\nexec bash /var/www/geserd-backend/deploy/geserd-geo-setup.sh "$@"\n' > /usr/local/bin/geserd-geo-setup; chmod 755 /usr/local/bin/geserd-geo-setup
printf '#!/bin/sh\nexec bash /var/www/geserd-backend/deploy/geserd-geo-update.sh "$@"\n' > /usr/local/bin/geserd-geo-update; chmod 755 /usr/local/bin/geserd-geo-update
printf '#!/bin/sh\nexec bash /var/www/geserd-backend/deploy/geserd-region.sh "$@"\n' > /usr/local/bin/geserd-region; chmod 755 /usr/local/bin/geserd-region
printf '#!/bin/sh\nexec bash /var/www/geserd-backend/deploy/geserd-sso.sh "$@"\n' > /usr/local/bin/geserd-sso; chmod 755 /usr/local/bin/geserd-sso
[ -f /var/lib/geserd/geo/dbip-country.mmdb ] || bash deploy/geserd-geo-update.sh || true
printf '#!/bin/sh\nexec bash /var/www/geserd-backend/deploy/geserd-doctor.sh "$@"\n' > /usr/local/bin/geserd-doctor; chmod 755 /usr/local/bin/geserd-doctor
echo "== 5/5 restart"
systemctl restart geserd-api
sleep 2
curl -fsS localhost:3001/api/health; echo
git log --oneline -1
}
main "$@"
exit $?
