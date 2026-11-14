#!/usr/bin/env bash
# wait_http.sh <base_url> [timeout_seconds]  -- wait until <base_url>/api/healthz answers 200.
set -euo pipefail
url="${1:?usage: wait_http.sh <base_url> [timeout_seconds]}"
deadline=$(( $(date +%s) + ${2:-60} ))
until curl -fsS -o /dev/null "$url/api/healthz"; do
    if [ "$(date +%s)" -ge "$deadline" ]; then
        echo "timed out waiting for $url" >&2
        exit 1
    fi
    sleep 1
done
