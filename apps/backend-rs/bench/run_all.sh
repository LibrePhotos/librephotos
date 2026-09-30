#!/usr/bin/env bash
# run_all.sh <results dir> [stage...]
#
# The benchmark stages in the order of the 2026-09-30 run, one log per stage in
# <results dir>/logs. Default: every stage after validate/attrib/scan.
set -uo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PY="${LP_DJANGO_PY:-/c/Users/Niaz/librephotos/wt-windev/apps/backend/.venv-win/Scripts/python.exe}"
out="${1:?usage: run_all.sh <results dir> [stage...]}"
shift
stages=("$@")
[ ${#stages[@]} -eq 0 ] && stages=(dupes50 dupes250 burst50 res50 j50 w1_50 w1_250 burst250 res250 j250)
mkdir -p "$out/logs"
cd "$here"

run() {
    local name="$1"; shift
    echo "$(date +%T) start $name"
    if "$PY" "$@" > "$out/logs/$name.log" 2>&1; then
        echo "$(date +%T) done $name"
    else
        echo "$(date +%T) FAILED $name (see logs/$name.log)"
    fi
}

for s in "${stages[@]}"; do
    case "$s" in
        dupes50)
            run dupes_50k_rust w4.py dupes --ds 50k --out "$out" --variants rust --reps 3
            run dupes_50k_django w4.py dupes --ds 50k --out "$out" --variants django-shipped --reps 1 --timeout 3600 --resume ;;
        dupes250)
            run dupes_250k_rust w4.py dupes --ds 250k --out "$out" --variants rust --reps 1 --timeout 3600
            run dupes_250k_django w4.py dupes --ds 250k --out "$out" --variants django-shipped --reps 1 --timeout 1200 --resume ;;
        burst50) run burst_50k run_bench.py burst 50k --out "$out" ;;
        res50) run resources_50k run_bench.py resources 50k --out "$out" ;;
        j50) run journeys_50k run_bench.py journeys 50k --out "$out" ;;
        w1_50) run w1_50k run_bench.py w1 50k --out "$out" ;;
        w1_250) run w1_250k run_bench.py w1 250k --out "$out" --reps 3 --duration 10 ;;
        burst250) run burst_250k run_bench.py burst 250k --out "$out" ;;
        res250) run resources_250k run_bench.py resources 250k --out "$out" --reps 3 ;;
        j250) run journeys_250k run_bench.py journeys 250k --out "$out" --reps 2 ;;
        *) echo "unknown stage $s"; exit 2 ;;
    esac
done
echo "$(date +%T) all done"
