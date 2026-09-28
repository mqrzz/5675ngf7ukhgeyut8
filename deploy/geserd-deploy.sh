#!/bin/bash
# Update site AND backend to what is on GitHub:  geserd-deploy
set -e
echo "== site";    git -C /var/www/geserd fetch -q && git -C /var/www/geserd reset --hard @{u}
echo "== backend"; bash /var/www/geserd-backend/deploy/geserd-backend-update.sh
echo "done"
