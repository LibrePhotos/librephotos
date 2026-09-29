#!/usr/bin/env bash
# run.sh -- real-frontend smoke walk of the Rust backend against Django.
#
# Clones lp_fixture twice (each with its own media copy, since the walk
# uploads, favorites, creates albums and labels faces), starts librephotos-rs
# on one and the Django reference on the other, puts a Vite dev server in
# front of each, walks both with walk.mjs and prints diff.mjs (what happens on
# Rust but not on Django). Everything it started is stopped on exit; clones
# are kept for inspection unless SMOKE_DROP=1.
#
# Needs: target/release/librephotos-rs(.exe) (cargo build --release -p lp-server),
# apps/frontend/node_modules, npm install in this directory, Node 22 on PATH.
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$here/../fixture/env.sh"
F="$here/../fixture"

rs_db="${SMOKE_RS_DB:-lp_t_smoke}"
ref_db="${SMOKE_REF_DB:-lp_t_smoke_ref}"
rs_port="${SMOKE_RS_PORT:-8311}"
ref_port="${SMOKE_REF_PORT:-8312}"
rs_fe="${SMOKE_RS_FE_PORT:-3311}"
ref_fe="${SMOKE_REF_FE_PORT:-3312}"
runs="$LP_RUNS_ROOT"
rs_media="$runs/smoke-media-rs"
ref_media="$runs/smoke-media-ref"
out="$here/out"
bin="$here/../../target/release/librephotos-rs"
[ -x "$bin.exe" ] && bin="$bin.exe"
venv="$(dirname "$(dirname "$LP_DJANGO_PY")")/Lib/site-packages"

# The state column is localised (LISTENING, ABHÖREN, ...); a listener is the
# row whose foreign address is the wildcard.
listener_pid() {
    netstat -ano | awk -v p=":$1" '$1 == "TCP" && $2 ~ p"$" && ($3 == "0.0.0.0:0" || $3 == "[::]:0") { print $5; exit }'
}

stop_port() {
    local pid
    pid="$(listener_pid "$1")"
    [ -n "$pid" ] && taskkill //PID "$pid" //T //F > /dev/null 2>&1 || true
}

for port in "$rs_port" "$ref_port" "$rs_fe" "$ref_fe"; do
    if [ -n "$(listener_pid "$port")" ]; then
        echo "port $port is in use" >&2
        exit 1
    fi
done

cleanup() {
    for port in "$rs_port" "$ref_port" "$rs_fe" "$ref_fe"; do stop_port "$port"; done
    if [ "${SMOKE_DROP:-0}" = 1 ]; then
        "$F/drop_db.sh" "$rs_db" "$rs_media"
        "$F/drop_db.sh" "$ref_db" "$ref_media"
    fi
}
trap cleanup EXIT

for pair in "$rs_db:$rs_media" "$ref_db:$ref_media"; do
    db="${pair%%:*}" media="${pair#*:}"
    lp_db_exists "$db" && "$F/drop_db.sh" "$db" "$media"
    rm -rf "$media"
    "$F/clone_db.sh" "$db" "$media"
done

mkdir -p "$runs/smoke-rs-logs"
(
    export BASE_DATA="$(lp_win_path "$rs_media")" BASE_LOGS="$(lp_win_path "$runs/smoke-rs-logs")"
    export SECRET_KEY="$LP_SECRET_KEY" DB_NAME="$rs_db" DB_USER="$LP_PG_USER" DB_PASS="$PGPASSWORD"
    export DB_HOST="$LP_PG_HOST" DB_PORT="$LP_PG_PORT" LP_BIND="127.0.0.1:$rs_port" LP_MEDIA_MODE=direct
    export LP_EXIFTOOL="$venv/exiftool_bin/exiftool.exe" LP_FFMPEG="$venv/ffmpeg_bin/bin/ffmpeg.exe"
    export LP_FFPROBE="$venv/ffmpeg_bin/bin/ffprobe.exe"
    export LP_VIPS_LIB="${LP_VIPS_LIB:-$(ls "$venv"/libvips-42-*.dll | head -1)}"
    export FEATURE_FACE_DETECTION=0 FEATURE_FACE_CLUSTER=0 FEATURE_IMAGE_CAPTIONING=0
    export FEATURE_REVERSE_GEOCODING=0 FEATURE_SCENE_CLASSIFICATION=0
    "$bin" adopt
    exec "$bin" serve
) > "$runs/smoke-rs.log" 2>&1 &
LP_MEDIA_ROOT="$ref_media" "$F/run_django.sh" "$ref_db" "$ref_port" direct > "$runs/smoke-django.log" 2>&1 &

frontend="$LP_REPO_ROOT/apps/frontend"
(cd "$frontend" && VITE_BACKEND_URL="http://127.0.0.1:$rs_port" exec npx vite --port "$rs_fe" --strictPort --host 127.0.0.1) \
    > "$runs/smoke-vite-rs.log" 2>&1 &
(cd "$frontend" && VITE_BACKEND_URL="http://127.0.0.1:$ref_port" exec npx vite --port "$ref_fe" --strictPort --host 127.0.0.1) \
    > "$runs/smoke-vite-ref.log" 2>&1 &

"$F/wait_http.sh" "http://127.0.0.1:$rs_port" 60
"$F/wait_http.sh" "http://127.0.0.1:$ref_port" 120
"$F/wait_http.sh" "http://127.0.0.1:$rs_fe" 120
"$F/wait_http.sh" "http://127.0.0.1:$ref_fe" 120

rm -rf "$out/rust" "$out/django"
cd "$here"
node walk.mjs "http://127.0.0.1:$ref_fe" django "$out/django" > "$out-django.log" 2>&1 &
ref_walk=$!
node walk.mjs "http://127.0.0.1:$rs_fe" rust "$out/rust" | tee "$out-rust.log"
wait "$ref_walk"
node diff.mjs "$out/django/report.json" "$out/rust/report.json" "$out/diff.json"
