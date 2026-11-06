#!/bin/bash
main(){
set -e
[ "$(id -u)" = 0 ] || { echo "run as root"; exit 1; }
WEB=/var/www/geserd
SN=/etc/nginx/snippets
TS=$(date +%Y%m%d-%H%M%S)
nginx -V 2>&1 | grep -q http_auth_request_module || { echo "nginx has no auth_request module"; exit 1; }
curl -fsS --max-time 4 localhost:3001/api/geo >/dev/null || { echo "backend /api/geo does not answer, run geserd-backend-update first"; exit 1; }
SITE=$(grep -lE 'server_name[^;]*[[:space:]]geserd\.com' /etc/nginx/sites-enabled/* /etc/nginx/conf.d/*.conf 2>/dev/null | head -1 || true)
[ -n "$SITE" ] || { echo "nginx site for geserd.com not found"; exit 1; }
SITE=$(readlink -f "$SITE")
echo "== 1/4 snippets"
mkdir -p "$SN"
cat > "$SN/geserd-geo.conf" <<'EOC'
location = /_geo {
 internal;
 proxy_pass http://127.0.0.1:3001/api/geo/check;
 proxy_pass_request_body off;
 proxy_set_header Content-Length "";
 proxy_set_header Host $host;
 proxy_set_header X-Forwarded-For $remote_addr;
 proxy_connect_timeout 1s;
 proxy_read_timeout 2s;
 error_page 500 502 503 504 = @geo_open;
}
location @geo_open {
 return 204;
}
location @geo_blocked {
 root /var/www/geserd;
 rewrite ^ /unavailable/index.html break;
 add_header Cache-Control "no-store" always;
}
location ~ ^/(unavailable|countries|unsubscribe|assets|css|js|i18n)(/|$) {
 auth_request off;
 root /var/www/geserd;
 try_files $uri $uri/index.html =404;
}
EOC
cat > "$SN/geserd-geo-gate.conf" <<'EOC'
auth_request /_geo;
error_page 403 =451 @geo_blocked;
EOC
echo "== 2/4 patch $SITE (backup first)"
cp -a "$SITE" "$SITE.geserd-geo-$TS"
python3 - "$SITE" <<'EOP'
import re,sys
p=sys.argv[1]
s=open(p).read()
if 'snippets/geserd-geo.conf' in s:
    print('already patched');sys.exit(0)
out=[];i=0;n=len(s);patched=0
def block_end(s,start):
    d=0
    for j in range(start,len(s)):
        if s[j]=='{':d+=1
        elif s[j]=='}':
            d-=1
            if d==0:return j
    return -1
res='';pos=0
for m in re.finditer(r'\bserver\s*\{',s):
    if m.start()<pos:continue
    e=block_end(s,m.end()-1)
    b=s[m.start():e+1]
    if re.search(r'server_name[^;]*\bgeserd\.com\b',b) and re.search(r'listen\s+[^;]*443',b):
        b=re.sub(r'(server_name[^;]*;)',r'\1\n    include snippets/geserd-geo.conf;',b,count=1)
        b=re.sub(r'(location\s+/\s*\{)',r'\1\n        include snippets/geserd-geo-gate.conf;',b,count=1)
        patched+=1
    res+=s[pos:m.start()]+b;pos=e+1
res+=s[pos:]
if not patched:
    print('no 443 server block for geserd.com');sys.exit(2)
open(p,'w').write(res)
print('patched blocks:',patched)
EOP
echo "== 3/4 nginx -t"
if ! nginx -t; then cp -a "$SITE.geserd-geo-$TS" "$SITE"; echo "nginx -t failed, restored $SITE"; exit 1; fi
systemctl reload nginx
echo "== 4/4 checks"
nginx -T 2>/dev/null | grep -q 'proxy_set_header X-Forwarded-For' || echo "!! /api/ proxy does not set X-Forwarded-For, add it to location /api/"
CODE=$(curl -s -o /dev/null -w '%{http_code}' https://geserd.com/ || true)
echo "https://geserd.com/ -> $CODE"
echo "own country: $(curl -s https://geserd.com/api/geo)"
echo "probe IN:    $(curl -s 'https://geserd.com/api/geo?ip=1.186.0.1')"
echo "Backup: $SITE.geserd-geo-$TS"
}
main "$@"
exit $?
