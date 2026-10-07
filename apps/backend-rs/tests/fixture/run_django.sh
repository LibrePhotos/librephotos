#!/usr/bin/env bash
# run_django.sh <db> <port> [direct]
#
# Start the Django reference server (uvicorn, 1 worker, no reload) on <db>, a
# clone from clone_db.sh (with LP_DB_BACKEND=sqlite: a SQLite clone name or
# file, served with lp_twin_settings_sqlite), bound to 127.0.0.1:<port>. Runs in the foreground;
# start it in the background and stop it by the PID you started.
#
#   direct       Django streams media itself (SERVE_FRONTEND) instead of an
#                empty body + X-Accel-Redirect for nginx.
#   LP_MEDIA_ROOT  media tree to serve (default: the shared fixture tree; pass
#                the media_dir given to clone_db.sh for mutation tests).
#   LP_WORKERS   uvicorn workers (default 1).
#   LP_DJANGO_MOCK  URL of tests/tasks/mock_sidecars.py: every ML sidecar call
#                goes there, exif sidecar calls are served in-process, and
#                face detection, clustering, captioning and tagging are on.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/env.sh"

db="${1:?usage: run_django.sh <db> <port> [direct]}"
port="${2:?usage: run_django.sh <db> <port> [direct]}"
mode="${3:-}"

if [ "$db" = "$LP_FIXTURE_TEMPLATE" ] ||
    { [ "$LP_DB_BACKEND" = sqlite ] && [ "$(lp_sqlite_path "$db")" = "$(lp_win_path "$LP_SQLITE_TEMPLATE")" ]; }; then
    echo "refusing to serve the template itself; clone it with clone_db.sh" >&2
    exit 1
fi

lp_django_env "$db" "${LP_MEDIA_ROOT:-$LP_FIXTURE_ROOT}" "$LP_RUNS_ROOT/$db-$port"
if [ -n "${LP_DJANGO_MOCK:-}" ]; then
    export FEATURE_FACE_DETECTION=1 FEATURE_FACE_CLUSTER=1 FEATURE_IMAGE_CAPTIONING=1 FEATURE_SCENE_CLASSIFICATION=1
    export PATH="$(dirname "$LP_DJANGO_PY")/../Lib/site-packages/exiftool_bin:$PATH"
fi
if [ "$mode" = "direct" ]; then
    export LP_DJANGO_DIRECT=1
else
    unset LP_DJANGO_DIRECT
fi

cd "$LP_BACKEND_DIR"
exec "$LP_DJANGO_PY" -m uvicorn librephotos.asgi:application \
    --host 127.0.0.1 --port "$port" --workers "${LP_WORKERS:-1}" --no-access-log
