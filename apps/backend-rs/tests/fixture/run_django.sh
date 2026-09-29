#!/usr/bin/env bash
# run_django.sh <db> <port> [direct]
#
# Start the Django reference server (uvicorn, 1 worker, no reload) on <db>, a
# clone from clone_db.sh, bound to 127.0.0.1:<port>. Runs in the foreground;
# start it in the background and stop it by the PID you started.
#
#   direct       Django streams media itself (SERVE_FRONTEND) instead of an
#                empty body + X-Accel-Redirect for nginx.
#   LP_MEDIA_ROOT  media tree to serve (default: the shared fixture tree; pass
#                the media_dir given to clone_db.sh for mutation tests).
#   LP_WORKERS   uvicorn workers (default 1).
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/env.sh"

db="${1:?usage: run_django.sh <db> <port> [direct]}"
port="${2:?usage: run_django.sh <db> <port> [direct]}"
mode="${3:-}"

if [ "$db" = "$LP_FIXTURE_TEMPLATE" ]; then
    echo "refusing to serve the template itself; clone it with clone_db.sh" >&2
    exit 1
fi

lp_django_env "$db" "${LP_MEDIA_ROOT:-$LP_FIXTURE_ROOT}" "$LP_RUNS_ROOT/$db-$port"
if [ "$mode" = "direct" ]; then
    export LP_DJANGO_DIRECT=1
else
    unset LP_DJANGO_DIRECT
fi

cd "$LP_BACKEND_DIR"
exec "$LP_DJANGO_PY" -m uvicorn librephotos.asgi:application \
    --host 127.0.0.1 --port "$port" --workers "${LP_WORKERS:-1}" --no-access-log
