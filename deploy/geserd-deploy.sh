#!/bin/bash
set -e
echo "== site";    git -C /var/www/geserd fetch -q && git -C /var/www/geserd reset --hard @{u}
echo "== cache-busting stamp (fresh URLs for every css/js/image/i18n file)"; node /var/www/geserd/tools/stamp.js
echo "== backend"; bash /var/www/geserd-backend/deploy/geserd-backend-update.sh
echo "done"
