# Shared settings for the benchmark scripts (Git Bash). Source it.
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../tests/fixture/env.sh"

LP_BENCH_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LP_RS_BIN="${LP_RS_BIN:-$LP_BENCH_DIR/../target/release/librephotos-rs.exe}"
# One media tree serves both synthetic datasets (the 50k hashes are a prefix of the 250k ones).
LP_BENCH_MEDIA="${LP_BENCH_MEDIA:-C:/Users/Niaz/librephotos/rust-pg/bench-media}"
LP_BENCH_RUNS="${LP_BENCH_RUNS:-C:/Users/Niaz/librephotos/rust-pg/bench-runs}"
LP_VENV_SP="$(dirname "$(dirname "$LP_DJANGO_PY")")/Lib/site-packages"

# Environment for librephotos-rs on database $1, BASE_DATA $2, bind port $3, logs $4.
lp_rust_env() {
    local db="$1" base_data="$2" port="$3" logs="$4"
    mkdir -p "$logs"
    export BASE_DATA="$(lp_win_path "$base_data")" BASE_LOGS="$(lp_win_path "$logs")"
    export SECRET_KEY="$LP_SECRET_KEY" DB_NAME="$db" DB_USER="$LP_PG_USER" DB_PASS="$PGPASSWORD"
    export DB_HOST="$LP_PG_HOST" DB_PORT="$LP_PG_PORT" LP_BIND="127.0.0.1:$port" LP_MEDIA_MODE=direct
    export LP_EXIFTOOL="$LP_VENV_SP/exiftool_bin/exiftool.exe" LP_FFMPEG="$LP_VENV_SP/ffmpeg_bin/bin/ffmpeg.exe"
    export LP_FFPROBE="$LP_VENV_SP/ffmpeg_bin/bin/ffprobe.exe"
    export LP_VIPS_LIB="${LP_VIPS_LIB:-$(ls "$LP_VENV_SP"/libvips-42-*.dll | head -1)}"
    export FEATURE_FACE_DETECTION=0 FEATURE_FACE_CLUSTER=0 FEATURE_IMAGE_CAPTIONING=0
    export FEATURE_REVERSE_GEOCODING=0 FEATURE_SCENE_CLASSIFICATION=0
    export LOG_LEVEL="${LOG_LEVEL:-info}"
}
