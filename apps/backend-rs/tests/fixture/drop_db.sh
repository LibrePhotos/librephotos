#!/usr/bin/env bash
# drop_db.sh <db> [media_dir]
#
# Drop a clone made by clone_db.sh (and its media copy). Only databases whose
# name starts with an LP_CLONE_PREFIXES entry are dropped, never the template.
# LP_DB_BACKEND=sqlite deletes $LP_SQLITE_CLONES/<db>.sqlite3 (+ -wal, -shm).
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/env.sh"

db="${1:?usage: drop_db.sh <db> [media_dir]}"
media_dir="${2:-}"
prefixes="${LP_CLONE_PREFIXES:-lp_t_ lp_twin_ lp_mut_ lp_run_}"

allowed=0
for prefix in $prefixes; do
    case "$db" in "$prefix"*) allowed=1 ;; esac
done
if [ "$allowed" != 1 ]; then
    echo "refusing to drop $db: name must start with one of: $prefixes" >&2
    exit 1
fi

if [ -n "$media_dir" ]; then
    case "$(cygpath -m "$media_dir")/" in
        "$(cygpath -m "$LP_FIXTURE_ROOT")/"*) echo "refusing to delete the fixture tree" >&2; exit 1 ;;
    esac
fi

if [ "$LP_DB_BACKEND" = sqlite ]; then
    case "$db" in */*|*\\*) echo "refusing to drop $db: pass a clone name, not a path" >&2; exit 1 ;; esac
    target="$(lp_sqlite_path "$db")"
    rm -f "$target" "$target-wal" "$target-shm" "$target-journal"
else
    lp_psql -d postgres -c "DROP DATABASE IF EXISTS \"$db\" WITH (FORCE)"
fi
if [ -n "$media_dir" ]; then
    rm -rf "$media_dir"
fi
