#!/usr/bin/env bash
# run_suite.sh [unit ...] -- the whole contract + twin suite, each unit on
# fresh clones (tests/README.md §2), against librephotos-rs and the Django
# reference. Prints one summary line per unit; exit status 1 if any failed.
#
# Units (default: all of them):
#   <area>           read cases of tests/<area>/: a fresh clone pair sharing one
#                    media copy (so path-projecting twins agree), both servers
#                    in x-accel mode. `media@direct` runs tests/media in direct mode.
#   mut:<name>       a gated mutation file (table below): each server on its own
#                    clone and media copy, then dump_state.py diffs the databases
#                    and media trees. Accepted differences are listed, with the
#                    reason, in tests/<area>/<name>.accept (one regex per line,
#                    matched against diff lines).
#
#   LP_RS_BIN        librephotos-rs binary (default target/release)
#   LP_SUITE_PORT    first of three ports: Django, Rust, the sidecar mock (default 8700)
#   LP_SUITE_OUT     logs, dumps and diffs (default $LP_RUNS_ROOT/suite)
#   KEEP=1           keep the clones and media copies
#
# The Rust server runs its job worker in-process, Django has no qcluster:
# jobs a case starts run on the Rust clone only.
# Parsed as a whole before it runs, so editing the file mid-run is safe.
{
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RS_ROOT="$(cd "$HERE/../.." && pwd)"
F="$RS_ROOT/tests/fixture"
source "$F/env.sh"
export PYTHONUTF8=1 PYTHONIOENCODING=utf-8

OUT="${LP_SUITE_OUT:-$LP_RUNS_ROOT/suite}"
PORT="${LP_SUITE_PORT:-8700}"
REF_PORT=$PORT
RS_PORT=$((PORT + 1))
MOCK_PORT=$((PORT + 2))
MOCK="http://127.0.0.1:$MOCK_PORT"
BIN="${LP_RS_BIN:-$RS_ROOT/target/release/librephotos-rs.exe}"
V="$(dirname "$(dirname "$LP_DJANGO_PY")")/Lib/site-packages"
export LP_CLONE_PREFIXES="lp_run_"
mkdir -p "$OUT"

READ_UNITS="examples harness albums_tags jobs_zip_services media media@direct people_faces photo_edits
search_sharing_public stats_admin_stacks_dupes timeline_photos users_settings"

# name|env flag|test paths|options
#   diff      dump and diff both states afterwards
#   solo      the file talks to one server (LP_BASE_URL): run it once per server
#   mock      sidecars at the mock (Django: exif in-process, FEATURE_* on)
#   direct    both servers stream media themselves
#   presql=X  SQL file (tests/<area>/X) run on both clones before the servers start
MUT_UNITS="
albums_tags|LP_MUTATION|tests/albums_tags/mutations.test.ts|diff
photo_edits|LP_MUTATION|tests/photo_edits/mutations.test.ts|diff
photo_edits_review|LP_MUTATION_REVIEW|tests/photo_edits/mutations_review.test.ts|diff
rotate_media|LP_ROTATE_DISK=media|tests/photo_edits/rotate_disk.test.ts|diff mock presql=rotate_media.sql
rotate_sidecar|LP_ROTATE_DISK=sidecar|tests/photo_edits/rotate_disk.test.ts|diff mock presql=rotate_sidecar.sql
timestamp|LP_TIMESTAMP|tests/photo_edits/timestamp.test.ts|diff solo mock
people_faces|LP_MUTATION_CLONES|tests/people_faces/mutations.test.ts|diff
stacks_dupes|LP_MUTATIONS|tests/stats_admin_stacks_dupes/mutations.test.ts|diff
metadata|LP_MUTATION|tests/timeline_photos/metadata.test.ts|diff
users_settings|LP_MUTATION|tests/users_settings/mutations.test.ts|diff
jobs|LP_MUTATION|tests/jobs_zip_services/mutations.test.ts|diff
upload|LP_MUTATION|tests/upload|
transcode|LP_TRANSCODE_TWIN|tests/media/transcode.test.ts|direct presql=transcode.sql
sidecars|LP_SIDECAR_MOCK|tests/sidecars|mock presql=sidecars.sql
"

listener_pid() {
    netstat -ano | awk -v p=":$1" '$1 == "TCP" && $2 ~ p"$" && ($3 == "0.0.0.0:0" || $3 == "[::]:0") { print $5; exit }'
}

stop_port() {
    local pid
    pid="$(listener_pid "$1")"
    if [ -n "$pid" ]; then taskkill //PID "$pid" //T //F >/dev/null 2>&1 || true; fi
}

for p in "$REF_PORT" "$RS_PORT" "$MOCK_PORT"; do
    if [ -n "$(listener_pid "$p")" ]; then
        echo "port $p is in use; set LP_SUITE_PORT" >&2
        exit 2
    fi
done
[ -x "$BIN" ] || { echo "no binary at $BIN (cargo build --release -p lp-server)" >&2; exit 2; }
NODE22=/c/Users/Niaz/AppData/Roaming/fnm/node-versions/v22.23.3/installation
[ -d "$NODE22" ] && export PATH="$NODE22:$PATH"

cleanup() {
    stop_port "$REF_PORT"
    stop_port "$RS_PORT"
    stop_port "$MOCK_PORT"
}
trap cleanup EXIT

# clone <db> <media> [template]: a fixture clone with its own media copy, or
# a copy of <template> (another clone) sharing that clone's media.
clone() {
    lp_psql -d postgres -c "DROP DATABASE IF EXISTS \"$1\" WITH (FORCE)" >/dev/null 2>&1
    if [ -n "${3:-}" ]; then
        lp_psql -d postgres -c "CREATE DATABASE \"$1\" TEMPLATE \"$3\"" >/dev/null
    else
        rm -rf "$2"
        "$F/clone_db.sh" "$1" "$2" >/dev/null
    fi
}

drop() {
    [ "${KEEP:-0}" = 1 ] && return 0
    "$F/drop_db.sh" "$1" >/dev/null
    [ -n "${2:-}" ] && rm -rf "$2"
    return 0
}

# start_rust <db> <media> <mode> <log dir> [mock]
start_rust() {
    local db="$1" media="$2" mode="$3" logs="$4" mock="${5:-}"
    mkdir -p "$logs"
    (
        export BASE_DATA="$(lp_win_path "$media")" BASE_LOGS="$(lp_win_path "$logs")"
        export PHOTOS="$BASE_DATA/data" SECRET_KEY="$LP_SECRET_KEY" DB_NAME="$db"
        export DB_USER="$LP_PG_USER" DB_PASS="$PGPASSWORD" DB_HOST="$LP_PG_HOST" DB_PORT="$LP_PG_PORT"
        export LP_BIND="127.0.0.1:$RS_PORT" LP_MEDIA_MODE="$mode"
        export LP_EXIFTOOL="$V/exiftool_bin/exiftool.exe" LP_FFMPEG="$V/ffmpeg_bin/bin/ffmpeg.exe"
        export LP_FFPROBE="$V/ffmpeg_bin/bin/ffprobe.exe" LP_PYTHON="$(lp_win_path "$LP_DJANGO_PY")"
        export LP_VIPS_LIB="${LP_VIPS_LIB:-$(ls "$V"/libvips-42-*.dll | head -1)}"
        if [ -n "$mock" ]; then
            for s in SIMILARITY FACE CLIP CAPTION TAGS OCR FACE_CLUSTER; do export "LP_SIDECAR_${s}_URL=$MOCK"; done
            export FEATURE_FACE_DETECTION=1 FEATURE_FACE_CLUSTER=1 FEATURE_IMAGE_CAPTIONING=1
            export FEATURE_REVERSE_GEOCODING=0 FEATURE_SCENE_CLASSIFICATION=1
        else
            export FEATURE_FACE_DETECTION=0 FEATURE_FACE_CLUSTER=0 FEATURE_IMAGE_CAPTIONING=0
            export FEATURE_REVERSE_GEOCODING=0 FEATURE_SCENE_CLASSIFICATION=0
        fi
        "$BIN" adopt >"$logs/adopt.log" 2>&1
        exec "$BIN" serve
    ) >"$logs/rust.log" 2>&1 &
}

# start_django <db> <media> <mode> [mock]
start_django() {
    local db="$1" media="$2" mode="$3" mock="${4:-}"
    local direct=""
    [ "$mode" = direct ] && direct=direct
    (
        export LP_MEDIA_ROOT="$media"
        if [ -n "$mock" ]; then export LP_DJANGO_MOCK="$MOCK"; fi
        exec "$F/run_django.sh" "$db" "$REF_PORT" $direct
    ) >"$OUT/django-$db.log" 2>&1 &
}

start_mock() {
    MOCK_MANIFEST="$(lp_win_path "${LP_MANIFEST:-$LP_FIXTURE_ROOT/manifest.json}")" \
        "$LP_DJANGO_PY" "$(lp_win_path "$RS_ROOT/tests/tasks/mock_sidecars.py")" "$MOCK_PORT" \
        >"$OUT/mock.log" 2>&1 &
    for _ in $(seq 1 50); do
        curl -fsS -o /dev/null "$MOCK/health" && return 0
        sleep 0.2
    done
    echo "mock sidecars did not start" >&2
    return 1
}

wait_up() {
    "$F/wait_http.sh" "http://127.0.0.1:$REF_PORT" 180 >/dev/null 2>&1 &&
        "$F/wait_http.sh" "http://127.0.0.1:$RS_PORT" 120 >/dev/null 2>&1
}

# vitest <log> <env...> -- <paths...>
vitest() {
    local log="$1"
    shift
    local envs=()
    while [ "$1" != "--" ]; do envs+=("$1"); shift; done
    shift
    (cd "$HERE" && env "${envs[@]}" npx vitest run "$@") >"$log" 2>&1
}

# "Tests  12 passed | 1 failed (13)" -> "12 passed | 1 failed"
counts() {
    sed 's/\x1b\[[0-9;]*m//g' "$1" | awk '/^ *Tests +[0-9]/ { sub(/^ *Tests +/, ""); sub(/ *\([0-9]+\)$/, ""); print; exit }'
}

SUMMARY=()
FAILED=0
note() {
    SUMMARY+=("$1")
    echo "$1"
}

run_read() {
    local unit="$1" area="${1%@*}" mode=x-accel
    [ "$unit" != "$area" ] && mode="${unit#*@}"
    local name="lp_run_${area}_${mode//-/}"
    local dir="$OUT/${unit//@/-}" media="$OUT/${unit//@/-}/media"
    mkdir -p "$dir"
    clone "${name}_ref" "$media"
    clone "${name}_rs" "$media" "${name}_ref"
    start_django "${name}_ref" "$media" "$mode"
    start_rust "${name}_rs" "$media" "$mode" "$dir/rs-logs"
    if ! wait_up; then
        note "$unit: servers did not start (see $OUT)"
        FAILED=1
    else
        local status=0
        vitest "$dir/vitest.log" LP_REF_URL="http://127.0.0.1:$REF_PORT" LP_BASE_URL="http://127.0.0.1:$RS_PORT" -- "tests/$area" || status=1
        note "$unit: $(counts "$dir/vitest.log")$([ $status = 1 ] && echo "  FAILED ($dir/vitest.log)")"
        [ $status = 1 ] && FAILED=1
    fi
    stop_port "$REF_PORT"
    stop_port "$RS_PORT"
    drop "${name}_rs"
    drop "${name}_ref" "$media"
}

# accept <diff file> <accept file>: drop the accepted lines, report how many.
accept() {
    local diff="$1" acc="$2"
    if [ ! -s "$diff" ]; then echo 0; return; fi
    if [ -f "$acc" ]; then
        grep -v '^\s*#' "$acc" | grep -v '^\s*$' | tr -d '\r' >"$diff.patterns"
        grep -Evf "$diff.patterns" "$diff" >"$diff.left" || true
    else
        cp "$diff" "$diff.left"
    fi
    wc -l <"$diff.left" | tr -d ' '
}

run_mut() {
    local unit="$1" spec
    spec="$(printf '%s\n' "$MUT_UNITS" | awk -F'|' -v n="${unit#mut:}" '$1 == n')"
    if [ -z "$spec" ]; then note "$unit: unknown unit"; FAILED=1; return; fi
    local flag paths opts
    IFS='|' read -r _ flag paths opts <<<"$spec"
    [[ "$flag" == *=* ]] || flag="$flag=1"
    local name="lp_run_mut_${unit#mut:}" dir="$OUT/mut-${unit#mut:}"
    local ref_media="$dir/ref" rs_media="$dir/rs" mode=x-accel mock="" solo=0 diff=0 presql=""
    for o in $opts; do
        case "$o" in
            diff) diff=1 ;;
            solo) solo=1 ;;
            mock) mock=1 ;;
            direct) mode=direct ;;
            presql=*) presql="${o#presql=}" ;;
        esac
    done
    local area="${paths#tests/}"
    area="${area%%/*}"
    rm -rf "$dir"
    mkdir -p "$dir"
    clone "${name}_ref" "$ref_media"
    clone "${name}_rs" "$rs_media"
    if [ -n "$presql" ]; then
        for side in ref rs; do
            local media="$ref_media"
            [ $side = rs ] && media="$rs_media"
            sed "s|@MEDIA@|$(lp_win_path "$media")|g" "$HERE/tests/$area/$presql" | lp_psql -d "${name}_$side" >/dev/null
            if [ -f "$HERE/tests/$area/${presql%.sql}.sh" ]; then bash "$HERE/tests/$area/${presql%.sql}.sh" "$media"; fi
        done
    fi
    if [ -n "$mock" ]; then start_mock || { note "$unit: no mock"; FAILED=1; return; }; fi
    start_django "${name}_ref" "$ref_media" "$mode" "$mock"
    start_rust "${name}_rs" "$rs_media" "$mode" "$dir/rs-logs" "$mock"
    local status=0 result=""
    if ! wait_up; then
        note "$unit: servers did not start (see $OUT)"
        FAILED=1
        stop_port "$REF_PORT"; stop_port "$RS_PORT"; stop_port "$MOCK_PORT"
        return
    fi
    local ref="http://127.0.0.1:$REF_PORT" rs="http://127.0.0.1:$RS_PORT"
    local common=("$flag" "LP_TC_REF_MEDIA=$(lp_win_path "$ref_media")" "LP_TC_RS_MEDIA=$(lp_win_path "$rs_media")" "LP_TC_SEED_REF=1")
    # shellcheck disable=SC2086
    if [ $solo = 1 ]; then
        vitest "$dir/vitest-ref.log" "${common[@]}" LP_REF_URL="$ref" LP_BASE_URL="$ref" -- $paths || status=1
        vitest "$dir/vitest.log" "${common[@]}" LP_REF_URL="$rs" LP_BASE_URL="$rs" -- $paths || status=1
        result="ref $(counts "$dir/vitest-ref.log"); rs $(counts "$dir/vitest.log")"
    else
        vitest "$dir/vitest.log" "${common[@]}" LP_REF_URL="$ref" LP_BASE_URL="$rs" -- $paths || status=1
        result="$(counts "$dir/vitest.log")"
    fi
    # Let the Rust worker finish what the cases queued before dumping.
    sleep 3
    stop_port "$REF_PORT"
    stop_port "$RS_PORT"
    stop_port "$MOCK_PORT"
    if [ $diff = 1 ]; then
        local py="$LP_DJANGO_PY" left_db left_files acc="$HERE/tests/$area/${unit#mut:}.accept"
        "$py" "$F/dump_state.py" db "${name}_ref" --baseline "$LP_FIXTURE_TEMPLATE" --media-root "$(lp_win_path "$ref_media")" -o "$dir/ref.json"
        "$py" "$F/dump_state.py" db "${name}_rs" --baseline "$LP_FIXTURE_TEMPLATE" --media-root "$(lp_win_path "$rs_media")" -o "$dir/rs.json"
        "$py" "$F/dump_state.py" diff "$dir/ref.json" "$dir/rs.json" >"$dir/db.diff"
        "$py" "$F/dump_state.py" files "$(lp_win_path "$ref_media")" --content --skip protected_media/thumbnails --skip protected_media/square_thumbnails -o "$dir/ref-files.json"
        "$py" "$F/dump_state.py" files "$(lp_win_path "$rs_media")" --content --skip protected_media/thumbnails --skip protected_media/square_thumbnails -o "$dir/rs-files.json"
        "$py" "$F/dump_state.py" diff "$dir/ref-files.json" "$dir/rs-files.json" >"$dir/files.diff"
        left_db="$(accept "$dir/db.diff" "$acc")"
        left_files="$(accept "$dir/files.diff" "$acc")"
        result="$result; db diff $(wc -l <"$dir/db.diff" | tr -d ' ') lines, $left_db not accepted; files diff $(wc -l <"$dir/files.diff" | tr -d ' ') lines, $left_files not accepted"
        if [ "$left_db" != 0 ] || [ "$left_files" != 0 ]; then status=1; fi
    fi
    note "$unit: $result$([ $status = 1 ] && echo "  FAILED ($dir)")"
    [ $status = 1 ] && FAILED=1
    drop "${name}_ref" "$ref_media"
    drop "${name}_rs" "$rs_media"
}

units=("$@")
if [ ${#units[@]} = 0 ]; then
    # shellcheck disable=SC2206
    units=($READ_UNITS)
    while IFS='|' read -r n _; do [ -n "$n" ] && units+=("mut:$n"); done <<<"$MUT_UNITS"
fi
for u in "${units[@]}"; do
    case "$u" in
        mut:*) run_mut "$u" ;;
        *) run_read "$u" ;;
    esac
done
echo
echo "== summary"
printf '%s\n' "${SUMMARY[@]}"
exit $FAILED
}
