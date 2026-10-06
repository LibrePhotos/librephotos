-- SQLite twin of rotate_sidecar.sql (run_suite.sh, LP_DB_BACKEND=sqlite).
UPDATE api_user SET save_metadata_to_disk = 'SIDECAR_FILE' WHERE username = 'alice';
