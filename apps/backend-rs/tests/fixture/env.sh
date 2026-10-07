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

# Database backend of the fixture, the clones and the Django twin:
# postgresql (default) or sqlite (Django's DB_BACKEND=sqlite, the file layout
# of production_noproxy.py; see lp_twin_settings_sqlite.py).
export LP_DB_BACKEND="${LP_DB_BACKEND:-postgresql}"

# The fixture pack: media tree + manifest.json (+ lp_fixture.dump), and the
# template database every test run clones. The SQLite pack has its own media
# tree (the stored paths point into it) and the template file lp_fixture.sqlite3.
if [ "$LP_DB_BACKEND" = sqlite ]; then
    LP_FIXTURE_ROOT="${LP_FIXTURE_ROOT:-C:/Users/Niaz/librephotos/rust-pg/fixture-sqlite}"
else
    LP_FIXTURE_ROOT="${LP_FIXTURE_ROOT:-C:/Users/Niaz/librephotos/rust-pg/fixture}"
fi
LP_SQLITE_TEMPLATE="${LP_SQLITE_TEMPLATE:-$LP_FIXTURE_ROOT/lp_fixture.sqlite3}"
LP_FIXTURE_TEMPLATE="${LP_FIXTURE_TEMPLATE:-lp_fixture}"
LP_FIXTURE_BUILD_DB="${LP_FIXTURE_BUILD_DB:-lp_fixture_build}"
# Per-run scratch (Django logs, secret.key, matplotlib cache).
LP_RUNS_ROOT="${LP_RUNS_ROOT:-C:/Users/Niaz/librephotos/rust-pg/fixture-runs}"
# SQLite clones: <name>.sqlite3 here (clone_db.sh / drop_db.sh / run_django.sh
# take the same names as on Postgres).
LP_SQLITE_CLONES="${LP_SQLITE_CLONES:-$LP_RUNS_ROOT/sqlite}"

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

# lp_sqlite_path <name|path>: a clone name maps to $LP_SQLITE_CLONES/<name>.sqlite3;
# anything with a slash or a .sqlite3 suffix is already a path.
lp_sqlite_path() {
    case "$1" in
        */*|*\\*|*.sqlite3) lp_win_path "$1" ;;
        *) lp_win_path "$LP_SQLITE_CLONES/$1.sqlite3" ;;
    esac
}

# lp_sql <clone name|sqlite file> [-c SQL | -f FILE | stdin] [-At]: the psql of
# the SQLite harness (tests/fixture/lp_sql.py), with Django-format now(),
# dj_ts(), dj_add_days(), py_json() and uuid_hex() registered.
lp_sql() {
    local db
    db="$(lp_sqlite_path "${1:?usage: lp_sql <clone|file> [args]}")"
    shift
    "$LP_DJANGO_PY" "$(lp_win_path "$LP_FIXTURE_DIR/lp_sql.py")" "$db" "$@"
}

# Environment for a Django process on database $1 (a clone name, or a file
# path on SQLite) with BASE_DATA $2 and
# scratch directory $3. ML stays off: the fixture carries its ML rows already.
lp_django_env() {
    local db="$1" base_data="$2" run_dir="$3"
    mkdir -p "$run_dir/logs" "$run_dir/matplotlib"
    export BASE_DATA="$(lp_win_path "$base_data")"
    export PHOTOS="$BASE_DATA/data"
    export BASE_LOGS="$(lp_win_path "$run_dir/logs")"
    export MPLCONFIGDIR="$(lp_win_path "$run_dir/matplotlib")"
    export SECRET_KEY="$LP_SECRET_KEY"
    if [ "$LP_DB_BACKEND" = sqlite ]; then
        unset DB_NAME DB_USER DB_PASS DB_HOST DB_PORT
        export DB_BACKEND=sqlite LP_SQLITE_PATH="$(lp_sqlite_path "$db")"
        export DJANGO_SETTINGS_MODULE="${LP_DJANGO_SETTINGS:-lp_twin_settings_sqlite}"
    else
        export DB_BACKEND=postgresql DB_NAME="$db" DB_USER="$LP_PG_USER" DB_PASS="$PGPASSWORD"
        export DB_HOST="$LP_PG_HOST" DB_PORT="$LP_PG_PORT"
        export DJANGO_SETTINGS_MODULE="${LP_DJANGO_SETTINGS:-lp_twin_settings}"
    fi
    export PYTHONPATH="$(lp_win_path "$LP_FIXTURE_DIR")"
    export PYTHONIOENCODING=utf-8 PYTHONUTF8=1
    export FEATURE_FACE_DETECTION=0 FEATURE_FACE_CLUSTER=0 FEATURE_IMAGE_CAPTIONING=0
    export FEATURE_REVERSE_GEOCODING=0 FEATURE_SCENE_CLASSIFICATION=0
}
