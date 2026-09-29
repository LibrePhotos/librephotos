#!/usr/bin/env bash
# run_mutations.sh: the albums_tags mutation twin (mutations.test.ts) plus
# the database / media state diff against Django (06 layer 4).
#
#   REF_PORT / RS_PORT   Django / Rust ports (default 8106 / 8107)
#   LP_RS_BIN            librephotos-rs binary (default: target/debug copy)
#
# Clones lp_mut_rs_albums_tags_{ref,rs} with their own media copies, starts
# both servers, runs the mutations, dumps and diffs both states, then stops
# the servers it started and drops the clones.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONTRACT="$(cd "$HERE/../.." && pwd)"
RS_ROOT="$(cd "$CONTRACT/../.." && pwd)"
F="$RS_ROOT/tests/fixture"
source "$F/env.sh"

REF_PORT="${REF_PORT:-8106}"
RS_PORT="${RS_PORT:-8107}"
RUN="$LP_RUNS_ROOT/albums_tags_mut"
REF_DB=lp_mut_rs_albums_tags_ref
RS_DB=lp_mut_rs_albums_tags_rs
mkdir -p "$RUN"

"$F/drop_db.sh" "$REF_DB" "$RUN/ref" >/dev/null 2>&1 || true
"$F/drop_db.sh" "$RS_DB" "$RUN/rs" >/dev/null 2>&1 || true
"$F/clone_db.sh" "$REF_DB" "$RUN/ref"
"$F/clone_db.sh" "$RS_DB" "$RUN/rs"

BIN="$RUN/librephotos-rs.exe"
cp "${LP_RS_BIN:-$RS_ROOT/target/debug/librephotos-rs.exe}" "$BIN"
V=/c/Users/Niaz/librephotos/wt-windev/apps/backend/.venv-win/Lib/site-packages
rs_env() {
    export BASE_DATA="$(cygpath -m "$RUN/rs")" BASE_LOGS="$(cygpath -m "$RUN")/rs-logs" \
        PHOTOS="$(cygpath -m "$RUN/rs")/data" SECRET_KEY="$LP_SECRET_KEY" DB_NAME="$RS_DB" \
        DB_USER="$LP_PG_USER" DB_PASS="$PGPASSWORD" DB_HOST="$LP_PG_HOST" DB_PORT="$LP_PG_PORT" \
        LP_BIND="127.0.0.1:$RS_PORT" LP_MEDIA_MODE=direct \
        LP_EXIFTOOL=$V/exiftool_bin/exiftool.exe LP_FFMPEG=$V/ffmpeg_bin/bin/ffmpeg.exe \
        LP_FFPROBE=$V/ffmpeg_bin/bin/ffprobe.exe LP_VIPS_LIB=$V/libvips-42-e6cc51bbc763e7deda536c6f56ce96b4.dll
    mkdir -p "$RUN/rs-logs"
}
(rs_env; "$BIN" adopt)

LP_MEDIA_ROOT="$RUN/ref" "$F/run_django.sh" "$REF_DB" "$REF_PORT" >"$RUN/django.log" 2>&1 &
DJ_PID=$!
(rs_env; exec "$BIN" serve) >"$RUN/rust.log" 2>&1 &
RS_PID=$!
cleanup() {
    kill "$DJ_PID" "$RS_PID" 2>/dev/null || true
}
trap cleanup EXIT
"$F/wait_http.sh" "http://127.0.0.1:$REF_PORT" 120
"$F/wait_http.sh" "http://127.0.0.1:$RS_PORT" 60

status=0
(
    cd "$CONTRACT"
    LP_MUTATION=1 LP_REF_URL="http://127.0.0.1:$REF_PORT" LP_BASE_URL="http://127.0.0.1:$RS_PORT" \
        npx vitest run tests/albums_tags/mutations.test.ts
) || status=1

# DeletionLog tombstones feed only the mobile sync API (dropped, 02 §5).
"$LP_DJANGO_PY" "$F/dump_state.py" db "$REF_DB" --baseline "$LP_FIXTURE_TEMPLATE" --media-root "$(cygpath -m "$RUN/ref")" -o "$RUN/ref.json"
"$LP_DJANGO_PY" "$F/dump_state.py" db "$RS_DB" --baseline "$LP_FIXTURE_TEMPLATE" --media-root "$(cygpath -m "$RUN/rs")" -o "$RUN/rs.json"
"$LP_DJANGO_PY" "$F/dump_state.py" diff "$RUN/ref.json" "$RUN/rs.json" --ignore api_deletionlog || status=1
"$LP_DJANGO_PY" "$F/dump_state.py" files "$(cygpath -m "$RUN/ref")" --content -o "$RUN/ref-files.json"
"$LP_DJANGO_PY" "$F/dump_state.py" files "$(cygpath -m "$RUN/rs")" --content -o "$RUN/rs-files.json"
"$LP_DJANGO_PY" "$F/dump_state.py" diff "$RUN/ref-files.json" "$RUN/rs-files.json" || status=1

cleanup
trap - EXIT
if [ "${KEEP:-0}" != 1 ]; then
    "$F/drop_db.sh" "$REF_DB" "$RUN/ref"
    "$F/drop_db.sh" "$RS_DB" "$RUN/rs"
fi
exit $status
