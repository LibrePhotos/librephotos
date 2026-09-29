#!/usr/bin/env bash
# scan_diff.sh [runs_dir] [concurrency]
#
# Scan a copy of the fixture photo tree (data/) into two fresh databases,
# one with Django's scan_photos, one with the Rust pipeline, then diff what
# they wrote (scan_state.py) and print both timings. Databases:
# lp_mut_rs_ingest_{ref,rs} (dropped first); media under runs_dir.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$HERE/../fixture/env.sh"

RUNS="${1:-$LP_RUNS_ROOT/rs_ingest_scan}"
CONC="${2:-12}"
REF=lp_mut_rs_ingest_ref
RS=lp_mut_rs_ingest_rs
V="$(dirname "$(dirname "$LP_DJANGO_PY")")/Lib/site-packages"
RS_DIR="$LP_REPO_ROOT/apps/backend-rs"

for db in "$REF" "$RS"; do
    lp_psql -d postgres -c "DROP DATABASE IF EXISTS \"$db\" WITH (FORCE)"
    lp_psql -d postgres -c "CREATE DATABASE \"$db\" TEMPLATE lp_django"
done
rm -rf "$RUNS"
for side in ref rs; do
    mkdir -p "$RUNS/$side/protected_media" "$RUNS/$side/logs"
    cp -r "$LP_FIXTURE_ROOT/data" "$RUNS/$side/"
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
django "$RS" rs users "$(cygpath -w "$RUNS/rs/data")"

echo "== Django scan"
django "$REF" ref scan 2>"$RUNS/ref-scan.err" | tee "$RUNS/ref-scan.out" | grep SCAN_REPORT

echo "== Rust scan (concurrency $CONC)"
(
    cd "$RS_DIR"
    LP_SCAN_DB="$RS" LP_SCAN_BASE_DATA="$(cygpath -m "$RUNS/rs")" LP_SCAN_CONCURRENCY="$CONC" \
    LP_EXIFTOOL="$(cygpath -m "$V/exiftool_bin/exiftool.exe")" \
    LP_FFMPEG="$(cygpath -m "$V/ffmpeg_bin/bin/ffmpeg.exe")" \
    LP_FFPROBE="$(cygpath -m "$V/ffmpeg_bin/bin/ffprobe.exe")" \
    LP_VIPS_LIB="$(cygpath -m "$(ls "$V"/libvips-42-*.dll)")" \
    LP_PYTHON="$(cygpath -m "$LP_DJANGO_PY")" \
        cargo test -q -p lp-ingest --test scan_bench -- --ignored --nocapture 2>"$RUNS/rs-scan.err"
) | tee "$RUNS/rs-scan.out" | grep SCAN_REPORT

echo "== diff"
"$LP_DJANGO_PY" "$HERE/scan_state.py" dump "$REF" "$(cygpath -w "$RUNS/ref")" -o "$RUNS/ref.json"
"$LP_DJANGO_PY" "$HERE/scan_state.py" dump "$RS" "$(cygpath -w "$RUNS/rs")" -o "$RUNS/rs.json"
"$LP_DJANGO_PY" "$HERE/scan_state.py" diff "$RUNS/ref.json" "$RUNS/rs.json" "${@:3}" | tee "$RUNS/diff.txt" || true
echo "differences: $(wc -l < "$RUNS/diff.txt")"
