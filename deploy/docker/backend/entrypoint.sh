#!/bin/bash
export PYTHONUNBUFFERED=TRUE
export PYTHONFAULTHANDLER=1

if [[ "$(uname -m)" == "aarch64"* ]]; then
    export OPENBLAS_CORETYPE=ARMV8
    echo "ARM architecture detected. OPENBLAS_CORETYPE set to ARMV8"
fi
export OPENBLAS_NUM_THREADS=1
export OPENBLAS_MAIN_FREE=1

# Matplotlib comes along with insightface, which the face recognition service
# imports. Left to itself it keeps its font cache under $HOME, and when the home
# directory is not writable it falls back to a fresh /tmp directory and re-parses
# every font on each start. Keep it on our own volume instead; this is the same
# path librephotos/settings/production.py derives.
mpl_data_root="${BASE_DATA:-/}"
export MPLCONFIGDIR="${MPLCONFIGDIR:-${mpl_data_root%/}/protected_media/matplotlib}"
mkdir -p "$MPLCONFIGDIR" || echo "Could not create $MPLCONFIGDIR - matplotlib will rebuild its font cache on every start"

mkdir -p /logs
python manage.py showmigrations | tee /logs/show_migrate.log
python manage.py migrate | tee /logs/command_migrate.log
python manage.py showmigrations | tee /logs/show_migrate.log
python manage.py collectstatic --no-input
python manage.py start_service all
python manage.py start_cleaning_service
python manage.py clear_cache 
python manage.py build_similarity_index 2>&1 | tee /logs/command_build_similarity_index.log

if [[ -n "$ADMIN_USERNAME" ]]; then
    python manage.py createadmin -u "$ADMIN_USERNAME" "$ADMIN_EMAIL" 2>&1 | tee /logs/command_createadmin.log
fi

echo "Running backend server..."

python manage.py qcluster 2>&1 | tee /logs/qcluster.log &

# A request that outruns this is killed with SIGKILL and gunicorn's generic
# "Perhaps out of memory?" message, which is misleading: on a CPU-capped host
# the worker is usually just starved, not out of memory. Raise it if you limit
# the container's CPU. Gunicorn's own default is 30.
GUNICORN_TIMEOUT="${GUNICORN_TIMEOUT:-30}"

if [[ "$DEBUG" = 1 ]]; then
    echo "development backend starting"
    gunicorn --worker-class=gevent --max-requests 50 --timeout "$GUNICORN_TIMEOUT" --reload --bind 0.0.0.0:8001 --log-level=info librephotos.wsgi 2>&1 | tee /logs/gunicorn_django.log
else
    echo "production backend starting"
    gunicorn --worker-class=gevent --max-requests 50 --timeout "$GUNICORN_TIMEOUT" --bind 0.0.0.0:8001 --log-level=info librephotos.wsgi 2>&1 | tee /logs/gunicorn_django.log
fi
