#!/usr/bin/env bash
# Run the teardown benchmark for one app, start to finish, on a fresh copy of the dataset.
#
# usage: bench/run_tool.sh <tool> <dataset-dir> <results-dir> [rw|ro]
#
#   <tool>         librephotos (1.3.0), librephotos-dev (dev image), immich or photoprism
#   rw|ro          how the library is mounted (default rw). The ro run repeats every test on a
#                  read-only mount: LibrePhotos' scan directory, Immich's external library and
#                  PhotoPrism's originals, each with :ro and otherwise default settings.
#
#   <dataset-dir>  prepared by dataset/fetch_dataset.py, derive_formats.py, make_messy.py and
#                  lock_dataset.py (it holds library/ and meta/dataset.lock.json)
#   <results-dir>  gets <tool>-<mode>.json, .images.json, .stats.jsonl and .log
#
# Environment:
#   BENCH_WORK_ROOT  where the per-tool copy of the library and app state go (default /tmp/teardown)
#   BENCH_BUDGET     seconds from `compose up` to the end of the export check (default 600)
#   BENCH_KEEP=1     leave the stack running and the work dir in place (debugging)
#
# Image pulls happen before the clock starts and are reported separately: the network is not
# what the benchmark measures.
set -euo pipefail

tool=${1:?tool: librephotos, librephotos-dev, immich or photoprism}
dataset=$(cd "${2:?dataset dir}" && pwd)
mkdir -p "${3:?results dir}"
results=$(cd "$3" && pwd)
mode=${4:-rw}
here=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
work_root=${BENCH_WORK_ROOT:-/tmp/teardown}
work="$work_root/$tool-$mode"
budget=${BENCH_BUDGET:-600}
project="teardown-$tool-$mode"
run="$tool-$mode"
compose_dir="$here/compose/$tool"
password="teardown-Bench-2026" # matches bench/teardown_bench/adapters.py; throwaway local stack

case "$tool" in
librephotos | librephotos-dev | immich | photoprism) ;;
*)
  echo "unknown tool: $tool" >&2
  exit 2
  ;;
esac
case "$mode" in
rw | ro) ;;
*)
  echo "mode must be rw or ro, not $mode" >&2
  exit 2
  ;;
esac
[[ -f "$dataset/meta/dataset.lock.json" ]] || {
  echo "no $dataset/meta/dataset.lock.json: prepare the dataset first (README.md)" >&2
  exit 2
}

remove_work() {
  # The containers write as root; remove what they left with a throwaway container if needed.
  rm -rf "$work" 2>/dev/null || sudo rm -rf "$work"
}

compose() {
  docker compose -p "$project" --project-directory "$work" --env-file "$work/.env" \
    -f "$compose_dir/docker-compose.upstream.yml" -f "$compose_dir/docker-compose.bench.yml" "$@"
}

stop_file="$work.stop"
sampler_pid=""
cleanup() {
  touch "$stop_file"
  [[ -n "$sampler_pid" ]] && wait "$sampler_pid" 2>/dev/null || true
  if [[ -f "$work/.env" ]]; then
    compose logs --no-color --timestamps >"$results/$run.log" 2>&1 || true
    if [[ "${BENCH_KEEP:-0}" != "1" ]]; then
      compose down --volumes --remove-orphans >/dev/null 2>&1 || true
    fi
  fi
  [[ -f "$work/stats.jsonl" ]] && cp "$work/stats.jsonl" "$results/$run.stats.jsonl"
  if [[ "${BENCH_KEEP:-0}" != "1" ]]; then
    remove_work
  fi
  rm -f "$stop_file"
}
trap cleanup EXIT

remove_work
mkdir -p "$work"
echo "== $run: copying the library" >&2
cp -a "$dataset/library" "$work/library"

# .env: the upstream template with only the keys a user is told to edit.
cd "$here/bench"
case "$tool" in
librephotos | librephotos-dev)
  mkdir -p "$work/data"
  tag=1.3.0
  [[ "$tool" == "librephotos-dev" ]] && tag=dev
  python3 -m teardown_bench.envfile "$compose_dir/librephotos.env.upstream" "$work/.env" \
    "tag=$tag" "scanDirectory=$work/library" "data=$work/data" "httpPort=3000" \
    "userName=admin" "userPass=$password" "adminEmail=bench@example.com" "BENCH_LIBRARY_MODE=$mode"
  ;;
immich)
  mkdir -p "$work/immich/library" "$work/immich/postgres"
  python3 -m teardown_bench.envfile "$compose_dir/example.env.upstream" "$work/.env" \
    "IMMICH_VERSION=v3.3.3" "UPLOAD_LOCATION=$work/immich/library" \
    "DB_DATA_LOCATION=$work/immich/postgres" "BENCH_LIBRARY=$work/library" "BENCH_LIBRARY_MODE=$mode"
  ;;
photoprism)
  mkdir -p "$work/storage" "$work/database"
  python3 -m teardown_bench.envfile "$compose_dir/env.template" "$work/.env" \
    "BENCH_LIBRARY=$work/library" "BENCH_WORK=$work" "BENCH_LIBRARY_MODE=$mode"
  ;;
esac

compose config --quiet
echo "== $run: pulling images (not timed)" >&2
pull_start=$(date +%s.%N)
# Eight jobs pull at once, and a registry can answer "toomanyrequests"; back off and retry.
for attempt in 1 2 3 4 5; do
  compose pull --quiet && break
  ((attempt == 5)) && exit 1
  echo "== $run: pull failed (attempt $attempt), retrying in $((attempt * 20))s" >&2
  sleep $((attempt * 20))
done
pull_seconds=$(python3 -c "import sys; print(round(float(sys.argv[2]) - float(sys.argv[1]), 1))" \
  "$pull_start" "$(date +%s.%N)")

rm -f "$stop_file"
bash "$here/bench/sample_stats.sh" "$project" "$work/stats.jsonl" "$stop_file" &
sampler_pid=$!

echo "== $run: starting (budget ${budget}s)" >&2
t0=$(date +%s.%N)
compose up -d --quiet-pull
status=0
python3 -m teardown_bench.measure --tool "$tool" --mode "$mode" --work "$work" \
  --lock "$dataset/meta/dataset.lock.json" --interop "$dataset/meta/interop.json" \
  --stats "$work/stats.jsonl" --t0 "$t0" --budget "$budget" --out "$results/$run.json" || status=$?

# What actually ran: image ids and repo digests, plus the pull time.
compose images --format json >"$work/images.raw.json" 2>/dev/null || echo "[]" >"$work/images.raw.json"
python3 - "$work/images.raw.json" "$results/$run.images.json" "$pull_seconds" <<'PY'
import json, sys
raw, out, pull = sys.argv[1], sys.argv[2], float(sys.argv[3])
try:
    images = json.load(open(raw))
except ValueError:
    images = []
json.dump({"pull_seconds": pull, "images": images}, open(out, "w"), indent=1)
PY
exit "$status"
