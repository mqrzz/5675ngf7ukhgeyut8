#!/bin/bash
# Makes mail from geserd.com pass SPF + DKIM + DMARC (Gmail rejects it otherwise: "550 5.7.26 sender is unauthenticated").
# Safe to re-run. Additive: it never removes existing OpenDKIM/Postfix settings (the server may also sign mail for other domains).
# Usage (as root):  geserd-mail-auth-setup            -> installs/configures OpenDKIM, prints the DNS records to add
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "run as root"; exit 1; }
DOMAIN=geserd.com; SEL=mail; IP=$(grep -m1 '^MAIL_IP=' /var/www/geserd-backend/.env 2>/dev/null | cut -d= -f2- || true)
[ -n "$IP" ] || IP=$(curl -4 -s --max-time 6 https://api.ipify.org || true)
KDIR=/etc/opendkim/keys/$DOMAIN
echo "== 1/5 packages"
dpkg -s opendkim >/dev/null 2>&1 && dpkg -s opendkim-tools >/dev/null 2>&1 || { DEBIAN_FRONTEND=noninteractive apt-get update -qq; DEBIAN_FRONTEND=noninteractive apt-get install -y -qq opendkim opendkim-tools; }
echo "== 2/5 key for $DOMAIN (selector $SEL)"
mkdir -p "$KDIR"
[ -f "$KDIR/$SEL.private" ] || opendkim-genkey -b 2048 -d "$DOMAIN" -D "$KDIR" -s "$SEL"
chown -R opendkim:opendkim /etc/opendkim; chmod 700 "$KDIR"; chmod 600 "$KDIR/$SEL.private"
echo "== 3/5 OpenDKIM tables (additive)"
CONF=/etc/opendkim.conf
KT=$(awk '/^KeyTable/{print $2}' $CONF 2>/dev/null | sed 's/^refile://' | head -1); ST=$(awk '/^SigningTable/{print $2}' $CONF 2>/dev/null | sed 's/^refile://' | head -1)
if [ -z "$KT" ] || [ -z "$ST" ]; then
  KT=/etc/opendkim/KeyTable; ST=/etc/opendkim/SigningTable
  cp -a $CONF ${CONF}.bak.$(date +%s) 2>/dev/null || true
  cat >> $CONF <<CFG

# --- added by geserd-mail-auth-setup ---
Syslog yes
UMask 007
Mode sv
Canonicalization relaxed/simple
KeyTable refile:$KT
SigningTable refile:$ST
Socket inet:8891@localhost
PidFile /run/opendkim/opendkim.pid
UserID opendkim
CFG
fi
touch "$KT" "$ST"
grep -q "^$SEL._domainkey.$DOMAIN " "$KT" || echo "$SEL._domainkey.$DOMAIN $DOMAIN:$SEL:$KDIR/$SEL.private" >> "$KT"
grep -q "^\*@$DOMAIN " "$ST" || echo "*@$DOMAIN $SEL._domainkey.$DOMAIN" >> "$ST"
grep -q "^\*@\*.$DOMAIN " "$ST" || echo "*@*.$DOMAIN $SEL._domainkey.$DOMAIN" >> "$ST"   # sub-domains (users without their own domain) are signed with the parent key
chown opendkim:opendkim "$KT" "$ST"
SOCK=$(awk '/^Socket/{print $2}' $CONF | tail -1)
echo "== 4/5 Postfix milter ($SOCK)"
case "$SOCK" in inet:*@*) MIL=$(echo "$SOCK" | sed 's/^inet:\([0-9]*\)@\(.*\)$/inet:\2:\1/');; local:*) MIL="unix:${SOCK#local:}";; *) MIL="$SOCK";; esac
for k in smtpd_milters non_smtpd_milters; do
  cur=$(postconf -h $k); case "$cur" in *"$MIL"*) ;; "") postconf -e "$k=$MIL";; *) postconf -e "$k=$cur, $MIL";; esac
done
postconf -e "milter_default_action=accept" "milter_protocol=6"
echo "== 5/5 restart"
systemctl enable opendkim >/dev/null 2>&1 || true
systemctl restart opendkim; sleep 1; systemctl reload postfix
systemctl is-active --quiet opendkim && echo "opendkim: running" || { echo "opendkim failed:"; journalctl -u opendkim -n 15 --no-pager; exit 1; }
PUB=$(tr -d '\n\t "' < "$KDIR/$SEL.txt" | sed 's/.*(\(v=DKIM1[^)]*\)).*/\1/')
cat <<OUT

=============================================================================
 ADD THESE 4 DNS RECORDS for $DOMAIN (Cloudflare / your DNS panel), then wait 5-15 minutes:
=============================================================================
 1) SPF      TXT  name: @                        value: v=spf1 ip4:$IP ~all
 2) DKIM     TXT  name: $SEL._domainkey            value: $PUB
 3) DMARC    TXT  name: _dmarc                    value: v=DMARC1; p=none; adkim=r; aspf=r; rua=mailto:postmaster@$DOMAIN
 4) SPF for user sub-domains (optional, later)  TXT  name: *   value: v=spf1 ip4:$IP ~all
 Also make sure the PTR (reverse DNS) of $IP is mail.$DOMAIN — that is set in the hosting panel, not in DNS.
 (If a TXT value is longer than 255 chars your DNS panel may ask you to split it; Cloudflare does it automatically.)
 Check afterwards with:  geserd-mail-check your@gmail.com
=============================================================================
OUT
