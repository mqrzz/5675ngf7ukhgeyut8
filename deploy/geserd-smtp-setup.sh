#!/bin/bash
set -e
[ "$(id -u)" = 0 ] || { echo "run as root"; exit 1; }
DIR=/var/www/geserd-backend
ENVF=$DIR/.env
[ -f "$ENVF" ] || { echo "missing $ENVF"; exit 1; }
BASE=$(grep -m1 '^BASE_DOMAIN=' "$ENVF" | cut -d= -f2- || true); BASE=${BASE:-geserd.com}
HOST=smtp.$BASE
EMAIL=${1:-$(grep -m1 '^CONTACT_TO=' "$ENVF" | cut -d= -f2- || true)}
setenv(){ if grep -q "^$1=" "$ENVF"; then sed -i "s|^$1=.*|$1=$2|" "$ENVF"; else echo "$1=$2" >> "$ENVF"; fi; }
echo "== 1/6 DNS check for $HOST"
IP=$(grep -m1 '^SERVER_IP=' "$ENVF" | cut -d= -f2- || true); [ -n "$IP" ] || IP=$(curl -4 -s --max-time 6 https://api.ipify.org || true)
command -v dig >/dev/null || DEBIAN_FRONTEND=noninteractive apt-get install -y -qq dnsutils >/dev/null
A=$(dig +short A "$HOST" @1.1.1.1 | head -1)
if [ "$A" != "$IP" ]; then echo "!! $HOST resolves to '${A:-nothing}', expected $IP"; echo "   Add the DNS record: A  smtp  $IP  (DNS only, no proxy), wait a few minutes, run again."; exit 1; fi
echo "ok: $HOST -> $A"
echo "== 2/6 ports 465 and 587"
for P in 465 587; do
  U=$(ss -ltnpH "sport = :$P" 2>/dev/null | grep -v 'node' || true)
  if [ -n "$U" ]; then echo "!! port $P is already used by another program:"; echo "$U"; echo "   Tell me this output, I will move Geserd SMTP to other ports."; exit 1; fi
done
echo "ok: both ports are free"
echo "== 3/6 certificate for $HOST"
command -v certbot >/dev/null || DEBIAN_FRONTEND=noninteractive apt-get install -y -qq certbot >/dev/null
if [ ! -d /etc/letsencrypt/live/$HOST ]; then
  [ -n "$EMAIL" ] || { echo "usage: geserd-smtp-setup you@example.com"; exit 1; }
  certbot certonly --standalone --preferred-challenges http -d "$HOST" -m "$EMAIL" --agree-tos --no-eff-email -n --pre-hook "systemctl stop nginx" --post-hook "systemctl start nginx"
fi
mkdir -p /etc/geserd/tls
cat > /etc/letsencrypt/renewal-hooks/deploy/geserd-smtp.sh <<HOOK
#!/bin/sh
install -m 640 -o root -g geserd /etc/letsencrypt/live/$HOST/privkey.pem /etc/geserd/tls/smtp.key
install -m 644 -o root -g geserd /etc/letsencrypt/live/$HOST/fullchain.pem /etc/geserd/tls/smtp.crt
HOOK
chmod 755 /etc/letsencrypt/renewal-hooks/deploy/geserd-smtp.sh
RENEWED_LINEAGE=/etc/letsencrypt/live/$HOST sh /etc/letsencrypt/renewal-hooks/deploy/geserd-smtp.sh
echo "== 4/6 firewall"
if command -v ufw >/dev/null && ufw status | grep -q "Status: active"; then ufw allow 465/tcp >/dev/null; ufw allow 587/tcp >/dev/null; echo "ufw: 465, 587 opened"; else echo "ufw is not active, nothing to open"; fi
echo "== 5/6 SpamAssassin (outgoing spam score)"
if ! dpkg -s spamassassin >/dev/null 2>&1; then DEBIAN_FRONTEND=noninteractive apt-get install -y -qq spamassassin spamc >/dev/null; fi
sed -i 's/^ENABLED=.*/ENABLED=1/; s/^CRON=.*/CRON=1/' /etc/default/spamassassin 2>/dev/null || true
mkdir -p /etc/systemd/system/spamd.service.d /etc/systemd/system/spamassassin.service.d
SVC=spamd; systemctl cat spamd >/dev/null 2>&1 || SVC=spamassassin
cat > /etc/systemd/system/$SVC.service.d/geserd.conf <<'DROP'
[Service]
ExecStart=
ExecStart=/usr/sbin/spamd --max-children 1 --min-children 1 --listen 127.0.0.1 --port 783 --allowed-ips 127.0.0.1 --nouser-config --syslog /dev/log --pidfile /run/spamd.pid
MemoryMax=300M
Nice=10
DROP
sa-update >/dev/null 2>&1 || true
systemctl daemon-reload
systemctl enable "$SVC" >/dev/null 2>&1 || true
systemctl restart "$SVC"
sleep 3
systemctl is-active --quiet "$SVC" && echo "spamd: running" || { journalctl -u "$SVC" -n 15 --no-pager; exit 1; }
echo "== 6/6 Geserd settings"
setenv SMTP_TLS_KEY /etc/geserd/tls/smtp.key
setenv SMTP_TLS_CERT /etc/geserd/tls/smtp.crt
setenv SMTP_HOSTNAME "$HOST"
setenv SPAMD_HOST 127.0.0.1
setenv SPAMD_PORT 783
bash $DIR/deploy/geserd-backend-update.sh
sleep 2
journalctl -u geserd-api --since "-1min" --no-pager | grep -i "smtp" | tail -5
echo
echo "check from your computer:  openssl s_client -connect $HOST:465 -quiet </dev/null   and   curl -s https://$BASE/api/smtp"
