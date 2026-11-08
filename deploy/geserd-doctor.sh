#!/bin/bash
main(){
DIR=/var/www/geserd-backend
cd "$DIR" 2>/dev/null || { echo "no $DIR"; exit 1; }
echo "== code"; git log --oneline -1; git status -s | head -5
echo "== node"; node -v
URL=$(grep -m1 '^DATABASE_URL=' .env | cut -d= -f2-)
echo "== database"
for T in users emails newsletter_subs contact_messages; do
  R=$(psql "$URL" -tAc "select to_regclass('public.$T') is not null" 2>&1 | head -1)
  echo "  table $T: $R"
done
echo "== service"; systemctl is-active geserd-api; systemctl status geserd-api --no-pager -n 0 | head -4
echo "== health"; curl -sS -m 5 localhost:3001/api/health; echo
echo "== geo database"; ls -la /var/lib/geserd/geo/ 2>&1 | head -3
echo "== last 40 log lines"; journalctl -u geserd-api -n 40 --no-pager 2>&1 | cut -c1-220
echo "== frontend"; F=/var/www/geserd; cd "$F" 2>/dev/null && { git log --oneline -1; for f in css/security.css js/askai.js js/pages/newsletter.js; do [ -f "$f" ] && echo "  ok  $f" || echo "  MISSING $f"; done; grep -c lifewin css/home2.css | sed 's/^/  lifewin rules in home2.css: /'; }
}
main "$@"
exit $?
