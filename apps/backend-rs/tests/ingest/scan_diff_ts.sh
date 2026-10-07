#!/usr/bin/env bash
# scan_diff_ts.sh [runs_dir] [concurrency] [scan_state diff args...]
#
# scan_diff.sh with the TypeScript pipeline (apps/backend-ts) in place of the
# Rust one: scan a copy of the fixture photo tree (data/) into two fresh
# databases, one with Django's scan_photos, one with `bun run src/cli.ts
# scan` (scan.user inline, follow-ups left out), then diff what they wrote
# (scan_state.py). Databases: lp_mut_tsing_scan_{ref,ts} (dropped first and
# again at the end unless LP_SCAN_KEEP_DBS=1); media under runs_dir.
#
# The squares are encoded at Django's Q95 here (LP_THUMB_SMALL_Q, whose
# default is Rust's 80) so the thumbnail files can be compared byte for byte.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$HERE/../fixture/env.sh"

RUNS="${1:-$LP_RUNS_ROOT/tsing_scan}"
SOURCE="${LP_SCAN_SOURCE:-$LP_FIXTURE_ROOT/data}"
CONC="${2:-6}"
REF="${LP_SCAN_REF_DB:-lp_mut_tsing_scan_ref}"
TS="${LP_SCAN_TS_DB:-lp_mut_tsing_scan_ts}"
V="$(dirname "$(dirname "$LP_DJANGO_PY")")/Lib/site-packages"
TS_DIR="$LP_REPO_ROOT/apps/backend-ts"

for db in "$REF" "$TS"; do
    lp_psql -d postgres -c "DROP DATABASE IF EXISTS \"$db\" WITH (FORCE)"
    lp_psql -d postgres -c "CREATE DATABASE \"$db\" TEMPLATE lp_django"
done
rm -rf "$RUNS"
for side in ref ts; do
    mkdir -p "$RUNS/$side/protected_media" "$RUNS/$side/logs"
    cp -r "$SOURCE" "$RUNS/$side/data"
    for u in admin alice bob carol dave; do mkdir -p "$RUNS/$side/data/$u"; done
done

django() { # db side args...
    local db="$1" side="$2"; shift 2
    (
        lp_django_env "$db" "$RUNS/$side" "$RUNS/$side-run"
        export PYTHONPATH="$(lp_win_path "$LP_BACKEND_DIR");$PYTHONPATH"
        cd "$LP_BACKEND_DIR"
        "$LP_DJANGO_PY" "$(lp_win_path "$HERE/django_scan.py")" "$@"
    )
}

django "$REF" ref users "$(cygpath -w "$RUNS/ref/data")"
django "$TS" ts users "$(cygpath -w "$RUNS/ts/data")"

echo "== Django scan"
django "$REF" ref scan 2>"$RUNS/ref-scan.err" | tee "$RUNS/ref-scan.out" | grep SCAN_REPORT

echo "== TypeScript scan (concurrency $CONC)"
(
    cd "$TS_DIR"
    export TZ=UTC DB_NAME="$TS" DB_HOST="$LP_PG_HOST" DB_PORT="$LP_PG_PORT" DB_USER="$LP_PG_USER" DB_PASS="$PGPASSWORD"
    export LP_DB_POOL="${LP_DB_POOL:-6}" SECRET_KEY="$LP_SECRET_KEY"
    export BASE_DATA="$(cygpath -m "$RUNS/ts")" BASE_LOGS="$(cygpath -m "$RUNS/ts")/logs"
    export LP_SCAN_CONCURRENCY="$CONC" LP_THUMB_SMALL_Q="${LP_THUMB_SMALL_Q:-95}"
    export LP_EXIFTOOL="$(cygpath -m "$V/exiftool_bin/exiftool.exe")"
    export LP_FFMPEG="$(cygpath -m "$V/ffmpeg_bin/bin/ffmpeg.exe")" LP_FFPROBE="$(cygpath -m "$V/ffmpeg_bin/bin/ffprobe.exe")"
    export LP_PYTHON="$(cygpath -m "$LP_DJANGO_PY")"
    export FEATURE_FACE_DETECTION=0 FEATURE_FACE_CLUSTER=0 FEATURE_IMAGE_CAPTIONING=0
    export FEATURE_REVERSE_GEOCODING=0 FEATURE_SCENE_CLASSIFICATION=0
    bun run src/cli.ts adopt >/dev/null
    bun run src/cli.ts scan 2>"$RUNS/ts-scan.err"
) | tee "$RUNS/ts-scan.out" | grep SCAN_REPORT

echo "== diff"
"$LP_DJANGO_PY" "$HERE/scan_state.py" dump "$REF" "$(cygpath -w "$RUNS/ref")" -o "$RUNS/ref.json"
"$LP_DJANGO_PY" "$HERE/scan_state.py" dump "$TS" "$(cygpath -w "$RUNS/ts")" -o "$RUNS/ts.json"
"$LP_DJANGO_PY" "$HERE/scan_state.py" diff "$RUNS/ref.json" "$RUNS/ts.json" "${@:3}" | tee "$RUNS/diff.txt" || true
echo "differences: $(wc -l < "$RUNS/diff.txt")"
if [ "${LP_SCAN_KEEP_DBS:-0}" != 1 ]; then
    for db in "$REF" "$TS"; do lp_psql -d postgres -c "DROP DATABASE IF EXISTS \"$db\" WITH (FORCE)"; done
fi
