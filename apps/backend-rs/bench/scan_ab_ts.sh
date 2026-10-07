#!/usr/bin/env bash
# scan_ab_ts.sh <label> [KEY=VALUE ...] -- one TS scan of a library subset,
# inline (bun run src/cli.ts scan), for quick A/B of scan settings.
#   LP_SCAN_LIB  library to scan (default rust-pg/bench-scan/sub400: every
#                5th JPEG of the W4 library, hard links)
#   LP_BUN       bun executable (default bun on PATH)
# Clones lp_bench_scan (user `scanner`), points the scanner at the library,
# scans into a fresh BASE_DATA, prints the SCAN_REPORT line, drops the clone.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$HERE/../tests/fixture/env.sh"
LABEL="${1:-run}"; shift || true
LIB="${LP_SCAN_LIB:-C:/Users/Niaz/librephotos/rust-pg/bench-scan/sub400}"
DB=lp_t_tsscanab
RUN="C:/Users/Niaz/librephotos/rust-pg/bench-runs/tsscanab"
V="$(dirname "$(dirname "$LP_DJANGO_PY")")/Lib/site-packages"
lp_psql -d postgres -c "DROP DATABASE IF EXISTS $DB WITH (FORCE)" >/dev/null
lp_psql -d postgres -c "CREATE DATABASE $DB TEMPLATE lp_bench_scan" >/dev/null
lp_psql -d $DB -c "UPDATE api_user SET scan_directory = '$(cygpath -w "$LIB")' WHERE username = 'scanner'" >/dev/null
rm -rf "$RUN"; mkdir -p "$RUN/protected_media" "$RUN/logs"
cd "$HERE/../../backend-ts"
export TZ=UTC DB_HOST=localhost DB_PORT=5433 DB_USER=postgres DB_PASS=x DB_NAME=$DB SECRET_KEY=rust-bench-secret
export BASE_DATA="$RUN" BASE_LOGS="$RUN/logs" LP_PYTHON="$(lp_win_path "$LP_DJANGO_PY")" WORKER_CONCURRENCY=6
export LP_EXIFTOOL="$V/exiftool_bin/exiftool.exe" LP_FFMPEG="$V/ffmpeg_bin/bin/ffmpeg.exe" LP_FFPROBE="$V/ffmpeg_bin/bin/ffprobe.exe"
export FEATURE_FACE_DETECTION=0 FEATURE_FACE_CLUSTER=0 FEATURE_IMAGE_CAPTIONING=0 FEATURE_REVERSE_GEOCODING=0 FEATURE_SCENE_CLASSIFICATION=0
for kv in "$@"; do export "$kv"; done
"${LP_BUN:-bun}" run src/cli.ts adopt >/dev/null
out="$("${LP_BUN:-bun}" run src/cli.ts scan scanner 2>&1 | grep '^SCAN_REPORT' || true)"
python -c "
import json,sys
r=json.loads(sys.argv[1].split(' ',1)[1]); print(f\"$LABEL: {r['seconds']:.1f} s  {r['files_per_second']:.1f} files/s  cpu {r['cpu_s']:.0f} s  rss {r['peak_rss_mib']} MiB\")
" "$out" || echo "$LABEL: no SCAN_REPORT"
phash="$(lp_psql -d $DB -Atc "SELECT md5(string_agg(perceptual_hash, ',' ORDER BY image_hash)) FROM api_photo")"
echo "  phash digest $phash"
lp_psql -d postgres -c "DROP DATABASE IF EXISTS $DB WITH (FORCE)" >/dev/null
