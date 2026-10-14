#!/usr/bin/env bash
# start_services.sh: the mock sidecars (LP_TASKS_MOCK_PORT, default 18120)
# and the real face_cluster sidecar (LP_TASKS_FC_PORT, default 18121) in the
# foreground, for run_diff.sh. Stop them by the PID you started.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$HERE/../fixture/env.sh"
"$LP_DJANGO_PY" "$(lp_win_path "$HERE/mock_sidecars.py")" "${LP_TASKS_MOCK_PORT:-18120}" &
mock=$!
SERVICE_PORT="${LP_TASKS_FC_PORT:-18121}" "$LP_DJANGO_PY" \
    "$(lp_win_path "$HERE/../../sidecars/face_cluster/main.py")" &
fc=$!
trap 'kill $mock $fc 2>/dev/null' EXIT
wait
