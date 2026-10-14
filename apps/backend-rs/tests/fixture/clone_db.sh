#!/usr/bin/env bash
# clone_db.sh <newdb> [media_dir]
#
# Create <newdb> from the lp_fixture template. Reads can share the fixture's
# media tree. A mutation test must not write into it, so it passes media_dir:
# the tree is copied there and the absolute paths stored in the clone
# (api_file.path, api_user.scan_directory, api_photo_search.search_captions)
# are rewritten to point at the copy. Start the server with
# LP_MEDIA_ROOT=<media_dir> (see run_django.sh).
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/env.sh"

db="${1:?usage: clone_db.sh <newdb> [media_dir]}"
media_dir="${2:-}"

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
    lp_psql -d "$db" <<SQL
UPDATE api_file SET path = replace(path, '$old_root\\', '$new_root\\');
UPDATE api_user SET scan_directory = replace(scan_directory, '$old_root\\', '$new_root\\');
UPDATE api_photo_search SET search_captions = replace(search_captions, '$old_root\\', '$new_root\\');
SQL
    echo "cloned $db with its own media tree at $media_dir"
else
    echo "cloned $db (media shared read-only from $LP_FIXTURE_ROOT)"
fi
