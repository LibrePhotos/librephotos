# Shared settings for the fixture scripts. Source it; every value can be
# overridden from the environment.

LP_FIXTURE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LP_REPO_ROOT="$(cd "$LP_FIXTURE_DIR/../../../.." && pwd)"
LP_BACKEND_DIR="$LP_REPO_ROOT/apps/backend"

LP_PG_BIN="${LP_PG_BIN:-/c/Users/Niaz/librephotos/rust-pg/pginstall/bin}"
LP_PG_HOST="${LP_PG_HOST:-localhost}"
LP_PG_PORT="${LP_PG_PORT:-5433}"
LP_PG_USER="${LP_PG_USER:-postgres}"
export PGPASSWORD="${PGPASSWORD:-x}"

LP_DJANGO_PY="${LP_DJANGO_PY:-/c/Users/Niaz/librephotos/wt-windev/apps/backend/.venv-win/Scripts/python.exe}"

# The fixture pack: media tree + manifest.json (+ lp_fixture.dump), and the
# template database every test run clones.
LP_FIXTURE_ROOT="${LP_FIXTURE_ROOT:-C:/Users/Niaz/librephotos/rust-pg/fixture}"
LP_FIXTURE_TEMPLATE="${LP_FIXTURE_TEMPLATE:-lp_fixture}"
LP_FIXTURE_BUILD_DB="${LP_FIXTURE_BUILD_DB:-lp_fixture_build}"
# Per-run scratch (Django logs, secret.key, matplotlib cache).
LP_RUNS_ROOT="${LP_RUNS_ROOT:-C:/Users/Niaz/librephotos/rust-pg/fixture-runs}"

LP_SECRET_KEY="${LP_SECRET_KEY:-rust-bench-secret}"

lp_psql() {
    "$LP_PG_BIN/psql.exe" -h "$LP_PG_HOST" -p "$LP_PG_PORT" -U "$LP_PG_USER" -v ON_ERROR_STOP=1 -X -q "$@"
}

lp_db_exists() {
    [ "$(lp_psql -d postgres -Atc "SELECT 1 FROM pg_database WHERE datname = '$1'")" = "1" ]
}

lp_win_path() {
    cygpath -m "$1"
}

# Environment for a Django process on database $1 with BASE_DATA $2 and
# scratch directory $3. ML stays off: the fixture carries its ML rows already.
lp_django_env() {
    local db="$1" base_data="$2" run_dir="$3"
    mkdir -p "$run_dir/logs" "$run_dir/matplotlib"
    export BASE_DATA="$(lp_win_path "$base_data")"
    export PHOTOS="$BASE_DATA/data"
    export BASE_LOGS="$(lp_win_path "$run_dir/logs")"
    export MPLCONFIGDIR="$(lp_win_path "$run_dir/matplotlib")"
    export SECRET_KEY="$LP_SECRET_KEY"
    export DB_BACKEND=postgresql DB_NAME="$db" DB_USER="$LP_PG_USER" DB_PASS="$PGPASSWORD"
    export DB_HOST="$LP_PG_HOST" DB_PORT="$LP_PG_PORT"
    export DJANGO_SETTINGS_MODULE=lp_twin_settings
    export PYTHONPATH="$(lp_win_path "$LP_FIXTURE_DIR")"
    export PYTHONIOENCODING=utf-8 PYTHONUTF8=1
    export FEATURE_FACE_DETECTION=0 FEATURE_FACE_CLUSTER=0 FEATURE_IMAGE_CAPTIONING=0
    export FEATURE_REVERSE_GEOCODING=0 FEATURE_SCENE_CLASSIFICATION=0
}
