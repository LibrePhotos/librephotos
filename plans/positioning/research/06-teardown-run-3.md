# 06 · Teardown benchmark, run 3 (2026-10-16)

Raw output of [run 38886912397](https://github.com/LibrePhotos/librephotos/actions/runs/38886912397) (commit `597ebaa19`). Same setup as [run 2](05-teardown-run-2.md): `small` profile, 370 media files, 600 s budget per tool, one `ubuntu-latest` runner per job. All eight jobs completed. This is the first run with Immich on a read-only library and a working LibrePhotos export check.

**Read with care**
- **Timing is noisy at this size.** Immich's "All photos visible" was 184 s in run 2 and 51 s in run 3, on the same setup. Compare RAM and the functional columns (write-back, interop, delete); don't rank tools on seconds.
- **The "Edits in export" column credits ratings too generously in this run.** The rating value is the same in every round-trip, and this version of the check matched it anywhere in the zip. Description and keyword are unique per round-trip, so those cells are right. Per photo: only the photo edited in `MEDIA_FILE` mode carried its edits. Fixed in the harness after this run.
- **"Found" counts are not comparable.** Each app groups duplicates and RAW+JPEG pairs its own way.

Generated 2026-10-16T10:38:41Z on `Linux-6.17.0-1022-azure-x86_64-with-glibc2.39`. `rw` / `ro` = library mounted read-write / read-only. Write-back cells read `rating / description / keyword`: `file` = written into the original, `xmp` = XMP sidecar, `app` = the app's own sidecar format, `-` = not written anywhere. Interop scores are the share of fixtures (0 to 1) whose value the app shows after indexing; `n/a` = the convention carries no such field.

## Indexing, resources, export

| Run | Documented setup steps | Startup (s) | All photos visible (s) | All jobs done (s) | Found / expected | Idle RAM (MiB) | Peak RAM (MiB) | Peak CPU (%) | Edits in export (r/d/k) | Within 10 min |
|---|---|---|---|---|---|---|---|---|---|---|
| Immich v3.3.3 (ro) | 10 | 8.3 | 122 | 309 | 373 / 370 | 2400 | 4843 | 428 | - / - / - (0 sidecar files) | yes |
| Immich v3.3.3 (rw) | 10 | 7.3 | 50.8 | 239 | 373 / 370 | 3133 | 5319 | 410 | - / - / - (0 sidecar files) | yes |
| LibrePhotos dev dev-2026-10-16 (ro) | 9 | 34.3 | 112 | > 226 | 363 / 370 | 1784 | 2528 | 398 | - / - / - (0 sidecar files) | yes |
| LibrePhotos dev dev-2026-10-16 (rw) | 9 | 24.8 | 91.3 | 183 | 363 / 370 | 1884 | 2382 | 399 | yes / yes / - (0 sidecar files) | yes |
| LibrePhotos 1.3.0 (ro) | 9 | 25.6 | 102 | > 239 | 363 / 370 | 1828 | 2286 | 399 | - / - / - (0 sidecar files) | yes |
| LibrePhotos 1.3.0 (rw) | 9 | 25.3 | 102 | > 235 | 363 / 370 | 1800 | 2109 | 399 | yes / - / - (0 sidecar files) | yes |
| PhotoPrism 261007-65faaae5d (ro) | 5 | 10.5 | 136 | 140 | 358 / 370 | 749 | 2163 | 395 | - / - / - (0 sidecar files) | yes |
| PhotoPrism 261007-65faaae5d (rw) | 5 | 10.5 | 136 | 141 | 358 / 370 | 805 | 2235 | 399 | - / - / - (0 sidecar files) | yes |

## Metadata write-back (defaults, then each write-back switch)

| Run | Round-trip | Setting | rating / description / keyword | Original rewritten | Face regions on disk (photos) |
|---|---|---|---|---|---|
| Immich v3.3.3 (ro) | default | defaults | - / - / - | no | n/a |
| Immich v3.3.3 (rw) | default | defaults | xmp / xmp / xmp | no | n/a |
| LibrePhotos dev dev-2026-10-16 (ro) | default | defaults | - / - / - | no | n/a |
| LibrePhotos dev dev-2026-10-16 (ro) | opt-in-sidecar | save_metadata_to_disk=SIDECAR_FILE, save_face_tags_to_disk=true | - / - / - | no | 0/2 |
| LibrePhotos dev dev-2026-10-16 (ro) | opt-in-media | save_metadata_to_disk=MEDIA_FILE, save_face_tags_to_disk=true | - / - / - | no | 0/2 |
| LibrePhotos dev dev-2026-10-16 (rw) | default | defaults | - / - / - | no | n/a |
| LibrePhotos dev dev-2026-10-16 (rw) | opt-in-sidecar | save_metadata_to_disk=SIDECAR_FILE, save_face_tags_to_disk=true | xmp / xmp / xmp | no | 2/2 |
| LibrePhotos dev dev-2026-10-16 (rw) | opt-in-media | save_metadata_to_disk=MEDIA_FILE, save_face_tags_to_disk=true | file / file / - | yes | 2/2 |
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
| Immich v3.3.3 (ro) | adobe-sidecar | 1.0 | n/a | n/a | 0.0 | 1.0 | 1.0 | 1.0 | 1.0 |
| Immich v3.3.3 (ro) | both-sidecars | 1.0 | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| Immich v3.3.3 (ro) | darktable | 1.0 | n/a | n/a | 0.0 | 1.0 | 1.0 | 1.0 | 1.0 |
| Immich v3.3.3 (ro) | digikam | 1.0 | 0.0 | 0.0 | 0.0 | 1.0 | 1.0 | 1.0 | 1.0 |
| Immich v3.3.3 (ro) | lightroom-jpeg | 1.0 | n/a | n/a | 0.0 | 1.0 | 1.0 | 1.0 | 1.0 |
| Immich v3.3.3 (ro) | lightroom-raw | 1.0 | n/a | n/a | 0.0 | 1.0 | 1.0 | 1.0 | 1.0 |
| Immich v3.3.3 (ro) | windows-photo | 1.0 | 0.0 | 0.0 | 0.0 | n/a | n/a | 1.0 | 1.0 |
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
| Immich v3.3.3 (ro) | 0 | 0 | 0 | 0 | n/a | no | - | 30 days |
| Immich v3.3.3 (rw) | 0 | 0 | 0 | 0 | n/a | yes | adobe-sidecar-01-0521-looking-away-unsplash.xmp | 30 days |
| LibrePhotos dev dev-2026-10-16 (ro) | 0 | 0 | 0 | 0 | 0 rewritten, 0 created | no | - | off |
| LibrePhotos dev dev-2026-10-16 (rw) | 0 | 0 | 0 | 0 | 87 rewritten, 79 created | yes | adobe-sidecar-01-0521-looking-away-unsplash.xmp | off |
| LibrePhotos 1.3.0 (ro) | 0 | 0 | 0 | 0 | 0 rewritten, 0 created | no | - | off |
| LibrePhotos 1.3.0 (rw) | 0 | 0 | 0 | 0 | 5 rewritten, 5 created | yes | adobe-sidecar-01-0521-looking-away-unsplash.xmp | off |
| PhotoPrism 261007-65faaae5d (ro) | 0 | 0 | 0 | 0 | n/a | no | - | off |
| PhotoPrism 261007-65faaae5d (rw) | 0 | 0 | 0 | 0 | n/a | yes | adobe-sidecar-01-0521-looking-away-unsplash.xmp | off |

Errors: none
