#!/bin/bash
set -e
[ "$(id -u)" = 0 ] || { echo "run as root"; exit 1; }
cd /var/www/geserd-backend
URL=$(grep -m1 '^DATABASE_URL=' .env | cut -d= -f2-)
KEY=$(grep -m1 '^SECRET_KEY=' .env | cut -d= -f2-)
CMD="$1"
case "$CMD" in
 add)
  DOMAIN=$(echo "$2" | tr 'A-Z' 'a-z'); ISSUER="${3%/}"; CID="$4"; CSEC="$5"
  [ -n "$DOMAIN" ] && [ -n "$ISSUER" ] && [ -n "$CID" ] && [ -n "$CSEC" ] || { echo "usage: geserd-sso add corp.com https://login.example.com client_id client_secret"; exit 1; }
  case "$ISSUER" in https://*) ;; *) echo "issuer must start with https://"; exit 1;; esac
  ENC=$(SECRET_KEY="$KEY" node -e "console.log(require('./src/secret').enc(process.argv[1]))" "$CSEC")
  node -e "fetch(process.argv[1]+'/.well-known/openid-configuration').then(r=>r.json()).then(d=>{if(!d.authorization_endpoint||!d.token_endpoint||!d.jwks_uri)throw 0;console.log('discovery ok: '+d.issuer)}).catch(()=>{console.log('warning: discovery failed for this issuer, check the address');})" "$ISSUER"
  psql "$URL" -v d="$DOMAIN" -v i="$ISSUER" -v c="$CID" -v e="$ENC" -c "insert into sso_connections(domain,issuer,client_id,client_secret_enc) values(:'d',:'i',:'c',:'e') on conflict(domain) do update set issuer=:'i',client_id=:'c',client_secret_enc=:'e',enabled=true" >/dev/null
  echo "ok: $DOMAIN -> $ISSUER"
  echo "redirect URI to register at the provider: ${APP_URL:-https://geserd.com}/api/auth/sso/callback";;
 list) psql "$URL" -c "select domain,issuer,client_id,enabled,created_at from sso_connections order by domain";;
 disable) psql "$URL" -v d="$(echo "$2" | tr 'A-Z' 'a-z')" -c "update sso_connections set enabled=false where domain=:'d'";;
 enable) psql "$URL" -v d="$(echo "$2" | tr 'A-Z' 'a-z')" -c "update sso_connections set enabled=true where domain=:'d'";;
 remove) psql "$URL" -v d="$(echo "$2" | tr 'A-Z' 'a-z')" -c "delete from sso_connections where domain=:'d'";;
 *) echo "usage: geserd-sso add|list|disable|enable|remove ..."; exit 1;;
esac
