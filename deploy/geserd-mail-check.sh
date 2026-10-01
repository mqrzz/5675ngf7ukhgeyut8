#!/bin/bash
# Diagnose why sign-in code emails do not arrive.   Run as root:  geserd-mail-check you@example.com
# Read-only except for sending ONE test message to the address you pass. Prints a short verdict per check.
TO="$1"; [ -n "$TO" ] || { echo "usage: geserd-mail-check you@example.com"; exit 1; }
[ "$(id -u)" = 0 ] || { echo "run as root"; exit 1; }
ENVF=/var/www/geserd-backend/.env
FROM=$(grep -m1 '^FROM_EMAIL=' $ENVF | cut -d= -f2-); MH=$(grep -m1 '^MAIL_HOST=' $ENVF | cut -d= -f2-)
ok(){ echo "  [ok]   $*"; }; bad(){ echo "  [FAIL] $*"; }
echo "1) systemd unit (NoNewPrivileges blocks Postfix's postdrop)"
if systemctl cat geserd-api 2>/dev/null | grep -q '^NoNewPrivileges=true'; then bad "installed unit still has NoNewPrivileges=true -> run geserd-backend-update"; else ok "no NoNewPrivileges in the installed unit"; fi
echo "2) .env sender: FROM_EMAIL=$FROM MAIL_HOST=$MH"
case "$FROM" in *antviz*) bad "FROM_EMAIL still points to antviz — edit $ENVF, then: systemctl restart geserd-api";; *) ok "sender is not antviz";; esac
echo "3) Postfix"
systemctl is-active --quiet postfix && ok "postfix is running" || bad "postfix is not running"
postfix check 2>&1 | head -3 | sed 's/^/         /'
echo "4) send as the service user, exactly like the API does"
BEFORE=$(date +%s)
printf 'From: %s\nTo: %s\nSubject: Geserd mail check\n\nIf you read this, Postfix can send as the geserd user.\n' "$FROM" "$TO" | sudo -u geserd /usr/sbin/sendmail -f "$FROM" "$TO" && ok "sendmail accepted the message (exit 0)" || bad "sendmail as user geserd failed (see the error above)"
sleep 4
echo "5) queue (should be empty; deferred items show the reason)"
postqueue -p | tail -15 | sed 's/^/         /'
echo "6) last mail log lines for this recipient"
grep -h "$TO" /var/log/mail.log 2>/dev/null | tail -6 | sed 's/^/         /' || true
journalctl -u postfix --since "-2min" --no-pager 2>/dev/null | grep -i "$TO" | tail -4 | sed 's/^/         /'
echo "7) API log (last mail errors)"
journalctl -u geserd-api -n 200 --no-pager 2>/dev/null | grep -i "mail send failed" -A3 | tail -8 | sed 's/^/         /'
echo "8) DNS for $(echo "$FROM" | cut -d@ -f2) as the world sees it (Gmail needs SPF or DKIM to pass; DMARC recommended)"
D=$(echo "$FROM" | cut -d@ -f2); q(){ dig +short TXT "$1" 2>/dev/null | tr -d '"' | head -3; }
command -v dig >/dev/null || { echo "  (install dig: apt-get install -y dnsutils)"; }
SPF=$(q $D | grep -i 'v=spf1'); [ -n "$SPF" ] && ok "SPF: $SPF" || bad "no SPF TXT record on $D"
DK=$(q mail._domainkey.$D | grep -i 'v=DKIM1'); [ -n "$DK" ] && ok "DKIM record mail._domainkey.$D exists" || bad "no DKIM record mail._domainkey.$D  -> run geserd-mail-auth-setup and add the printed records"
DM=$(q _dmarc.$D | grep -i 'v=DMARC1'); [ -n "$DM" ] && ok "DMARC: $DM" || bad "no DMARC record _dmarc.$D"
systemctl is-active --quiet opendkim && ok "opendkim is running" || bad "opendkim is not running -> run geserd-mail-auth-setup"
echo
echo "Reading the result: status=sent in step 6 but no email in the inbox = the recipient rejected/spam-filtered it. Check the spam folder, then"
echo "SPF (TXT on geserd.com), DKIM signing for geserd.com in OpenDKIM, DMARC and the PTR of the server IP. status=deferred/bounced shows the exact reason."
