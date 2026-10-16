# 05 · Teardown benchmark, run 2 (2026-10-16)

Raw output of [run 38884444223](https://github.com/LibrePhotos/librephotos/actions/runs/38884444223) (commit `778bd8585`, harness `benchmarks/teardown/`), `small` profile: 370 media files, 600 s budget per tool, one `ubuntu-latest` runner per job. Interpretation is in [`00-positioning.md` §10](../00-positioning.md#10-evidence-base-and-its-limits).

**Read with care**
- **One run each, on a small library.** Timing differences under about 20 % are noise until repeated.
- **Missing results:**
  - `immich (ro)` never started: every image pull from ghcr.io was rate-limited.
  - The LibrePhotos "Edits in export" column is `n/a` because the export check hit a harness bug (wrong poll path).
  - Both are fixed in the harness after this run. A run 3 has to fill them in.
- **"Found" counts are not comparable.** Each app groups duplicates and RAW+JPEG pairs its own way: 370 files hold 360 unique contents.
- **"Beyond the edited photos, with write-back on" includes the library-wide "Write metadata to files" job,** which the harness starts on purpose. On dev it wrote face boxes into every photo with a detected face.

Generated 2026-10-16T10:16:57Z on `Linux-6.17.0-1022-azure-x86_64-with-glibc2.39`. `rw` / `ro` = library mounted read-write / read-only. Write-back cells read `rating / description / keyword`: `file` = written into the original, `xmp` = XMP sidecar, `app` = the app's own sidecar format, `-` = not written anywhere. Interop scores are the share of fixtures (0 to 1) whose value the app shows after indexing; `n/a` = the convention carries no such field.

## Indexing, resources, export

| Run | Documented setup steps | Startup (s) | All photos visible (s) | All jobs done (s) | Found / expected | Idle RAM (MiB) | Peak RAM (MiB) | Peak CPU (%) | Edits in export (r/d/k) | Within 10 min |
|---|---|---|---|---|---|---|---|---|---|---|
| Immich v3.3.3 (rw) | 10 | 7.9 | 184 | 371 | 373 / 370 | 2714 | 5021 | 438 | - / - / - (0 sidecar files) | yes |
| LibrePhotos dev dev-2026-10-16 (ro) | 9 | 28.7 | 96.6 | 209 | 363 / 370 | 1984 | 2093 | 398 | n/a | yes |
| LibrePhotos dev dev-2026-10-16 (rw) | 9 | 28.3 | 107 | 214 | 363 / 370 | 1765 | 2358 | 396 | n/a | yes |
| LibrePhotos 1.3.0 (ro) | 9 | 25.2 | 102 | > 240 | 363 / 370 | 1826 | 2074 | 400 | n/a | yes |
| LibrePhotos 1.3.0 (rw) | 9 | 25.2 | 107 | > 235 | 363 / 370 | 1864 | 2127 | 399 | n/a | yes |
| PhotoPrism 261007-65faaae5d (ro) | 5 | 13.1 | 90.3 | 95.3 | 358 / 370 | 736 | 1989 | 396 | - / - / - (0 sidecar files) | yes |
| PhotoPrism 261007-65faaae5d (rw) | 5 | 17.7 | 120 | 130 | 358 / 370 | 739 | 2340 | 392 | - / - / - (0 sidecar files) | yes |

## Metadata write-back (defaults, then each write-back switch)

| Run | Round-trip | Setting | rating / description / keyword | Original rewritten | Face regions on disk (photos) |
|---|---|---|---|---|---|
| Immich v3.3.3 (rw) | default | defaults | xmp / xmp / xmp | no | n/a |
| LibrePhotos dev dev-2026-10-16 (ro) | default | defaults | - / - / - | no | n/a |
| LibrePhotos dev dev-2026-10-16 (ro) | opt-in-sidecar | save_metadata_to_disk=SIDECAR_FILE, save_face_tags_to_disk=true | - / - / - | no | 0/2 |
| LibrePhotos dev dev-2026-10-16 (ro) | opt-in-media | save_metadata_to_disk=MEDIA_FILE, save_face_tags_to_disk=true | - / - / - | no | 0/2 |
| LibrePhotos dev dev-2026-10-16 (rw) | default | defaults | - / - / - | no | n/a |
| LibrePhotos dev dev-2026-10-16 (rw) | opt-in-sidecar | save_metadata_to_disk=SIDECAR_FILE, save_face_tags_to_disk=true | xmp / xmp / xmp | no | 2/2 |
| LibrePhotos dev dev-2026-10-16 (rw) | opt-in-media | save_metadata_to_disk=MEDIA_FILE, save_face_tags_to_disk=true | file / file / file | yes | 2/2 |
| LibrePhotos 1.3.0 (ro) | default | defaults | - / - / - | no | n/a |
| LibrePhotos 1.3.0 (ro) | opt-in-sidecar | save_metadata_to_disk=SIDECAR_FILE, save_face_tags_to_disk=true | - / - / - | no | 0/2 |
| LibrePhotos 1.3.0 (ro) | opt-in-media | save_metadata_to_disk=MEDIA_FILE, save_face_tags_to_disk=true | - / - / - | no | 0/2 |
| LibrePhotos 1.3.0 (rw) | default | defaults | - / - / - | no | n/a |
| LibrePhotos 1.3.0 (rw) | opt-in-sidecar | save_metadata_to_disk=SIDECAR_FILE, save_face_tags_to_disk=true | xmp / - / - | no | 2/2 |
| LibrePhotos 1.3.0 (rw) | opt-in-media | save_metadata_to_disk=MEDIA_FILE, save_face_tags_to_disk=true | file / - / - | yes | 2/2 |
| PhotoPrism 261007-65faaae5d (ro) | default | defaults | - / app / - | no | n/a |
| PhotoPrism 261007-65faaae5d (rw) | default | defaults | - / app / - | no | n/a |

## Interop: curation from other tools visible after indexing

| Run | Convention | Found | people names | face boxes | keywords flat | keywords hierarchical | hierarchy kept | rating | caption |
|---|---|---|---|---|---|---|---|---|---|
| Immich v3.3.3 (rw) | adobe-sidecar | 1.0 | n/a | n/a | 0.0 | 1.0 | 1.0 | 1.0 | 1.0 |
| Immich v3.3.3 (rw) | both-sidecars | 1.0 | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| Immich v3.3.3 (rw) | darktable | 1.0 | n/a | n/a | 0.0 | 1.0 | 1.0 | 1.0 | 1.0 |
| Immich v3.3.3 (rw) | digikam | 1.0 | 0.0 | 0.0 | 0.0 | 1.0 | 1.0 | 1.0 | 1.0 |
| Immich v3.3.3 (rw) | lightroom-jpeg | 1.0 | n/a | n/a | 0.0 | 1.0 | 1.0 | 1.0 | 1.0 |
| Immich v3.3.3 (rw) | lightroom-raw | 1.0 | n/a | n/a | 0.0 | 1.0 | 1.0 | 1.0 | 1.0 |
| Immich v3.3.3 (rw) | windows-photo | 1.0 | 0.0 | 0.0 | 0.0 | n/a | n/a | 1.0 | 1.0 |
| LibrePhotos dev dev-2026-10-16 (ro) | adobe-sidecar | 1.0 | n/a | n/a | 1.0 | 1.0 | 0.0 | 1.0 | 1.0 |
| LibrePhotos dev dev-2026-10-16 (ro) | both-sidecars | 1.0 | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| LibrePhotos dev dev-2026-10-16 (ro) | darktable | 1.0 | n/a | n/a | 1.0 | 1.0 | 0.0 | 1.0 | 1.0 |
| LibrePhotos dev dev-2026-10-16 (ro) | digikam | 1.0 | 1.0 | 1.0 | 1.0 | 0.0 | 0.0 | 1.0 | 1.0 |
| LibrePhotos dev dev-2026-10-16 (ro) | lightroom-jpeg | 1.0 | n/a | n/a | 1.0 | 1.0 | 0.0 | 1.0 | 1.0 |
| LibrePhotos dev dev-2026-10-16 (ro) | lightroom-raw | 1.0 | n/a | n/a | 1.0 | 1.0 | 0.0 | 1.0 | 1.0 |
| LibrePhotos dev dev-2026-10-16 (ro) | windows-photo | 1.0 | 0.0 | 0.0 | 0.0 | n/a | n/a | 1.0 | 1.0 |
| LibrePhotos dev dev-2026-10-16 (rw) | adobe-sidecar | 1.0 | n/a | n/a | 1.0 | 1.0 | 0.0 | 1.0 | 1.0 |
| LibrePhotos dev dev-2026-10-16 (rw) | both-sidecars | 1.0 | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| LibrePhotos dev dev-2026-10-16 (rw) | darktable | 1.0 | n/a | n/a | 1.0 | 1.0 | 0.0 | 1.0 | 1.0 |
| LibrePhotos dev dev-2026-10-16 (rw) | digikam | 1.0 | 1.0 | 1.0 | 1.0 | 0.0 | 0.0 | 1.0 | 1.0 |
| LibrePhotos dev dev-2026-10-16 (rw) | lightroom-jpeg | 1.0 | n/a | n/a | 1.0 | 1.0 | 0.0 | 1.0 | 1.0 |
| LibrePhotos dev dev-2026-10-16 (rw) | lightroom-raw | 1.0 | n/a | n/a | 1.0 | 1.0 | 0.0 | 1.0 | 1.0 |
| LibrePhotos dev dev-2026-10-16 (rw) | windows-photo | 1.0 | 0.0 | 0.0 | 0.0 | n/a | n/a | 1.0 | 1.0 |
| LibrePhotos 1.3.0 (ro) | adobe-sidecar | 1.0 | n/a | n/a | 1.0 | 0.0 | 0.0 | 1.0 | 1.0 |
| LibrePhotos 1.3.0 (ro) | both-sidecars | 1.0 | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| LibrePhotos 1.3.0 (ro) | darktable | 1.0 | n/a | n/a | 1.0 | 0.0 | 0.0 | 1.0 | 1.0 |
| LibrePhotos 1.3.0 (ro) | digikam | 1.0 | 1.0 | 1.0 | 1.0 | 0.0 | 0.0 | 1.0 | 1.0 |
| LibrePhotos 1.3.0 (ro) | lightroom-jpeg | 1.0 | n/a | n/a | 1.0 | 0.0 | 0.0 | 1.0 | 1.0 |
| LibrePhotos 1.3.0 (ro) | lightroom-raw | 1.0 | n/a | n/a | 1.0 | 0.0 | 0.0 | 1.0 | 1.0 |
| LibrePhotos 1.3.0 (ro) | windows-photo | 1.0 | 0.0 | 0.0 | 0.0 | n/a | n/a | 1.0 | 1.0 |
| LibrePhotos 1.3.0 (rw) | adobe-sidecar | 1.0 | n/a | n/a | 1.0 | 0.0 | 0.0 | 1.0 | 1.0 |
| LibrePhotos 1.3.0 (rw) | both-sidecars | 1.0 | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| LibrePhotos 1.3.0 (rw) | darktable | 1.0 | n/a | n/a | 1.0 | 0.0 | 0.0 | 1.0 | 1.0 |
| LibrePhotos 1.3.0 (rw) | digikam | 1.0 | 1.0 | 1.0 | 1.0 | 0.0 | 0.0 | 1.0 | 1.0 |
| LibrePhotos 1.3.0 (rw) | lightroom-jpeg | 1.0 | n/a | n/a | 1.0 | 0.0 | 0.0 | 1.0 | 1.0 |
| LibrePhotos 1.3.0 (rw) | lightroom-raw | 1.0 | n/a | n/a | 1.0 | 0.0 | 0.0 | 1.0 | 1.0 |
| LibrePhotos 1.3.0 (rw) | windows-photo | 1.0 | 0.0 | 0.0 | 0.0 | n/a | n/a | 1.0 | 1.0 |
| PhotoPrism 261007-65faaae5d (ro) | adobe-sidecar | 1.0 | n/a | n/a | 1.0 | 0.0 | 0.0 | 0.0 | 1.0 |
| PhotoPrism 261007-65faaae5d (ro) | both-sidecars | 1.0 | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| PhotoPrism 261007-65faaae5d (ro) | darktable | 1.0 | n/a | n/a | 1.0 | 0.0 | 0.0 | 0.0 | 1.0 |
| PhotoPrism 261007-65faaae5d (ro) | digikam | 1.0 | 1.0 | 1.0 | 1.0 | 0.0 | 0.0 | 0.0 | 1.0 |
| PhotoPrism 261007-65faaae5d (ro) | lightroom-jpeg | 1.0 | n/a | n/a | 1.0 | 0.0 | 0.0 | 0.0 | 1.0 |
| PhotoPrism 261007-65faaae5d (ro) | lightroom-raw | 1.0 | n/a | n/a | 1.0 | 0.0 | 0.0 | 0.0 | 1.0 |
| PhotoPrism 261007-65faaae5d (ro) | windows-photo | 1.0 | 1.0 | 1.0 | 0.0 | n/a | n/a | 0.0 | 1.0 |
| PhotoPrism 261007-65faaae5d (rw) | adobe-sidecar | 1.0 | n/a | n/a | 1.0 | 0.0 | 0.0 | 0.0 | 1.0 |
| PhotoPrism 261007-65faaae5d (rw) | both-sidecars | 1.0 | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| PhotoPrism 261007-65faaae5d (rw) | darktable | 1.0 | n/a | n/a | 1.0 | 0.0 | 0.0 | 0.0 | 1.0 |
| PhotoPrism 261007-65faaae5d (rw) | digikam | 1.0 | 1.0 | 1.0 | 1.0 | 0.0 | 0.0 | 0.0 | 1.0 |
| PhotoPrism 261007-65faaae5d (rw) | lightroom-jpeg | 1.0 | n/a | n/a | 1.0 | 0.0 | 0.0 | 0.0 | 1.0 |
| PhotoPrism 261007-65faaae5d (rw) | lightroom-raw | 1.0 | n/a | n/a | 1.0 | 0.0 | 0.0 | 0.0 | 1.0 |
| PhotoPrism 261007-65faaae5d (rw) | windows-photo | 1.0 | 1.0 | 1.0 | 0.0 | n/a | n/a | 0.0 | 1.0 |

## File safety and delete

| Run | Moved/renamed (defaults) | Deleted (defaults) | Rewritten (defaults, unasked) | Created (defaults, unasked) | Beyond the edited photos, with write-back on | Permanent delete removes original | Sidecars removed | Auto trash expiry |
|---|---|---|---|---|---|---|---|---|
| Immich v3.3.3 (rw) | 0 | 0 | 0 | 0 | n/a | yes | adobe-sidecar-01-0521-looking-away-unsplash.xmp | 30 days |
| LibrePhotos dev dev-2026-10-16 (ro) | 0 | 0 | 0 | 0 | 0 rewritten, 0 created | no | - | off |
| LibrePhotos dev dev-2026-10-16 (rw) | 0 | 0 | 0 | 0 | 87 rewritten, 79 created | yes | adobe-sidecar-01-0521-looking-away-unsplash.xmp | off |
| LibrePhotos 1.3.0 (ro) | 0 | 0 | 0 | 0 | 0 rewritten, 0 created | no | - | off |
| LibrePhotos 1.3.0 (rw) | 0 | 0 | 0 | 0 | 5 rewritten, 5 created | yes | adobe-sidecar-01-0521-looking-away-unsplash.xmp | off |
| PhotoPrism 261007-65faaae5d (ro) | 0 | 0 | 0 | 0 | n/a | no | - | off |
| PhotoPrism 261007-65faaae5d (rw) | 0 | 0 | 0 | 0 | n/a | yes | adobe-sidecar-01-0521-looking-away-unsplash.xmp | off |

Errors: librephotos-dev-ro: export; librephotos-dev-rw: export; librephotos-ro: export; librephotos-rw: export
