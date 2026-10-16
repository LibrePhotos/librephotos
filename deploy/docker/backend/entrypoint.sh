#!/bin/bash
# The one entrypoint of the backend, GPU and unified images (all three
# Dockerfiles copy this file). What differs between them is a guarded block
# below (nvidia-smi for GPU, SERVE_FRONTEND for unified) or an ENV default in
# the image's Dockerfile, never a second copy of the script:
# apps/backend/api/tests/infra/test_deploy_images.py fails on one.
#
# pipefail, not -e: a pipeline's status is its first failing command rather than
# tee's, so the migrate check below sees a failed migration. Everything else
# keeps running past a failure as before (build_similarity_index, createadmin).
set -o pipefail

export PYTHONUNBUFFERED=TRUE
export PYTHONFAULTHANDLER=1

if [[ "$(uname -m)" == "aarch64"* ]]; then
    export OPENBLAS_CORETYPE=ARMV8
    echo "ARM architecture detected. OPENBLAS_CORETYPE set to ARMV8"
fi
export OPENBLAS_NUM_THREADS=1
export OPENBLAS_MAIN_FREE=1

# GPU image: show the GPU the container got and default to the first one.
# A CUDA_VISIBLE_DEVICES set on the container wins.
if command -v nvidia-smi >/dev/null 2>&1; then
    nvidia-smi
    export CUDA_VISIBLE_DEVICES="${CUDA_VISIBLE_DEVICES:-0}"
fi

# Matplotlib comes along with insightface, which the face recognition service
# imports. Left to itself it keeps its font cache under $HOME, and when the home
# directory is not writable it falls back to a fresh /tmp directory and re-parses
# every font on each start. Keep it on our own volume instead; this is the same
# path librephotos/settings/production.py derives.
mpl_data_root="${BASE_DATA:-/}"
export MPLCONFIGDIR="${MPLCONFIGDIR:-${mpl_data_root%/}/protected_media/matplotlib}"
mkdir -p "$MPLCONFIGDIR" || echo "Could not create $MPLCONFIGDIR - matplotlib will rebuild its font cache on every start"

# BASE_LOGS is what librephotos/settings/production.py derives LOGS_ROOT from.
# Export it so the tee targets below and Django's own log handlers cannot drift
# apart; pinning the default here leaves the container's
# behaviour unchanged for anyone who never sets it. LOG_LEVEL is read by the
# LOGGING dictConfig. The %/ handles a value written with the trailing slash
# the Python default uses, so "$logs_dir/x" does not become "//x".
export BASE_LOGS="${BASE_LOGS:-/logs}"
export LOG_LEVEL="${LOG_LEVEL:-INFO}"
logs_dir="${BASE_LOGS%/}"

# Unlike the matplotlib cache above, this directory is not optional: the
# backend's log handler writes there, so stop here and name the path.
if ! mkdir -p "$logs_dir"; then
    echo "Could not create $logs_dir - set BASE_LOGS to a writable directory" >&2
    exit 1
fi

# Unified image: serve the web app from Django (WhiteNoise) on port 8001, with
# no proxy in front. The no-proxy settings import librephotos.settings.production
# and override only what serving the frontend changes. manage.py, asgi.py and
# wsgi.py use os.environ.setdefault, so exporting here wins for every python
# invocation below, for uvicorn, and for the ML services those spawn.
startup_page_args=(--port 8001)
if echo "$SERVE_FRONTEND" | grep -qiE '^(true|1|yes|on)$'; then
    echo "Serving the frontend from Django on port 8001 (no proxy)"
    export DJANGO_SETTINGS_MODULE="${DJANGO_SETTINGS_MODULE:-librephotos.settings.production_noproxy}"
    startup_page_args+=(--serve-frontend)
fi

# Until uvicorn starts, librephotos/startup_page.py answers on port 8001
# (#2310): /api/healthz 200, every other /api/ path 503 with what is going on
# (starting, updating, failed and why), and with SERVE_FRONTEND a page that
# says so. It reads that from the status file this script writes.
startup_status_file=/tmp/librephotos-startup.json
startup_phase() {
    python -m librephotos.startup_page set --status-file "$startup_status_file" "$@"
}
startup_phase starting >/dev/null
python -m librephotos.startup_page serve --status-file "$startup_status_file" "${startup_page_args[@]}" &
startup_page_pid=$!
stop_startup_page() {
    kill "$startup_page_pid" 2>/dev/null
    wait "$startup_page_pid" 2>/dev/null
}
# docker stop while the page is up (bash is PID 1 and ignores SIGTERM unless
# it traps it): stop the page and end, instead of waiting for the SIGKILL.
trap 'stop_startup_page; exit 143' TERM INT

python manage.py showmigrations | tee "$logs_dir/show_migrate.log"
# "[ ]" marks a migration this start applies: an update (or a first start).
update_phase=starting
if grep -q '\[ \]' "$logs_dir/show_migrate.log"; then
    update_phase=updating
fi

# Back up, then migrate. On failure, failure_log names the log that says why.
prepare_database() {
    startup_phase "$update_phase" >/dev/null
    # With SQLite (the unified image's default), copy the database into
    # db/backups before migrations change it, keeping DB_BACKUP_KEEP copies.
    # Nothing is migrated without that backup. With PostgreSQL the command only
    # says to use pg_dump, so it runs for every image rather than in a branch
    # that would have to repeat how the settings pick the database.
    failure_log="$logs_dir/command_backup_database.log"
    if ! python manage.py backup_database --if-pending-migrations 2>&1 | tee "$failure_log"; then
        echo "Could not back up the database before migrating it, not starting LibrePhotos. See $failure_log" >&2
        return 1
    fi
    failure_log="$logs_dir/command_migrate.log"
    if ! python manage.py migrate 2>&1 | tee "$failure_log"; then
        echo "Database migration failed, not starting LibrePhotos. See $failure_log" >&2
        return 1
    fi
}

# Serving on a schema the code does not match fails in ways that are hard to
# trace back, so nothing starts after a failure. The container stays up with
# the page saying why, rather than exiting into a restart loop (#2310). A
# database too old (librephotos.E001) or too new (E002) for this release needs
# the admin, so that is final; anything else (a database that came up late)
# is tried again after 30 s, 1, 2 and 5 minutes, then every 5 minutes.
retry_delays=(30 60 120 300)
attempt=0
until prepare_database; do
    reason=$(startup_phase failed --reason-from "$failure_log")
    if [[ "$reason" == E0?? ]]; then
        echo "This release cannot run on this database (librephotos.$reason), not trying again. See $failure_log" >&2
        wait "$startup_page_pid"
        exit 1
    fi
    delay=${retry_delays[attempt]:-300}
    attempt=$((attempt + 1))
    echo "Trying again in $delay seconds" >&2
    # In the background, so docker stop's SIGTERM does not wait for it.
    sleep "$delay" &
    wait $!
done
startup_phase starting >/dev/null
python manage.py showmigrations | tee "$logs_dir/show_migrate.log"
python manage.py collectstatic --no-input
python manage.py start_service all
python manage.py start_cleaning_service
python manage.py start_job_cleanup_service
python manage.py clear_cache
python manage.py build_similarity_index 2>&1 | tee "$logs_dir/command_build_similarity_index.log" \
    || echo "build_similarity_index failed, continuing. See $logs_dir/command_build_similarity_index.log" >&2
# The automatic post-upgrade tasks (Admin page, Finish the upgrade), each once.
python manage.py start_upgrade_tasks 2>&1 | tee "$logs_dir/command_start_upgrade_tasks.log" \
    || echo "start_upgrade_tasks failed, continuing. See $logs_dir/command_start_upgrade_tasks.log" >&2

# The admin account is only ever touched through createadmin: it creates the
# account on the first start (ADMIN_EMAIL is used then, and may be blank) and
# afterwards only resets the password to ADMIN_PASSWORD. Without a password
# there is nothing to set, so the step is skipped.
if [[ -n "$ADMIN_USERNAME" && -n "$ADMIN_PASSWORD" ]]; then
    python manage.py createadmin -u "$ADMIN_USERNAME" "$ADMIN_EMAIL" 2>&1 | tee "$logs_dir/command_createadmin.log"
fi

echo "Running backend server..."

python manage.py qcluster 2>&1 | tee "$logs_dir/qcluster.log" &

# WEB_CONCURRENCY uvicorn processes; recycle each one after WEB_MAX_REQUESTS
# requests when there is more than one, so a recycled worker never takes the
# whole API down. The unified image sets both higher in its Dockerfile (4 and
# 2000): it serves the web app and every thumbnail through Django too. Not under
# --reload: uvicorn then runs a single child that its reloader would not restart.
args=(librephotos.asgi:application --host 0.0.0.0 --port 8001 --log-level info --workers "${WEB_CONCURRENCY:-1}")
if [[ "$DEBUG" = 1 ]]; then
    echo "development backend starting"
    args+=(--reload)
else
    echo "production backend starting"
    if [[ "${WEB_CONCURRENCY:-1}" -gt 1 ]]; then args+=(--limit-max-requests "${WEB_MAX_REQUESTS:-50}"); fi
fi
# Give the port to uvicorn. The web app bridges the seconds in between: it
# shows "not answering" for a 502 or no answer, and reloads once ready.
stop_startup_page
trap - TERM INT
rm -f "$startup_status_file"
uvicorn "${args[@]}" 2>&1 | tee "$logs_dir/uvicorn_django.log"
