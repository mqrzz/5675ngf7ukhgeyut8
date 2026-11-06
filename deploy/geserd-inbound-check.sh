#!/bin/bash
ADDR="$1"; [ -n "$ADDR" ] || { echo "usage: geserd-inbound-check support@geserd.com"; exit 1; }
[ "$(id -u)" = 0 ] || { echo "run as root"; exit 1; }
ENVF=/var/www/geserd-backend/.env
ok(){ echo "  [ok]   $*"; }; bad(){ echo "  [FAIL] $*"; }
D=${ADDR#*@}
echo "1) MX of $D (must point to this server)"
command -v dig >/dev/null || apt-get install -y -qq dnsutils >/dev/null
MX=$(dig +short MX "$D" | head -3); [ -n "$MX" ] && ok "MX: $(echo $MX)" || bad "no MX record on $D"
echo "2) inbound listener on 127.0.0.1:2525"
ss -ltn 2>/dev/null | grep -q '127.0.0.1:2525' && ok "listening" || bad "nothing listens on 2525 -> systemctl restart geserd-api, journalctl -u geserd-api -n 50"
echo "3) Postfix routing for $D (must print smtp:[127.0.0.1]:2525)"
R=$(postmap -q "$D" pgsql:/etc/postfix/geserd-transport.cf 2>/dev/null)
[ -n "$R" ] && ok "transport: $R" || bad "Postfix does not hand $D to the inbound -> run geserd-backend-update, then geserd-inbound-setup"
echo "4) organization mailbox in the database"
DBU=$(grep -m1 '^DATABASE_URL=' "$ENVF" | cut -d= -f2-)
N=$(psql "$DBU" -Atc "select count(*) from org_mailboxes where address='$(echo "$ADDR" | tr A-Z a-z)'" 2>&1)
[ "$N" = "1" ] && ok "mailbox exists" || bad "mailbox not found or database error: $N"
echo "5) end-to-end: local test message through Postfix"
printf 'From: inbound-check@%s\nTo: %s\nSubject: geserd inbound check\n\nTest.\n' "$D" "$ADDR" | /usr/sbin/sendmail -f "inbound-check@$D" "$ADDR"
sleep 5
M=$(psql "$DBU" -Atc "select count(*) from org_messages m join org_mailboxes b on b.id=m.mailbox_id where b.address='$(echo "$ADDR" | tr A-Z a-z)' and m.subject='geserd inbound check'" 2>&1)
[ "${M:-0}" -ge 1 ] 2>/dev/null && ok "the test message arrived in the mailbox" || bad "test message not stored (see below)"
echo "6) mail log and queue for $ADDR"
grep -h "$ADDR" /var/log/mail.log 2>/dev/null | tail -6 | sed 's/^/         /'
postqueue -p | tail -8 | sed 's/^/         /'
journalctl -u geserd-api -n 100 --no-pager 2>/dev/null | grep -i "inbound" | tail -5 | sed 's/^/         /'
