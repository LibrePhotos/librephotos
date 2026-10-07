#!/usr/bin/env bash
# run_diff.sh <django-job> <rust-kind> [user] [extra django_tasks.py args]
#
# Run one background task on two fresh fixture clones (each with its own
# media copy): Django's code on rs_tasks_<job>_ref, Rust's on
# rs_tasks_<job>_rs, both against the same mock sidecars; then dump and diff
# the databases (compare.py) and the media trees. Leaves db.diff / files.diff in
# $OUT (default: fixture-runs/rs_tasks/<job>). Needs the mock
# (mock_sidecars.py) on $LP_TASKS_MOCK_PORT and, for clustering, the
# face_cluster sidecar on $LP_TASKS_FC_PORT (start_services.sh).
#
#   LP_DIFF_KEEP=1    keep the clones
#   LP_DIFF_PREFIX    clone name prefix (default rs_tasks_)
#   LP_DIFF_PRESQL    SQL run on both clones before the task (a starting state)
#   LP_DIFF_IGNORE    `compare.py --ignore` entries (table or table.column)
#   LP_DIFF_COUNT_ONLY  link tables compared by rows per parent (`--count-only`)
#   LP_DIFF_SUT       rust (default) or ts: the side compared with Django.
#                     ts runs librephotos-ts (apps/backend-ts, or LP_TS_DIR):
#                     `bun run src/cli.ts run-job <kind> <payload>`
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
F="$HERE/../fixture"
source "$F/env.sh"
export PYTHONUTF8=1 PYTHONIOENCODING=utf-8

dj="${1:?usage: run_diff.sh <django-job> <rust-kind> [user] [django args]}"
kind="${2:?usage: run_diff.sh <django-job> <rust-kind> [user] [django args]}"
user="${3:-alice}"
shift $(( $# < 3 ? $# : 3 ))
MOCK="http://127.0.0.1:${LP_TASKS_MOCK_PORT:-18120}"
FC="http://127.0.0.1:${LP_TASKS_FC_PORT:-18121}"
P="${LP_DIFF_PREFIX:-rs_tasks_}"
ROOT="$LP_RUNS_ROOT/${P%_}"
OUT="${OUT:-$ROOT/$dj}"
REF=${P}${dj}_ref
RS=${P}${dj}_rs
BASE=${P}baseline
export LP_CLONE_PREFIXES="$P"
mkdir -p "$OUT"
# The Django args the Rust side mirrors: --setting K=V, --incremental.
settings=""
full=1
prev=""
for a in "$@"; do
    [ "$prev" = "--setting" ] && settings="${settings:+$settings;}$a"
    [ "$a" = "--incremental" ] && full=0
    prev="$a"
done

for db in "$REF" "$RS"; do
    lp_psql -d postgres -c "DROP DATABASE IF EXISTS \"$db\" WITH (FORCE)" >/dev/null
    rm -rf "${ROOT:?}/media_$db"
    "$F/clone_db.sh" "$db" "$ROOT/media_$db" >/dev/null
    if [ -n "${LP_DIFF_PRESQL:-}" ]; then lp_psql -d "$db" -c "$LP_DIFF_PRESQL" >/dev/null; fi
done

SITE="$(cygpath -u "$(dirname "$LP_DJANGO_PY")")/../Lib/site-packages"
EXIFTOOL="$SITE/exiftool_bin/exiftool.exe"

echo "== django $dj"
(
    lp_django_env "$REF" "$ROOT/media_$REF" "$ROOT/run_$REF"
    export FEATURE_FACE_DETECTION=1 FEATURE_FACE_CLUSTER=1 FEATURE_IMAGE_CAPTIONING=1
    export FEATURE_REVERSE_GEOCODING=1 FEATURE_SCENE_CLASSIFICATION=1
    export PYTHONPATH="$(lp_win_path "$LP_BACKEND_DIR");$PYTHONPATH"
    export PATH="$(dirname "$EXIFTOOL"):$PATH"
    cd "$LP_BACKEND_DIR"
    start=$(date +%s.%N)
    "$LP_DJANGO_PY" "$(lp_win_path "$HERE/django_tasks.py")" "$dj" "$user" --mock "$MOCK" "$@" \
        > "$OUT/django.log" 2>&1 || { tail -30 "$OUT/django.log"; exit 1; }
    end=$(date +%s.%N)
    grep -E "django .* done|caption ok" "$OUT/django.log" || true
    echo "django wall time: $(awk "BEGIN{print $end - $start}") s"
)

SUT="${LP_DIFF_SUT:-rust}"
if [ "$SUT" = ts ]; then
echo "== ts $kind"
(
    TS_DIR="${LP_TS_DIR:-$(cd "$HERE/../../../backend-ts" && pwd)}"
    uid="$(lp_psql -d "$RS" -Atc "SELECT id FROM api_user WHERE username = '$user'")"
    case "$kind" in
        captions.generate) payload="{\"photo_id\": \"${LP_DIFF_PHOTO:?LP_DIFF_PHOTO}\"}" ;;
        *) payload="{\"user_id\": $uid, \"full_scan\": $([ "$full" = 1 ] && echo true || echo false)}" ;;
    esac
    extra=()
    case "$kind" in faces.scan|faces.cluster) extra+=(--then faces.train) ;; esac
    IFS=';' read -ra kvs <<<"$settings"
    for kv in "${kvs[@]}"; do [ -n "$kv" ] && extra+=(--setting "$kv"); done
    export BASE_DATA="$(lp_win_path "$ROOT/media_$RS")" SECRET_KEY="$LP_SECRET_KEY" TZ=UTC
    export PHOTOS="$BASE_DATA/data" BASE_LOGS="$(lp_win_path "$ROOT/run_$RS")"
    export DB_NAME="$RS" DB_USER="$LP_PG_USER" DB_PASS="$PGPASSWORD" DB_HOST="$LP_PG_HOST" DB_PORT="$LP_PG_PORT" LP_DB_POOL="${LP_DB_POOL:-4}"
    for s in SIMILARITY FACE CLIP CAPTION TAGS OCR; do export "LP_SIDECAR_${s}_URL=$MOCK"; done
    export LP_SIDECAR_FACE_CLUSTER_URL="$FC" LP_GEOCODE_NOMINATIM_URL="$MOCK" LP_ML_AUTO_DOWNLOAD=0
    export FEATURE_FACE_DETECTION=1 FEATURE_FACE_CLUSTER=1 FEATURE_IMAGE_CAPTIONING=1
    export FEATURE_REVERSE_GEOCODING=1 FEATURE_SCENE_CLASSIFICATION=1
    export LP_EXIFTOOL="$(lp_win_path "$EXIFTOOL")"
    cd "$TS_DIR"
    { bun run src/cli.ts adopt && bun run src/cli.ts run-job "$kind" "$payload" "${extra[@]}"; }         > "$OUT/ts.log" 2>&1 || { tail -40 "$OUT/ts.log"; exit 1; }
    grep -E "ts .* done" "$OUT/ts.log"
)
else
echo "== rust $kind"
(
    cd "$HERE/../.."
    LP_DIFF_DB="$RS" LP_DIFF_BASE_DATA="$(lp_win_path "$ROOT/media_$RS")" LP_DIFF_JOB="$kind" \
    LP_DIFF_USER="$user" LP_DIFF_MOCK="$MOCK" LP_DIFF_FACE_CLUSTER="$FC" \
    LP_DIFF_PHOTO="${LP_DIFF_PHOTO:-}" LP_DIFF_SETTINGS="$settings" LP_DIFF_FULL="$full" LP_EXIFTOOL="$(lp_win_path "$EXIFTOOL")" \
        cargo test -q -p lp-tasks --test differential -- --ignored --nocapture \
        > "$OUT/rust.log" 2>&1 || { tail -40 "$OUT/rust.log"; exit 1; }
    grep -E "rust .* done" "$OUT/rust.log"
)
fi

echo "== diff"
D="$(lp_win_path "$F/dump_state.py")"
status=0
# $BASE: an untouched clone, so nothing connects to the template.
if ! lp_db_exists "$BASE"; then "$F/clone_db.sh" "$BASE" >/dev/null; fi
"$LP_DJANGO_PY" "$(lp_win_path "$HERE/compare.py")" "$REF" "$RS" --baseline "$BASE" \
    --ref-media "$(lp_win_path "$ROOT/media_$REF")" --rs-media "$(lp_win_path "$ROOT/media_$RS")" \
    ${LP_DIFF_IGNORE:+--ignore $LP_DIFF_IGNORE} ${LP_DIFF_COUNT_ONLY:+--count-only $LP_DIFF_COUNT_ONLY}     > "$OUT/db.diff" 2>&1 || status=1
"$LP_DJANGO_PY" "$D" files "$(lp_win_path "$ROOT/media_$REF")" -o "$(lp_win_path "$OUT/ref-files.json")"
"$LP_DJANGO_PY" "$D" files "$(lp_win_path "$ROOT/media_$RS")" -o "$(lp_win_path "$OUT/rs-files.json")"
"$LP_DJANGO_PY" "$D" diff "$(lp_win_path "$OUT/ref-files.json")" "$(lp_win_path "$OUT/rs-files.json")" \
    > "$OUT/files.diff" 2>&1 || status=1
echo "db: $(tail -1 "$OUT/db.diff"), files diff: $(wc -l < "$OUT/files.diff") lines ($OUT)"

if [ -z "${LP_DIFF_KEEP:-}" ]; then
    for db in "$REF" "$RS"; do
        "$F/drop_db.sh" "$db" "$ROOT/media_$db" >/dev/null
    done
fi
exit $status
