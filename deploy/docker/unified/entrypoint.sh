#!/bin/bash

set -e

echo "LibrePhotos starting..."

# Matplotlib comes along with insightface, which the face recognition service
# imports. Left to itself it keeps its font cache under $HOME, and when the home
# directory is not writable it falls back to a fresh /tmp directory and re-parses
# every font on each start. Keep it on our own volume instead; this is the same
# path librephotos/settings/production.py derives.
mpl_data_root="${BASE_DATA:-/}"
export MPLCONFIGDIR="${MPLCONFIGDIR:-${mpl_data_root%/}/protected_media/matplotlib}"
mkdir -p "$MPLCONFIGDIR" || echo "Could not create $MPLCONFIGDIR - matplotlib will rebuild its font cache on every start"

# BASE_LOGS is what the settings module derives LOGS_ROOT and secret.key from.
# Export it so the tee targets below and Django's own log
# handlers cannot drift apart; pinning the default here leaves the container's
# behaviour unchanged for anyone who never sets it. LOG_LEVEL is read by the
# LOGGING dictConfig. The %/ handles a value written with the trailing slash
# the Python default uses, so "$logs_dir/x" does not become "//x".
export BASE_LOGS="${BASE_LOGS:-/logs}"
export LOG_LEVEL="${LOG_LEVEL:-INFO}"
logs_dir="${BASE_LOGS%/}"

# This image never created the directory at all, so a plain `docker run` with no
# /logs volume died on the first secret.key write. Unlike the matplotlib cache
# above the directory is not optional, so name the path instead of continuing.
if ! mkdir -p "$logs_dir"; then
    echo "Could not create $logs_dir - set BASE_LOGS to a writable directory" >&2
    exit 1
fi

# Check if we should serve frontend
if echo "$SERVE_FRONTEND" | grep -qiE '^(true|1|yes|on)$'; then
    echo "Configuring for no-proxy deployment (serving frontend from Django)..."

    # Select the no-proxy settings module. It imports librephotos.settings.
    # production and overrides only what serving the frontend from Django
    # changes; this used to be a `cp` of a second, hand-maintained copy of
    # production.py over the real one, which drifted and broke /api/sitesettings.
    # manage.py and wsgi.py both use os.environ.setdefault, so exporting here
    # wins for every python invocation below, for gunicorn, and for the ML
    # services those spawn.
    export DJANGO_SETTINGS_MODULE="${DJANGO_SETTINGS_MODULE:-librephotos.settings.production_noproxy}"

    # Collect static files including frontend
    echo "Collecting static files..."
    python manage.py collectstatic --noinput

    echo "Frontend will be served from Django on port 8001"
else
    echo "Using standard proxy setup..."
fi

# Run migrations based on database backend
echo "Running migrations..."
DB_BACKEND=${DB_BACKEND:-sqlite}

if [ "$DB_BACKEND" = "sqlite" ]; then
    echo "Using production-optimized SQLite database mode"
    # Run migrations for both default and cache databases
    python manage.py migrate
    
elif [ "$DB_BACKEND" = "postgresql" ]; then
    echo "Using PostgreSQL database mode"
    
    # Run standard migrations
    python manage.py migrate
else
    echo "Error: Unsupported DB_BACKEND: $DB_BACKEND"
    echo "Supported values: sqlite, postgresql"
    exit 1
fi

# Create cache directory
mkdir -p /root/.cache

# Check if we need to create a superuser
if [ ! -z "$ADMIN_USERNAME" ] && [ ! -z "$ADMIN_PASSWORD" ]; then
    echo "Creating/updating admin user..."
    python manage.py shell <<EOF
from api.models import User
from django.contrib.auth.hashers import make_password
import os

username = os.environ.get('ADMIN_USERNAME')
password = os.environ.get('ADMIN_PASSWORD')
email = os.environ.get('ADMIN_EMAIL', 'admin@example.com')

try:
    user = User.objects.get(username=username)
    user.set_password(password)
    user.email = email
    user.save()
    print(f"Updated existing admin user: {username}")
except User.DoesNotExist:
    user = User.objects.create_superuser(username=username, password=password, email=email)
    print(f"Created new admin user: {username}")
EOF
fi

echo "Starting Django server..."

python manage.py start_service all
python manage.py start_cleaning_service
python manage.py start_job_cleanup_service
python manage.py clear_cache 
python manage.py build_similarity_index 2>&1 | tee "$logs_dir/command_build_similarity_index.log"
python manage.py qcluster 2>&1 | tee "$logs_dir/qcluster.log" &

# Start the Django server
if [ "$DEBUG" = "1" ]; then
    python manage.py runserver 0.0.0.0:8001
else
    # Production server with gunicorn
    gunicorn --bind 0.0.0.0:8001 --workers ${WEB_CONCURRENCY:-4} --timeout 3600 --max-requests 2000 --max-requests-jitter 50 librephotos.wsgi:application
fi 
