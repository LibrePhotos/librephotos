-- SQLite twin of rotate_media.sql (run_suite.sh, LP_DB_BACKEND=sqlite).
UPDATE api_user SET save_metadata_to_disk = 'MEDIA_FILE' WHERE username = 'alice';
