#!/usr/bin/env bash
# setup.sh: two fixture clones for the end-to-end ML check, lp_run_e2e_rs
# (Rust, in-process ML) and lp_run_e2e_dj (Django + qcluster + sidecars).
# Each gets user mlcheck (password mlcheck-pw) scanning $LP_E2E_ROOT/lib/mlcheck
# (make_lib.py), OCR_MODEL=ppocrv6_small, and a BASE_DATA whose data_models is
# a junction to the shared models. Remove a junction with `cmd /c rmdir`,
# never rm -rf (that follows it into the shared models).
#
# Run from apps/backend-rs after `cargo build -p lp-server`.
set -euo pipefail
source tests/fixture/env.sh
E="${LP_E2E_ROOT:-$(cd "$LP_REPO_ROOT/.." && pwd)/rust-pg/e2e-ml}"
MODELS="$(cygpath -w "${LP_ML_ROOT:-$(cd "$LP_REPO_ROOT/.." && pwd)/rust-pg/ml}/protected_media/data_models")"
BIN=target/debug/librephotos-rs.exe
LIB="$(cygpath -w "$E/lib/mlcheck")"

for side in rs dj; do
    db="lp_run_e2e_$side"
    mkdir -p "$E/$side/protected_media" "$E/$side/logs"
    if [ ! -e "$E/$side/protected_media/data_models" ]; then
        MSYS_NO_PATHCONV=1 cmd /c mklink /J "$(cygpath -w "$E/$side/protected_media/data_models")" "$MODELS" >/dev/null
    fi
    lp_psql -d postgres -c "DROP DATABASE IF EXISTS $db WITH (FORCE)"
    lp_psql -d postgres -c "CREATE DATABASE $db TEMPLATE $LP_FIXTURE_TEMPLATE"
    (
        export BASE_DATA="$(cygpath -m "$E/$side")" BASE_LOGS="$(cygpath -m "$E/$side/logs")" \
            SECRET_KEY="$LP_SECRET_KEY" DB_NAME="$db" DB_USER="$LP_PG_USER" DB_PASS="$PGPASSWORD" \
            DB_HOST="$LP_PG_HOST" DB_PORT="$LP_PG_PORT"
        "$BIN" adopt >"$E/$side/logs/adopt.log" 2>&1
        ADMIN_PASSWORD=mlcheck-pw "$BIN" createadmin mlcheck mlcheck@example.com
    )
    lp_psql -d "$db" <<SQL
UPDATE api_user SET scan_directory = '$LIB' WHERE username = 'mlcheck';
DELETE FROM constance_constance WHERE key = 'OCR_MODEL';
INSERT INTO constance_constance (key, value) VALUES ('OCR_MODEL', '{"__type__": "default", "__value__": "ppocrv6_small"}');
INSERT INTO site_settings (key, value) VALUES ('OCR_MODEL', '"ppocrv6_small"')
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
SQL
done
