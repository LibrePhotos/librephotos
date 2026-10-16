#!/usr/bin/env bash
# Sample `docker stats --no-stream` for every container of one compose project
# until STOP_FILE exists. One JSON line per container per round:
#   {"t": <epoch seconds of the round>, "s": <docker stats JSON>}
# Each `docker stats --no-stream` call itself takes about 2 s (it needs two
# readings to compute CPU %), which sets the sampling interval.
#
# usage: sample_stats.sh <compose-project> <out.jsonl> <stop-file>
set -euo pipefail

project=${1:?compose project}
out=${2:?output file}
stop=${3:?stop file}

: >"$out"
while [[ ! -e "$stop" ]]; do
  mapfile -t ids < <(docker ps -q --filter "label=com.docker.compose.project=${project}")
  if ((${#ids[@]} == 0)); then
    sleep 1
    continue
  fi
  t=$(date +%s.%N)
  # A container that exits between `ps` and `stats` makes the call fail; skip that round.
  if rows=$(docker stats --no-stream --format '{{json .}}' "${ids[@]}" 2>/dev/null); then
    while IFS= read -r row; do
      [[ -n "$row" ]] && printf '{"t": %s, "s": %s}\n' "$t" "$row" >>"$out"
    done <<<"$rows"
  fi
done
