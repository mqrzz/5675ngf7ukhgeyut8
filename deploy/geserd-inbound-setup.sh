#!/bin/bash
set -e
[ "$(id -u)" = 0 ] || { echo "run as root"; exit 1; }
ENVF=/var/www/geserd-backend/.env
[ -f "$ENVF" ] || { echo "missing $ENVF"; exit 1; }
BASE=$(grep -m1 '^BASE_DOMAIN=' "$ENVF" | cut -d= -f2- || true); BASE=${BASE:-geserd.com}
eval "$(node -e '
const u=new URL(process.argv[1]);
const q=s=>"\x27"+String(s).replace(/\x27/g,"\x27\\\x27\x27")+"\x27";
console.log("PGU="+q(decodeURIComponent(u.username))+"; PGP="+q(decodeURIComponent(u.password))+"; PGH="+q(u.hostname||"127.0.0.1")+"; PGD="+q(u.pathname.slice(1)));
' "$(grep -m1 '^DATABASE_URL=' "$ENVF" | cut -d= -f2-)")"
echo "== postfix-pgsql"
DEBIAN_FRONTEND=noninteractive apt-get install -y -qq postfix-pgsql >/dev/null
TS=$(date +%Y%m%d-%H%M%S)
cp -a /etc/postfix/main.cf "/etc/postfix/main.cf.geserd-$TS"
write_cf(){
  umask 027
  cat > "$1" <<CF
hosts = $PGH
user = $PGU
password = $PGP
dbname = $PGD
query = SELECT '$2' FROM domains WHERE name = '%s' AND status = 'verified' AND receiving_ok UNION SELECT '$2' FROM subdomains WHERE slug || '.$BASE' = '%s'
CF
  chown root:postfix "$1"; chmod 640 "$1"
}
write_cf /etc/postfix/geserd-relay-domains.cf OK
write_cf /etc/postfix/geserd-transport.cf 'smtp:[127.0.0.1]:2525'
add_map(){
  local key=$1 map=$2 cur
  cur=$(postconf -h "$key")
  case "$cur" in *"$map"*) ;; "") postconf -e "$key=$map";; *) postconf -e "$key=$cur, $map";; esac
}
add_map relay_domains pgsql:/etc/postfix/geserd-relay-domains.cf
add_map transport_maps pgsql:/etc/postfix/geserd-transport.cf
if ! postfix check; then
  echo "postfix check failed, restoring main.cf"
  cp -a "/etc/postfix/main.cf.geserd-$TS" /etc/postfix/main.cf
  exit 1
fi
echo "== lookup test (a verified receiving domain or claimed subdomain should print a value, others print nothing)"
for d in "$BASE" nonexistent-test-domain.invalid; do printf '%s -> ' "$d"; postmap -q "$d" pgsql:/etc/postfix/geserd-transport.cf || true; echo; done
systemctl reload postfix
echo "== done. Postfix now hands mail for verified receiving domains and claimed *.$BASE subdomains to 127.0.0.1:2525 (Geserd inbound). Antviz mail is untouched."
echo "Backup of main.cf: /etc/postfix/main.cf.geserd-$TS"
