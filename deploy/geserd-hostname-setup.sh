#!/bin/bash
set -e
[ "$(id -u)" = 0 ] || { echo "run as root"; exit 1; }
ENVF=/var/www/geserd-backend/.env
BASE=$(grep -m1 '^BASE_DOMAIN=' "$ENVF" | cut -d= -f2- || true); BASE=${BASE:-geserd.com}
NAME=${1:-mail.$BASE}
IP=$(grep -m1 '^SERVER_IP=' "$ENVF" | cut -d= -f2- || true); [ -n "$IP" ] || IP=$(curl -4 -s --max-time 6 https://api.ipify.org)
command -v dig >/dev/null || DEBIAN_FRONTEND=noninteractive apt-get install -y -qq dnsutils >/dev/null
echo "== 1/4 DNS for $NAME"
A=$(dig +short A "$NAME" @1.1.1.1 | head -1)
[ "$A" = "$IP" ] || { echo "!! $NAME resolves to '${A:-nothing}', expected $IP"; echo "   Add: A  ${NAME%.$BASE}  $IP  (DNS only, no proxy), wait, run again."; exit 1; }
echo "ok: $NAME -> $A"
echo "== 2/4 Postfix outgoing HELO name (additive, backup, antviz mail keeps working)"
TS=$(date +%Y%m%d-%H%M%S)
cp -a /etc/postfix/main.cf "/etc/postfix/main.cf.geserd-helo-$TS"
postconf -e "smtp_helo_name=$NAME"
if ! postfix check; then cp -a "/etc/postfix/main.cf.geserd-helo-$TS" /etc/postfix/main.cf; echo "postfix check failed, restored"; exit 1; fi
cp /etc/hosts /var/spool/postfix/etc/hosts 2>/dev/null || true
systemctl reload postfix
echo "ok: smtp_helo_name=$(postconf -h smtp_helo_name)"
echo "== 3/4 PTR (reverse DNS) of $IP"
PTR=$(dig +short -x "$IP" | head -1 | sed 's/\.$//')
if [ "$PTR" = "$NAME" ]; then echo "ok: PTR is $PTR"; else echo "!! PTR is '${PTR:-none}', must be $NAME"; echo "   Change it in the hosting panel of the VPS (reverse DNS / PTR / rDNS for $IP), then run: geserd-mail-check you@gmail.com"; fi
echo "== 4/4 DNS records to add at your DNS provider"
cat <<OUT
 TXT  name: ${NAME%.$BASE}   value: v=spf1 ip4:$IP -all
 TXT  name: @                value: v=spf1 ip4:$IP ~all      (keep what you already have)
OUT
echo "Backup: /etc/postfix/main.cf.geserd-helo-$TS"
