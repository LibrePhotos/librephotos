#!/usr/bin/env bash
# Build the fixture pack from scratch: a fresh Django-migrated database seeded
# by `manage.py seed_fixture`, turned into the template database lp_fixture,
# plus the media tree and manifest.json under $LP_FIXTURE_ROOT.
#
# Rebuilding replaces the media tree in place. Clones made from the previous
# template keep working because the build is deterministic (same paths, same
# hashes, same UUIDs), but stop any server reading the tree while it runs.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/env.sh"

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
