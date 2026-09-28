#!/bin/bash
# One-time install of the Geserd backend on the server. Run as root:
#   bash /var/www/geserd-backend/deploy/geserd-backend-setup.sh
# The repo URL is needed only if /var/www/geserd-backend is not a git clone yet:
#   bash geserd-backend-setup.sh https://github.com/YOU/geserd-backend.git
# Safe to re-run. Never touches antviz*, the old flowgram-* units, or the databases flowgram / antviz.
set -e
cd /tmp
REPO="$1"; DIR=/var/www/geserd-backend
[ "$(id -u)" = 0 ] || { echo "run as root"; exit 1; }
[ -d "$DIR/.git" ] || [ -n "$REPO" ] || { echo "usage: bash $0 <backend-git-url>   (only needed while $DIR is not a git clone)"; exit 1; }
if ss -ltn | grep -q ':3001 ' && ! systemctl is-active -q geserd-api; then echo "!! port 3001 is already used by:"; ss -ltnp | grep ':3001 '; echo "Stop that service first (or change PORT in .env), then re-run."; exit 1; fi

echo "== system user";   id geserd >/dev/null 2>&1 || useradd --system --no-create-home --shell /usr/sbin/nologin geserd
echo "== database";      DBPASS=$(openssl rand -hex 16)
if sudo -u postgres psql -tAc "select 1 from pg_roles where rolname='geserd'" | grep -q 1; then echo "role geserd exists (password kept)"; DBPASS=""; else sudo -u postgres psql -qc "create role geserd login password '$DBPASS'"; fi
sudo -u postgres psql -tAc "select 1 from pg_database where datname='geserd'" | grep -q 1 || sudo -u postgres createdb -O geserd geserd
sudo -u postgres psql -d geserd -qc "create extension if not exists pgcrypto"
echo "== code"
if [ -d "$DIR/.git" ]; then git -C "$DIR" fetch -q && git -C "$DIR" reset --hard @{u}; else git clone "$REPO" "$DIR"; fi
echo "== .env"
if [ -f "$DIR/.env" ] && ! grep -q '^SECRET_KEY=' "$DIR/.env"; then mv "$DIR/.env" "$DIR/.env.old-flowgram"; chmod 600 "$DIR/.env.old-flowgram"; echo "old Flowgram .env kept as .env.old-flowgram"; fi
if [ ! -f "$DIR/.env" ]; then
  [ -n "$DBPASS" ] || { echo "role geserd already existed but there is no .env - write DATABASE_URL by hand in $DIR/.env"; exit 1; }
  cp "$DIR/.env.example" "$DIR/.env"
  sed -i "s|CHANGE_DB_PASSWORD|$DBPASS|; s|SECRET_KEY=CHANGE_SECRET|SECRET_KEY=$(openssl rand -hex 32)|" "$DIR/.env"
fi
chown geserd:geserd "$DIR/.env"; chmod 600 "$DIR/.env"
echo "== npm";           (cd "$DIR" && npm install --omit=dev --no-audit --no-fund --silent)
echo "== schema";        PGOPTIONS='-c client_min_messages=warning' psql "$(grep -m1 '^DATABASE_URL=' "$DIR/.env" | cut -d= -f2-)" -q -v ON_ERROR_STOP=1 -f "$DIR/schema.sql"
echo "== service"
NODE=$(command -v node); [ -n "$NODE" ] || { echo "node not found"; exit 1; }
sed "s|^ExecStart=.*|ExecStart=$NODE src/server.js|" "$DIR/deploy/geserd-api.service" > /etc/systemd/system/geserd-api.service
systemctl daemon-reload; systemctl enable --now geserd-api
echo "== commands"
# Tiny wrappers that always run the current scripts from the repo, so a later 'git reset' never leaves them stale.
printf '#!/bin/sh\nexec bash /var/www/geserd-backend/deploy/geserd-backend-update.sh "$@"\n' > /usr/local/bin/geserd-backend-update
printf '#!/bin/sh\nexec bash /var/www/geserd-backend/deploy/geserd-deploy.sh "$@"\n' > /usr/local/bin/geserd-deploy
chmod 755 /usr/local/bin/geserd-backend-update /usr/local/bin/geserd-deploy
sleep 2; curl -fsS localhost:3001/api/health && echo && echo "OK - backend is up. Update later with: geserd-backend-update"
