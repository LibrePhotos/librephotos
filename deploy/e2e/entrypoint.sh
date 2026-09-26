#!/usr/bin/env bash
# Backend entrypoint for deploy/compose/docker-compose.e2e.yml: seeds the sample
# library, then hands over to the regular entrypoint.

SCAN_DIR=${SCAN_DIR:-/data}

# Synthetic sample photos (8 JPEGs over two days), committed in deploy/e2e/photos.
mkdir -p "$SCAN_DIR"
cp -n /e2e/photos/*.jpg "$SCAN_DIR"/

# Once the API answers, /entrypoint.sh has migrated the database and created
# the admin. Point the admin at the library and scan it. manage.py scan queues
# the import directly; a scan started from the API would first download the ML
# models, which the smoke suite does not need.
(
    until python -c "import urllib.request; urllib.request.urlopen('http://localhost:8001/api/healthz')" 2>/dev/null; do
        sleep 2
    done
    echo "[e2e] seeding: scan directory $SCAN_DIR for ${ADMIN_USERNAME:-admin}"
    python manage.py shell -c "from api.models import User; User.objects.filter(username='${ADMIN_USERNAME:-admin}').update(scan_directory='$SCAN_DIR')"
    python manage.py scan
    echo "[e2e] seeding: scan queued"
) &

exec /entrypoint.sh
