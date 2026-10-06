#!/usr/bin/env bash
# Build the fixture pack from scratch: a fresh Django-migrated database seeded
# by `manage.py seed_fixture`, turned into the template database lp_fixture,
# plus the media tree and manifest.json under $LP_FIXTURE_ROOT.
#
# Rebuilding replaces the media tree in place. Clones made from the previous
# template keep working because the build is deterministic (same paths, same
# hashes, same UUIDs), but stop any server reading the tree while it runs.
#
# LP_FIXTURE_BACKEND=sqlite builds the SQLite pack instead (default root
# rust-pg/fixture-sqlite, its own media tree): Django's DB_BACKEND=sqlite
# migrate + seed_fixture into a scratch file, then
#   $LP_FIXTURE_ROOT/lp_django.sqlite3   the empty migrated schema (api.0144)
#   $LP_FIXTURE_ROOT/lp_fixture.sqlite3  the seeded template every clone copies
# both written with VACUUM INTO, and checks that migrations/sqlite/0000_baseline.sql
# still matches the schema (sqlite_baseline.py).
set -euo pipefail
if [ -n "${LP_FIXTURE_BACKEND:-}" ]; then export LP_DB_BACKEND="$LP_FIXTURE_BACKEND"; fi
source "$(dirname "${BASH_SOURCE[0]}")/env.sh"

if [ "$LP_DB_BACKEND" = sqlite ]; then
    root="$LP_FIXTURE_ROOT"
    run_dir="$LP_RUNS_ROOT/_build_sqlite"
    build_file="$run_dir/lp_fixture_build.sqlite3"
    case "$(basename "$root")" in
        fixture*) ;;
        *) echo "refusing to wipe $root: LP_FIXTURE_ROOT must end in a directory named fixture*" >&2; exit 1 ;;
    esac
    # VACUUM INTO writes a rollback-journal file; put it back in WAL mode, as
    # Django leaves a real database (the mode is stored in the file header).
    vacuum_into() {
        rm -f "$2" "$2-wal" "$2-shm"
        "$LP_DJANGO_PY" -c "
import sqlite3, sys
c = sqlite3.connect(sys.argv[1]); c.execute('VACUUM INTO ?', (sys.argv[2],)); c.close()
c = sqlite3.connect(sys.argv[2]); c.execute('PRAGMA journal_mode=WAL'); c.close()
" "$(lp_win_path "$1")" "$(lp_win_path "$2")"
    }

    echo "[fixture] wiping $root"
    rm -rf "$root/data" "$root/protected_media" "$root/manifest.json" "$run_dir"
    rm -f "$root/lp_fixture.sqlite3" "$root/lp_django.sqlite3"
    mkdir -p "$root" "$run_dir"

    lp_django_env "$build_file" "$root" "$run_dir"
    cd "$LP_BACKEND_DIR"

    echo "[fixture] migrating $build_file"
    "$LP_DJANGO_PY" manage.py migrate --noinput -v 0
    vacuum_into "$build_file" "$root/lp_django.sqlite3"
    baseline="$LP_FIXTURE_DIR/../../migrations/sqlite/0000_baseline.sql"
    if [ -f "$baseline" ]; then
        "$LP_DJANGO_PY" "$(lp_win_path "$LP_FIXTURE_DIR/sqlite_baseline.py")" "$(lp_win_path "$root/lp_django.sqlite3")"             --check "$(lp_win_path "$baseline")" || echo "[fixture] WARNING: migrations/sqlite/0000_baseline.sql is stale" >&2
    fi

    echo "[fixture] seeding"
    "$LP_DJANGO_PY" manage.py seed_fixture --manifest "$(lp_win_path "$root/manifest.json")"

    echo "[fixture] installing template $LP_SQLITE_TEMPLATE"
    vacuum_into "$build_file" "$LP_SQLITE_TEMPLATE"
    rm -f "$build_file" "$build_file-wal" "$build_file-shm"
    echo "[fixture] done: template $LP_SQLITE_TEMPLATE, media + manifest in $root"
    exit 0
fi

build_db="$LP_FIXTURE_BUILD_DB"
template="$LP_FIXTURE_TEMPLATE"
root="$LP_FIXTURE_ROOT"
run_dir="$LP_RUNS_ROOT/_build"

case "$(basename "$root")" in
    fixture*) ;;
    *) echo "refusing to wipe $root: LP_FIXTURE_ROOT must end in a directory named fixture*" >&2; exit 1 ;;
esac

echo "[fixture] recreating database $build_db"
lp_psql -d postgres -c "DROP DATABASE IF EXISTS \"$build_db\" WITH (FORCE)"
lp_psql -d postgres -c "CREATE DATABASE \"$build_db\""

echo "[fixture] wiping $root"
rm -rf "$root/data" "$root/protected_media" "$root/manifest.json" "$root/$template.dump" "$run_dir"
mkdir -p "$root"

lp_django_env "$build_db" "$root" "$run_dir"
cd "$LP_BACKEND_DIR"

echo "[fixture] migrating"
"$LP_DJANGO_PY" manage.py migrate --noinput -v 0

echo "[fixture] seeding"
"$LP_DJANGO_PY" manage.py seed_fixture --manifest "$(lp_win_path "$root/manifest.json")"

lp_psql -d "$build_db" -c "VACUUM ANALYZE"

echo "[fixture] installing template $template"
if lp_db_exists "$template"; then
    lp_psql -d postgres -c "ALTER DATABASE \"$template\" IS_TEMPLATE false"
    lp_psql -d postgres -c "DROP DATABASE \"$template\""
fi
lp_psql -d postgres -c "ALTER DATABASE \"$build_db\" RENAME TO \"$template\""
lp_psql -d postgres -c "ALTER DATABASE \"$template\" IS_TEMPLATE true"

"$LP_PG_BIN/pg_dump.exe" -h "$LP_PG_HOST" -p "$LP_PG_PORT" -U "$LP_PG_USER" -Fc \
    -f "$(lp_win_path "$root/$template.dump")" "$template"

echo "[fixture] done: template $template, media + manifest in $root"
