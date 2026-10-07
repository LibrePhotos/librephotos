# Tasks differential runs

The `lp-tasks` jobs have no HTTP surface, so their parity check is a state
diff: the same background task runs on two clones of `lp_fixture` (each with
its own media copy), Django's code on one, Rust's on the other, both against
the same deterministic sidecar mock; then the databases and media trees are
compared.

| File | Role |
| --- | --- |
| `mock_sidecars.py` | face, CLIP, tags, OCR, caption, similarity and Nominatim stand-ins; answers depend only on the file's base name |
| `start_services.sh` | the mock on 18120 and the real `sidecars/face_cluster` on 18121 (foreground; stop by PID) |
| `django_tasks.py` | runs one Django task inline: sidecar URLs at the mock, the exif sidecar's code in-process, Nominatim at the mock, django-q tasks inline |
| `crates/lp-tasks/tests/differential.rs` | the Rust side (`#[ignore]`d; env-driven) |
| `compare.py` | `api_*` diff with natural keys for rows numbered by creation order (albums, persons, clusters, faces, jobs) |
| `run_diff.sh` | clones, runs both, compares, drops the clones |

```bash
apps/backend-rs/tests/tasks/start_services.sh &      # once
cd apps/backend-rs
tests/tasks/run_diff.sh classify media.classify alice
tests/tasks/run_diff.sh ocr ocr.generate alice --setting OCR_MODEL=pp_ocrv5_mobile
tests/tasks/run_diff.sh clip clip.embed alice
tests/tasks/run_diff.sh geo geo.locate alice
tests/tasks/run_diff.sh faces faces.scan alice        # + embeddings, HDBSCAN, MLP training
tests/tasks/run_diff.sh cluster faces.cluster alice
tests/tasks/run_diff.sh train faces.train alice
LP_DIFF_IGNORE=api_photo_search.search_captions LP_DIFF_COUNT_ONLY=api_albumthing_cover_photos \
  tests/tasks/run_diff.sh tags tags.generate alice
P=<photo uuid>; LP_DIFF_PHOTO=$P tests/tasks/run_diff.sh caption captions.generate alice --photo $P
# a starting state on both clones, own clone names:
LP_DIFF_PREFIX=rs_rev_tasks_ LP_DIFF_PRESQL="UPDATE api_albumdate SET location = NULL" \
  tests/tasks/run_diff.sh geo geo.locate alice
```

The TypeScript server (`apps/backend-ts`) runs on the same harness with
`LP_DIFF_SUT=ts`: the TS side is `bun run src/cli.ts run-job <kind> <payload>`
(sidecars at the mock through `LP_SIDECAR_<NAME>_URL`, Nominatim through
`LP_GEOCODE_NOMINATIM_URL`), e.g.

```bash
LP_DIFF_SUT=ts LP_DIFF_PREFIX=lp_t_tstsk_ LP_TASKS_MOCK_PORT=18130 LP_TASKS_FC_PORT=18131   tests/tasks/run_diff.sh faces faces.scan alice
```

Known, accepted differences:

- Job error texts: Django appends a Python traceback.
- Face crops: another JPEG encoder (sizes differ), and Django's random
  `_xxxxxxx` suffix when a crop name is taken.
- `search_captions` after tags or a caption: Django rebuilds it from the rows
  as stored *before* saving the new tags/caption, so they only become
  searchable on a later rebuild; Rust rebuilds after the change.
- Thing-album covers: both top up to 4, but which photos depends on the
  order photos were processed; compare counts (`LP_DIFF_COUNT_ONLY`).
