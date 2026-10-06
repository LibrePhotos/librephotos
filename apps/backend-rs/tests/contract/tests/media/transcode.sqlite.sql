-- SQLite twin of transcode.sql (run_suite.sh, LP_DB_BACKEND=sqlite).
UPDATE api_user SET transcode_videos = 1 WHERE username = 'alice';
