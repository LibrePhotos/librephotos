# LibrePhotos backend

Django 5.2 + DRF on Postgres (SQLite for tests, the Windows dev server and the standalone build),
background jobs on django-q2, and ML in separate Flask sidecars running ONNX Runtime.

## Commands

Run from `apps/backend`, normally inside the container (`docker exec -it backend bash`).

- Tests: `python manage.py test api.tests nextcloud`; one module: `python manage.py test api.tests.metadata.test_photo_metadata`
- Lint and format: `ruff check .` and `ruff format .` (ruff is pinned; use the version from `requirements.dev.txt`),
  then `python scripts/ruff_baseline.py` (fails on stale entries in `ruff-baseline.toml`)
- Types: `python scripts/typecheck.py` (mypy + django-stubs; `mypy-baseline.txt` is empty and must stay empty)
- Dead code: `python scripts/check_dead_code.py` (vulture, pinned in `requirements.dev.txt`; runs in CI)
- Import layers: `lint-imports` (import-linter, pinned in `requirements.dev.txt`; runs in CI), see Layout
- Migrations: `python manage.py makemigrations`, committed with the model change; `api/tests/migrations/test_migrations_in_sync.py` fails the suite while a model change has no migration

Without Docker, install with `bash scripts/setup_test_env.sh` inside an activated venv and run tests with
`BASE_LOGS=/tmp/librephotos/logs BASE_DATA=/tmp/librephotos SECRET_KEY=x DJANGO_SETTINGS_MODULE=librephotos.settings.test_sqlite`.
Never export `PHOTOS` in that shell: a registration test creates and deletes `<PHOTOS>/family`.

Windows, natively: Python 3.11 (the prebuilt Windows wheels are cp311), `py -3.11 -m venv .venv-win` and
`pip install -r requirements.txt -r requirements.dev.txt` (the Windows wheels come from the
`windows-wheels-*` release via markers in `requirements.txt`). `scripts/dev_windows.ps1 -DataDir C:\devdata`
starts the exif sidecar, qcluster and uvicorn on :8000 with `librephotos.settings.dev_windows`. ML
sidecars are off there: set `FEATURE_<NAME>=1` and run `python manage.py start_service <name>`; they find
their models under `$BASE_DATA/protected_media/data_models`. A failing
test makes `--parallel` runs crash with "cannot pickle 'traceback'"; rerun that package serially.

## Rules

- Type everything. Every function is annotated; no `# type: ignore`, no bare `Any` in an annotation
  (ruff ANN401), `cast` only with a comment saying why the stubs are wrong. Never run
  `scripts/typecheck.py --update` to accept new errors.
- Ruff findings that predate a rule live in the generated `ruff-baseline.toml`, which only shrinks: run
  `python scripts/ruff_baseline.py --update` after a fix, never to absorb a new finding, and add no `# noqa`
  for a baselined code. Exceptions and banned APIs (TID251) go in `pyproject.toml` under
  `extend-per-file-ignores` (a `per-file-ignores` table there would drop the baseline).
- Supported Python is `requires-python` in `pyproject.toml` (ruff targets its floor). Code must run on the
  floor, 3.10, the backend-gpu image; `test-backend.yml` runs the suite on each image's Python, and
  `api/tests/infra/test_python_versions.py` fails when an image, workflow or requirements marker leaves the range.
- Scope owned rows through the manager (`api/models/scopes.py`), never an inline `owner=`/`cluster_owner=`/
  `started_by=`/`photo__owner=` filter: `Model.objects.owned_by(user)` or `get_owned(user, id=...)` to
  write, `owned_or_shared_to(user)` for owned plus shared rows, `owner_q(user, through=...)` inside one
  `filter()` or annotation, and `Photo.visible.visible_to(user)` to read photos. A `Photo.objects.all()`
  queryset on a related field is a cross-tenant leak too. `api/tests/infra/test_owner_scope_calls.py`
  fails on a new inline filter (`owner_scope_baseline.txt` only shrinks); a new read route gets a case in
  `api/tests/sharing_and_public/test_cross_tenant_reads.py`, a mutating one in `test_cross_tenant_writes.py`.
- Every API view sets `permission_classes` or `get_permissions()` itself or in a project base class
  it names; the `IsAuthenticated` default is only a safety net. A role is a permission class
  (`IsAdminUser`, `IsSuperUser` from `api/accounts/permissions.py`), never an `is_staff` check that returns a
  response. An anonymous endpoint that takes credentials gets a throttle from `api/accounts/throttling.py`,
  and a view that accepts Basic credentials names `ThrottledBasicAuthentication` (`api/accounts/authentication.py`),
  never DRF's `BasicAuthentication`: each Basic request is a password check.
  `api/tests/infra/test_api_conventions.py` enforces all of these.
- Auth cookies (`jwt`, `access`, `refresh`) are set and cleared only through `set_auth_cookies`/
  `clear_auth_cookies` in `api/accounts/cookies.py`, so they keep one set of flags (HttpOnly `jwt`,
  SameSite=Lax, Secure on HTTPS or `AUTH_COOKIE_SECURE`); CORS headers are django-cors-headers' job.
  `api/tests/infra/test_auth_cookies.py` fails on `set_cookie`/`delete_cookie` anywhere else.
- In views, get the user with `api.drf.request_user.request_user(request)` (401 if anonymous). Where anonymous
  access is allowed, narrow with `isinstance(request.user, User)`. A `get_queryset` that needs a
  user returns `Model.objects.none()` when `getattr(self, "swagger_fake_view", False)`.
- A view reads its input only through a serializer: a `*Query`/`*Request` `serializers.Serializer` in
  `api/serializers/`, read with `parse_query(request, XQuery)` or `parse_body(request, XRequest)` from
  `api/drf/params.py` (a missing or malformed field is a 400 naming it, never a 500), and the same
  class in `@extend_schema(parameters=[XQuery])` / `request=XRequest`. Clamp numbers with its
  `ClampedIntegerField`; example: `DuplicateListView` and `DetectDuplicatesView` in `api/views/duplicates.py`.
  `RequestParsingGuardTest` (`api/tests/infra/test_api_conventions.py`) fails on a hand read of
  `request.data`/`query_params`/`GET`/`POST` in any view module (no baseline).
- A view declares its response (a `serializer_class`, or `@extend_schema(responses=...)` on an
  `APIView`) and a `SerializerMethodField` getter a precise return type (a `TypedDict`, `list[str]`) or
  `@extend_schema_field`; then regenerate the committed `openapi.json` with `python scripts/openapi_schema.py`
  and update the zod schema and its `contract-map.ts` entry in `packages/api-client`, which compares the
  two. CI (`test-backend.yml`) fails on a stale `openapi.json` and on a new drf-spectacular report
  (`openapi-baseline.txt` is empty and only shrinks); `api/tests/infra/test_serializer_method_annotations.py` fails on
  a shapeless getter.
- Names follow `apps/docs/docs/development/glossary.md`: JSON keys (serializer fields, dict keys, query
  parameters) are snake_case, a new route takes a photo as `Photo.id` in a `photo_id` argument (never
  `image_hash`), and "tag" means the user's `Tag` while OpenCLIP output is a "thing".
  `api/tests/infra/test_api_naming.py` fails on a new camelCase key or `image_hash` route; its legacy lists only shrink.
- An integer primary key goes out as a number: never redeclare `id` as a `SerializerMethodField` or
  `CharField` returning `str(obj.id)` (`api/tests/infra/test_integer_primary_keys.py`). Clients read the
  string some older servers send with `IntegerId` (`packages/api-client/src/schemas/common.ts`).
- A viewset is `viewsets.GenericViewSet` plus only the mixins of the actions a client calls (PATCH
  alone: `PartialUpdateModelMixin` from `api/views/mixins.py`), never `ModelViewSet` or an
  `http_method_names` blocklist. Pin a new route's verbs in `ROUTER_VERBS`
  (`api/tests/infra/test_api_conventions.py`); a mutating one also needs a case in
  `api/tests/sharing_and_public/test_cross_tenant_writes.py`, or its exact route in `NOT_PHOTO_SCOPED`
  with the reason (a prefix entry never covers the routes below it).
- Lists page one way: `api.drf.pagination.DefaultPagination` (`page`/`page_size`, 100 a page, at most 1000,
  envelope `{count, next, previous, results, page, page_size, num_pages}`) or a preset of it from
  `api/drf/pagination.py` (page size only), through `self.paginate_queryset()` (`PaginatedViewMixin` on an
  `APIView`); never Django's `Paginator` or a hand-sliced page. A list that answers every row says
  `pagination_class = None` and goes into `UNPAGINATED_LIST_VIEWS` with the reason; `PaginationConventionTest`
  (`api/tests/infra/test_api_conventions.py`) enforces it. Clients that need a whole list follow `next`
  (`fetchAllPages` in `packages/api-client`), so never lower a list's page size without checking its readers.
- A list endpoint costs the same number of queries for 2 rows as for 1000: list serializers never query.
  They read relations and annotations loaded by a `with_*_relations()` function next to the serializer
  (`with_photo_summary_relations`, `with_user_relations`) and fail through `loaded_count`/`prefetched` in
  `api/serializers/fields.py` when one is missing. A new list route needs a fixture in `LIST_ROUTE_FIXTURES`
  (`api/tests/infra/test_list_query_counts.py`), which compares its query counts at 2 and 8 rows.
- URLs: a new route is a `path()` (or a router registration), never `re_path()`: kebab-case literal segments, a trailing slash, ids through the converters in `librephotos/converters.py`. Legacy `re_path()` routes keep both slash forms through `/?$`, and `api/tests/infra/test_url_patterns.py` fails on a new one, an unanchored route or a client path that changes view.
- Delete unused code instead of keeping aliases or wrappers for compatibility, unless an external client
  calls it. Code only tests call counts as dead; `vulture_whitelist.py` is for names called from outside
  Python (settings dotted paths, django_q schedules) and only shrinks.
- Errors: raise a DRF exception (`ValidationError`, `NotFound`, `PermissionDenied`) or one from
  `api/drf/exceptions.py` (`Conflict`, `Gone`, `UpstreamError`, `ServiceUnavailable`, ...), with `code=` when
  a client branches on it; never build an error body or a 2xx carrying `"status": False`. The handler
  (`api/views/exception_handler.py`) writes `{"errors": [{"field", "message", "code"}]}`, and
  `ErrorEnvelopeTest` (`api/tests/infra/test_api_conventions.py`) fails on an error `Response` or a
  literal `status=`. Keep an endpoint's status codes: the mobile outbox retries 5xx and drops 4xx.
- Models hold data and queries only: fields, managers, properties computed from fields, pure helpers.
  Disk, sidecar, subprocess and network work goes in the domain's service module, taking the instance
  first (`api/thumbnails/render.py`, `api/photos/files.py`, `api/metadata/photo_writer.py`), and the caller calls it;
  never add a side effect to `save()`. `api/tests/infra/test_models_do_no_io.py` fails on an I/O import or call in `api/models/`.
- Background work is queued only through `api/jobs/queue.py` (ruff TID251 bans `django_q.tasks`
  elsewhere): `enqueue_job` (user-started; writes the `LongRunningJob` row before queuing, a duplicate
  start is a 409 `job_already_running` carrying the running `job_id`), `enqueue_followup` (queued by
  a job), `enqueue_chain`, and `enqueue_task` for pieces of a running job. A new job: a `JOB_*` type
  (with its `JOB_TYPES` entry and migration), a task taking `job_id` that starts with
  `LongRunningJob.claim` and returns when it gets `None` (cancelled while queued), started from a view
  through `start_job` (`api/jobs/start.py`). Tests: `api/tests/jobs/test_job_queue.py`.
  A job row is written only through its methods (`update_progress`, `complete`, `fail`, `set_result`):
  `LongRunningJob.save()` refuses a full-row save of an existing row, which would undo a cancel made
  while the job ran, and `complete`/`fail`/`set_result` leave a cancelled row alone (return False).
  Catch `Exception`, not `BaseException`, unless the handler re-raises (`api/tests/infra/test_base_exception_handlers.py`).
- Signals: a module with receivers exposes `register()`, listed in `SIGNAL_MODULES` (`api/apps.py`), that
  connects each one with `dispatch_uid="<module>.<name>"` (a factory-built closure also `weak=False`, or it
  is garbage collected outside DEBUG); no `@receiver`. File removal goes through `transaction.on_commit`.
  Queryset `update()`/`delete()` and `bulk_create` send no signals, so callers run the
  `refresh_*_photo_counts` helpers themselves. `api/tests/infra/test_signal_receivers.py` enforces this.
- Logging: `logger = logging.getLogger(__name__)`, lazy `%` arguments, never f-strings; carry the job id,
  user id or `image_hash`, never usernames, paths or captions above DEBUG. No `print()` (ruff G004 and
  T20): settings modules use `librephotos.logging_bootstrap.defer(level, message)`, management commands
  `self.stdout.write`, sidecars `service._common.logger(name)`. Details: `CONTRIBUTING.md`.
- External tools (ffmpeg, ffprobe, ExifTool, git, nvidia-smi) run only through `api.runtime.binaries`:
  `run_tool(name, args, timeout=...)` (the timeout has no default; a hung tool fails the call, never
  the worker) or `start_tool` for a long-running stream. Ruff TID251 bans `subprocess` elsewhere
  (exceptions in `pyproject.toml`).
- Metadata write-back is tested against real ExifTool, not a mocked `write_metadata`: a new caller of
  it needs a round-trip test on `RealExifToolTestCase` (`api/tests/metadata/exiftool_harness.py`) in
  `api/tests/metadata/test_write_back_round_trip.py`, whose guard fails until it is listed there.
- A user's edit of date, location, rating, caption, keywords, title, copyright or creator goes through
  `api/metadata/edits.py`, which writes the field's one store (`Photo`, `PhotoCaption`, `PhotoMetadata`),
  records the `MetadataEdit`, refreshes search and queues the write-back; `EditPathGuardTest`
  (`api/tests/metadata/test_metadata_edits.py`) fails on a new caller that skips it.
- Migrations 0001-0100 are squashed into `0001_squashed_0100`. Keep its `replaces` and depend on it,
  not on the old names.
- Configuration: app code reads `django.conf.settings`. Settings modules read variables through
  `librephotos/env.py` (`env_str`, `env_flag`, `env_int`, `env_float`, `env_list`), and so do the
  entry points and sidecars that have no settings and the one-off `ADMIN_PASSWORD` in management
  commands. Ruff TID251 bans `os.environ` and `os.getenv` elsewhere (exceptions in `pyproject.toml`).
  Every variable read here, in the entrypoints or in `deploy/k8s`, is named on
  `apps/docs/docs/installation/environment-variables.md` or listed with a reason in `INTERNAL_ENV_VARS`
  (`api/tests/infra/test_environment_variables_documented.py`); the suite fails otherwise. A value the
  process only sets for itself needs neither.
- File types and data paths have one home each: media extension sets and their named subsets in
  `api/mime.py` (compare `extension(path)`, lower case), `protected_media` and `data_models` paths from
  `protected_media_root()`/`data_models_root()` in `librephotos/env.py`, which the sidecars import too.
  A copied literal drifts; `api/tests/infra/test_single_definitions.py` fails on one.
- A module that uses `PIL.Image` (or another PIL submodule) imports it (`import PIL.Image`); a bare `import PIL`
  only works when something else loaded it first (`api/tests/infra/test_submodule_imports.py`).

## Tests

- Build test rows with the factories in `api/tests/utils.py` (`create_test_photo`, `create_test_stack`,
  `create_test_duplicate`, `create_test_tag`, ...), not `Model.objects.create` or a private `_make_*`
  helper. A model without a factory gets one there, with a docstring. Keep the test-data rule in
  `api/tests/infra/test_test_data_factories.py`: it fails on a new raw create, and
  `api/tests/infra/test_data_baseline.txt` only shrinks (`python scripts/factory_baseline.py --update`).
- A raw create that must stay raw (a constraint test) carries `# raw-create: <reason>` on its line.
- Test modules live under `api/tests/<area>/` (or `nextcloud/`): CI runs only `manage.py test api.tests nextcloud`,
  so a `test*.py` anywhere else never runs. `api/tests/infra/test_test_suite_layout.py` fails on one and on any
  `pytest` import; the runner is Django's.
- Stub a module name or load a sidecar file only through `api/tests/stubs.py` (`stub_modules`,
  `load_backend_file`). They put back exactly what they changed; a direct `sys.modules`
  write in a test module fails the layout test (`patch.dict(sys.modules)` also drops modules imported inside it).
- Coverage: `manage.py test` records it unless `NO_COVERAGE` is set. CI's `coverage report` step fails below
  `fail_under` in `.coveragerc`. Raise the floor when the total clears it by a whole point; never lower it
  without saying why in the PR.

## Layout

- `api/`: `views/`, `serializers/`, `models/`, `management/commands/`, `migrations/`, `tests/` (grouped by
  area, e.g. `api/tests/metadata/`) and the domain packages: `accounts/` (JWT cookie auth, auth cookies,
  permission classes, throttles, allauth adapters, user deletion, public URL, mail backend), `albums/`
  (event albums, timeline filter), `classification/` (captions, document and screenshot heuristics),
  `dataviz/` (stats, chart palettes), `directory_watcher/` (the scan pipeline), `drf/` (request parsing,
  request user, API exceptions, pagination, OpenAPI schema class), `duplicates/`, `faces/` (face service
  client, detection, clustering, training, social graph, box overlap), `geocode/`, `jobs/` (the queue,
  starting a job from a request), `metadata/` (read, write, date rules, orientation), `photos/` (file type
  and hash, path containment and folder prefixes, a photo's files, file cleanup receivers, the "Select
  All" queryset, zip downloads, trash and tombstone retention), `runtime/` (sidecar ports and HTTP client,
  request timeouts, the sidecar supervisor and watchdog, model downloads, external tools; its `__init__.py`
  imports nothing, so `api.runtime.sidecars` stays Django-free), `search/` (OpenCLIP embeddings and tags,
  similarity index client, search filter, term examples), `serving/` (byte ranges, why the web server
  cannot read a file, the folder picker's directory tree), `stacks/` (bursts, brackets, Motion Photo
  video), `thumbnails/` (render, decode, strip metadata), `video/` (probe and HDR tonemapping, playback
  type, transcode cache, ffmpeg budget).
- No new flat `api/` module: new code goes into a domain package. The only flat modules are the Django and
  project conventions in `STAYS_FLAT` (`api/tests/infra/test_module_layout.py`); the list only shrinks. A move
  updates every import and `mock.patch("api.<old>...")` string and keeps no re-export shim (a patch on a
  shim misses the code under test); a moved scheduled function ships a migration rewriting `Schedule.func`,
  and a dotted path in `librephotos/settings/` is checked by `api/tests/infra/test_settings_dotted_paths.py`.
- Imports go down only: `api.views`/`nextcloud.views`, then `api.serializers`, the domain packages, then
  `api.models`; views never import `api.runtime.sidecars` directly, and `service/`, `image_similarity/`,
  `api.runtime.sidecars` and the `api` and `api.runtime` package inits never import Django. `lint-imports`
  (CI) checks these contracts, `[tool.importlinter]` in `pyproject.toml`; a new package joins the domain
  layer, and each contract's `ignore_imports` only shrinks (`scripts/import_contracts_baseline.py`).
- `librephotos/`: `urls.py` and the settings modules `production` (Docker), `production_noproxy`,
  `development`, `dev_windows`, `standalone`, `test` and `test_sqlite`.
- `service/`: the sidecars `thumbnail`, `face_recognition`, `image_captioning`, `exif`, `tags`
  (OpenCLIP: tags, search and similar-photo embeddings) and `ocr`; `image_similarity/` is the
  seventh (FAISS index). Ports live in `SERVICES` in `api/runtime/sidecars.py`; call them through
  `api.runtime.sidecars.post`/`get`. Sidecars never import Django.
- `chunked_upload/` is a vendored app; `nextcloud/` the Nextcloud import.

## Adding an ML model or sidecar

1. Add the model files to `ML_MODELS` in `api/runtime/ml_models.py` (downloads and checksums).
2. Put the sidecar in `service/<name>/main.py` using `service._common.create_app`, exposing `serve()`
   (the Windows standalone build calls it).
3. Register its port in `SERVICES` (`api/runtime/sidecars.py`) and its feature in `SERVICE_FEATURES`
   (`api/runtime/supervisor.py`). Gate optional work with `feature_enabled(...)` from `api/runtime/features.py`
   (the `FEATURE_*` env flag is a hard off, then the `*_ENABLED` site setting decides), never a direct
   `settings.FEATURE_*` read of those features (`FeatureGateCallSitesTest` in `api/tests/infra/test_feature_flag_gating.py`).
4. Document its `FEATURE_*` and model-directory variables on the environment-variables docs page.

OpenCLIP ViT-B/32 (`service/tags/openclip/`, registry entry `openclip_vitb32`) is the only image-text
model. `scripts/build_openclip_onnx.py` builds its ONNX bundle in a throwaway torch venv and
`scripts/calibrate_openclip.py` sets its thresholds; `OPENCLIP_MODEL_DIR` points the sidecar and the
golden tests at a local bundle.

## Windows standalone build

`scripts/build_standalone.py --zip` (needs `requirements.standalone.txt`, MSVC and Node 24) compiles
`librephotos_standalone.py` with Nuitka into one `librephotos.exe` that runs the server, qcluster and
every sidecar (`librephotos/standalone.py` dispatches on `run`/`manage`/`service`) with
`librephotos.settings.standalone`. `.github/workflows/standalone-windows.yml` builds it in CI, runs the zip
with `scripts/smoke_standalone.py` (server, sidecars, a scan, the shutdown; `--from-source` tries it without a
build) and only then attaches it to the release and marks the release latest; its release path is guarded by
`api/tests/infra/test_standalone_windows_workflow.py`.
