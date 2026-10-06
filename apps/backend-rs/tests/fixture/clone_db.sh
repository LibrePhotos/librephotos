#!/usr/bin/env bash
# clone_db.sh <newdb> [media_dir]
#
# Create <newdb> from the lp_fixture template. Reads can share the fixture's
# media tree. A mutation test must not write into it, so it passes media_dir:
# the tree is copied there and the absolute paths stored in the clone
# (api_file.path, api_user.scan_directory, api_photo_search.search_captions)
# are rewritten to point at the copy. Start the server with
# LP_MEDIA_ROOT=<media_dir> (see run_django.sh).
#
# LP_DB_BACKEND=sqlite: <newdb> is a clone name ($LP_SQLITE_CLONES/<newdb>.sqlite3)
# or a file path, and the clone is a file copy of $LP_SQLITE_TEMPLATE; the
# path rewrites run through lp_sql.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/env.sh"

db="${1:?usage: clone_db.sh <newdb> [media_dir]}"
media_dir="${2:-}"

# The UPDATEs below are plain SQL both backends accept.
rewrite_sql() {
    cat <<SQL
UPDATE api_file SET path = replace(path, '$1\\', '$2\\');
UPDATE api_user SET scan_directory = replace(scan_directory, '$1\\', '$2\\');
UPDATE api_photo_search SET search_captions = replace(search_captions, '$1\\', '$2\\');
SQL
}

if [ "$LP_DB_BACKEND" = sqlite ]; then
    target="$(lp_sqlite_path "$db")"
    template="$(lp_win_path "$LP_SQLITE_TEMPLATE")"
    case "$target" in
        "$template"|"$(lp_win_path "$LP_FIXTURE_ROOT")"/*) echo "refusing to clone into $target" >&2; exit 1 ;;
    esac
    [ -f "$template" ] || { echo "no SQLite template at $template (LP_FIXTURE_BACKEND=sqlite build_fixture.sh)" >&2; exit 1; }
    if [ -s "$template-wal" ]; then
        echo "$template has a non-empty WAL (a process has it open?); refusing to copy it" >&2
        exit 1
    fi
    mkdir -p "$(dirname "$target")"
    rm -f "$target" "$target-wal" "$target-shm" "$target-journal"
    cp "$template" "$target"
    if [ -n "$media_dir" ]; then
        mkdir -p "$media_dir"
        cp -r "$LP_FIXTURE_ROOT/data" "$LP_FIXTURE_ROOT/protected_media" "$media_dir/"
        rewrite_sql "$(cygpath -w "$LP_FIXTURE_ROOT")" "$(cygpath -w "$media_dir")" | lp_sql "$target"
        echo "cloned $target with its own media tree at $media_dir"
    else
        echo "cloned $target (media shared read-only from $LP_FIXTURE_ROOT)"
    fi
    exit 0
fi

case "$db" in
    "$LP_FIXTURE_TEMPLATE"|"$LP_FIXTURE_BUILD_DB"|lp_django|postgres|template0|template1)
        echo "refusing to clone into $db" >&2; exit 1 ;;
esac

lp_psql -d postgres -c "CREATE DATABASE \"$db\" TEMPLATE \"$LP_FIXTURE_TEMPLATE\""

if [ -n "$media_dir" ]; then
    mkdir -p "$media_dir"
    cp -r "$LP_FIXTURE_ROOT/data" "$LP_FIXTURE_ROOT/protected_media" "$media_dir/"
    old_root="$(cygpath -w "$LP_FIXTURE_ROOT")"
    new_root="$(cygpath -w "$media_dir")"
    rewrite_sql "$old_root" "$new_root" | lp_psql -d "$db"
    echo "cloned $db with its own media tree at $media_dir"
else
    echo "cloned $db (media shared read-only from $LP_FIXTURE_ROOT)"
fi
