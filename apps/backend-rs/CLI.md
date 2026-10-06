# `librephotos-rs` commands vs `manage.py`

Run `librephotos-rs <command> --help` for the flags. Every command reads the
same environment as `serve` (Django's variable names). Commands that queue
work need a running worker (`serve` embeds one, or `librephotos-rs worker`),
exactly as Django's need a running `qcluster`.

## Ported (same name, flags and behaviour)

| Django | Rust | Notes |
| --- | --- | --- |
| `createadmin [-u] USER EMAIL` | `createadmin [-u] USER EMAIL` | password from `ADMIN_PASSWORD`, else generated (Rust prints a generated one). |
| `createuser USER EMAIL [--password P] [--update] [--admin]` | `createuser ...` | plain user unless `--admin`; with `--admin`, `ADMIN_PASSWORD` wins over `--password`; `--update` resets the password and ignores the email. |
| `scan [-f \| -s FILE.. \| -n]` | `scan [-f \| -s FILE.. \| -n]` | queues one `scan.user` job (a `ScanPhotos` LongRunningJob the UI shows) per user except `deleted`; `-s` gives each user the files whose path starts with their scan directory (Django's string prefix test); `-n` queues `nextcloud.scan` for each user with a Nextcloud scan directory and prints the same skip/start lines. Django runs the directory walk inside the command and queues the per-group work; Rust queues the whole scan, so the command returns at once. |
| `save_metadata [--types ratings face_tags] [--user U] [--sidecar] [--media-file] [--dry-run]` | `save_metadata ...` (alias `save-metadata`) | same selection (`face_tags` alone: photos with a non-deleted face), same output lines, one ExifTool write per photo. `POST /api/savemetadata` is ported too (requester's photos; `face_tags` alone: labelled faces only; media file unless the owner's setting is `SIDECAR_FILE`, `OFF` included, as in Django). |
| `delete_expired_uploads [--interactive]` | `delete_expired_uploads ...` | chunked uploads created more than a day ago: the row and the staged `chunked_uploads/*.part` file. Django schedules it nowhere, so neither does Rust; cron it if wanted. |
| `strip_thumbnail_metadata [--dry-run]` | `strip_thumbnail_metadata ...` | WebP EXIF/XMP chunks dropped in place (atomic replace, ICC kept), MP4 thumbnails through ExifTool (`LP_EXIFTOOL`); a non-zero exit when some still carry metadata. New Rust thumbnails are ICC-only already (`LP_THUMB_KEEP`, and ffmpeg runs with `-map_metadata -1 -map_chapters -1`), so this is for libraries rendered earlier. |
| `build_similarity_index` | `build_similarity_index` | queues `similarity.build` for every user. `serve` also rebuilds stale indices at startup. |
| `clear_cache` | `clear_cache` | a no-op that prints Django's message: Django has no `CACHES` setting, so its cache is per-process `LocMemCache` and the command never reached a running server either; Rust keeps no cache outside process memory. |
| `migrate` | `migrate` / `adopt` | `adopt` takes over a Django database at api.0142-0144. |
| `qcluster` | `worker` | `serve` embeds it. |

## Not ported, on purpose

| Django | Why |
| --- | --- |
| `start_service` | the Rust worker starts and watches the opt-in Python sidecars itself (`LP_ML_<SERVICE>=sidecar`, `LP_SUPERVISE_SIDECARS`); in-process ML needs no services. |
| `start_cleaning_service`, `start_job_cleanup_service` | they only register django-q schedules; Rust's schedules are code-defined (`lp_jobs::schedules`: deleted-photo cleanup, stuck/old jobs, zip expiry, refresh-token pruning) and run by every worker. |
| `seed_fixture` | builds the Django fixture the Rust tests run against; it stays a Django tool. |
| `changepassword`, `createsuperuser` | use `createuser --update --password ...` / `createadmin -u` (`ADMIN_PASSWORD`). |
| `flushexpiredtokens` (simplejwt) | the `prune_refresh_tokens` schedule does it daily. |
| `shell`, `collectstatic`, `showmigrations`, `makemigrations`, `check`, django-extensions, constance's CLI | Django framework tooling with no Rust counterpart; site settings are edited through the API. |
