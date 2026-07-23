#!/bin/bash
export PYTHONUNBUFFERED=TRUE
export PYTHONFAULTHANDLER=1
nvidia-smi
export CUDA_VISIBLE_DEVICES=0
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

# BASE_LOGS is what librephotos/settings/production.py derives LOGS_ROOT and
# secret.key from. Export it so the tee targets below and Django's own log
# handlers cannot drift apart; pinning the default here leaves the container's
# behaviour unchanged for anyone who never sets it. LOG_LEVEL is read by the
# LOGGING dictConfig. The %/ handles a value written with the trailing slash
# the Python default uses, so "$logs_dir/x" does not become "//x".
export BASE_LOGS="${BASE_LOGS:-/logs}"
export LOG_LEVEL="${LOG_LEVEL:-INFO}"
logs_dir="${BASE_LOGS%/}"

# Unlike the matplotlib cache above, this directory is not optional: without it
# the backend dies on its first secret.key write, with a traceback that never
# names the path it tried.
if ! mkdir -p "$logs_dir"; then
    echo "Could not create $logs_dir - set BASE_LOGS to a writable directory" >&2
    exit 1
fi

python manage.py showmigrations | tee "$logs_dir/show_migrate.log"
python manage.py migrate | tee "$logs_dir/command_migrate.log"
python manage.py showmigrations | tee "$logs_dir/show_migrate.log"
python manage.py collectstatic --no-input
python manage.py start_service all
python manage.py start_cleaning_service
python manage.py start_job_cleanup_service
python manage.py clear_cache 
python manage.py build_similarity_index 2>&1 | tee "$logs_dir/command_build_similarity_index.log"

if [[ -n "$ADMIN_USERNAME" ]]; then
    python manage.py createadmin -u "$ADMIN_USERNAME" "$ADMIN_EMAIL" 2>&1 | tee "$logs_dir/command_createadmin.log"
fi

echo "Running backend server..."

python manage.py qcluster 2>&1 | tee "$logs_dir/qcluster.log" &

# A request that outruns this is killed with SIGKILL and gunicorn's generic
# "Perhaps out of memory?" message, which is misleading: on a CPU-capped host
# the worker is usually just starved, not out of memory. Raise it if you limit
# the container's CPU. Gunicorn's own default is 30.
GUNICORN_TIMEOUT="${GUNICORN_TIMEOUT:-30}"

if [[ "$DEBUG" = 1 ]]; then
    echo "development backend starting"
    gunicorn --worker-class=gevent --max-requests 50 --timeout "$GUNICORN_TIMEOUT" --reload --bind 0.0.0.0:8001 --log-level=info librephotos.wsgi 2>&1 | tee "$logs_dir/gunicorn_django.log"
else
    echo "production backend starting"
    gunicorn --worker-class=gevent --max-requests 50 --timeout "$GUNICORN_TIMEOUT" --bind 0.0.0.0:8001 --log-level=info librephotos.wsgi 2>&1 | tee "$logs_dir/gunicorn_django.log"
fi
