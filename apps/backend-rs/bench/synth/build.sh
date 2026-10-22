#!/usr/bin/env bash
# build.sh <name> <photos> <years> [seed]
#
# Build the template database lp_bench_<name>: clone lp_fixture, adopt it for
# Rust (its additive indexes are then in the template, so Django gets them
# too), grow alice's library with synth.sql, VACUUM ANALYZE, mark it a
# template, and hard-link the thumbnails into $LP_BENCH_MEDIA.
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$here/../env.sh"

name="${1:?usage: build.sh <name> <photos> <years> [seed]}"
photos="${2:?}"
years="${3:?}"
seed="${4:-0.42}"
build="lp_bench_${name}_build"
template="lp_bench_${name}"
mapfile="$LP_BENCH_RUNS/synth-$name-map.csv"
mkdir -p "$LP_BENCH_RUNS"

lp_psql -d postgres -c "DROP DATABASE IF EXISTS \"$build\" WITH (FORCE)"
lp_psql -d postgres -c "CREATE DATABASE \"$build\" TEMPLATE \"$LP_FIXTURE_TEMPLATE\""
(lp_rust_env "$build" "$LP_BENCH_MEDIA" 8999 "$LP_BENCH_RUNS/build-logs" && "$LP_RS_BIN" adopt)

start=$(date +%s)
lp_psql -d "$build" -1 -v n="$photos" -v years="$years" -v seed="$seed" -v mapfile="$(lp_win_path "$mapfile")" \
    -f "$(lp_win_path "$here/synth.sql")"
echo "[synth] SQL took $(( $(date +%s) - start )) s"
lp_psql -d "$build" -c "VACUUM ANALYZE"

if lp_db_exists "$template"; then
    lp_psql -d postgres -c "ALTER DATABASE \"$template\" IS_TEMPLATE false"
    lp_psql -d postgres -c "DROP DATABASE \"$template\""
fi
lp_psql -d postgres -c "ALTER DATABASE \"$build\" RENAME TO \"$template\""
lp_psql -d postgres -c "ALTER DATABASE \"$template\" IS_TEMPLATE true"

"$LP_DJANGO_PY" "$(lp_win_path "$here/link_thumbs.py")" "$(lp_win_path "$mapfile")" \
    "$(lp_win_path "$LP_FIXTURE_ROOT")" "$(lp_win_path "$LP_BENCH_MEDIA")"
echo "[synth] template $template ready"
