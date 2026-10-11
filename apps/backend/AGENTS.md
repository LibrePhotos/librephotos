# LibrePhotos backend

Django 5.2 + DRF on Postgres (SQLite for tests, the Windows dev server and the standalone build),
background jobs on django-q2, and ML in separate Flask sidecars running ONNX Runtime.

## Commands

Run from `apps/backend`, normally inside the container (`docker exec -it backend bash`).

- Tests: `python manage.py test api.tests nextcloud`; one module: `python manage.py test api.tests.metadata.test_photo_metadata`
- Lint and format: `ruff check .` and `ruff format .` (ruff is pinned; use the version from `requirements.dev.txt`)
- Types: `python scripts/typecheck.py` (mypy + django-stubs; `mypy-baseline.txt` is empty and must stay empty)
- Migrations: `python manage.py makemigrations`, committed with the model change; `api/tests/migrations/test_migrations_in_sync.py` fails the suite while a model change has no migration

Without Docker, install with `bash scripts/setup_test_env.sh` inside an activated venv and run tests with
`BASE_LOGS=/tmp/librephotos/logs BASE_DATA=/tmp/librephotos SECRET_KEY=x DJANGO_SETTINGS_MODULE=librephotos.settings.test_sqlite`.
Never export `PHOTOS` in that shell: a registration test creates and deletes `<PHOTOS>/family`.

Windows, natively: Python 3.11, `py -3.11 -m venv .venv-win` and
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
- Scope photo queries through the manager: `Photo.objects.owned_by(user)` to write,
  `Photo.visible.visible_to(user)` to read. An inline `owner=` filter or a `Photo.objects.all()`
  queryset on a related field is a cross-tenant leak waiting to happen.
- In views, get the user with `api.request_user.request_user(request)` (401 if anonymous) and a JSON
  body with `api.request_data.request_dict(request)` (400 if it is not an object). Where anonymous
  access is allowed, narrow with `isinstance(request.user, User)`. A `get_queryset` that needs a
  user returns `Model.objects.none()` when `getattr(self, "swagger_fake_view", False)`.
- Errors use the DRF exception handler's shape, `{"errors": [{"field", "message"}]}`: raise DRF
  exceptions instead of building error bodies.
- Background work: create the `LongRunningJob` row (`LongRunningJob.create_job`) and queue a plain
  function with `django_q.tasks.AsyncTask` or `Chain` (example: `api/all_tasks.py`). There is no
  `@shared_task`.
- Logging: `logger = logging.getLogger(__name__)`, lazy `%` arguments, never f-strings; carry the job id,
  user id or `image_hash`, never usernames, paths or captions above DEBUG. Details: `CONTRIBUTING.md`.
- Migrations 0001-0100 are squashed into `0001_squashed_0100`. Keep its `replaces` and depend on it,
  not on the old names.
- Configuration: app code reads `django.conf.settings`. Settings modules read variables through
  `librephotos/env.py` (`env_str`, `env_flag`, `env_int`, `env_float`, `env_list`), and so do the
  entry points and sidecars that have no settings and the one-off `ADMIN_PASSWORD` in management
  commands. Ruff TID251 bans `os.environ` and `os.getenv` elsewhere (exceptions in `pyproject.toml`).
  Document every user-facing variable on
  `apps/docs/docs/installation/environment-variables.md`.

## Layout

- `api/`: models, serializers, views, `management/commands/`, `migrations/`, `tests/` (grouped by area,
  e.g. `api/tests/metadata/`), plus domain modules (`directory_watcher/` is the scan pipeline,
  `geocode/`, `metadata/`, `stacks/`).
- `librephotos/`: `urls.py` and the settings modules `production` (Docker), `production_noproxy`,
  `development`, `dev_windows`, `standalone`, `test` and `test_sqlite`.
- `service/`: the sidecars `thumbnail`, `face_recognition`, `image_captioning`, `exif`, `tags`
  (OpenCLIP: tags, search and similar-photo embeddings) and `ocr`; `image_similarity/` is the
  seventh (FAISS index). Ports live in `SERVICES` in `api/sidecars.py`; call them through
  `api.sidecars.post`/`get`. Sidecars never import Django.
- `chunked_upload/` is a vendored app; `nextcloud/` the Nextcloud import.

## Adding an ML model or sidecar

1. Add the model files to `ML_MODELS` in `api/ml_models.py` (downloads and checksums).
2. Put the sidecar in `service/<name>/main.py` using `service._common.create_app`, exposing `serve()`
   (the Windows standalone build calls it).
3. Register its port in `SERVICES` (`api/sidecars.py`) and its feature flag in `SERVICE_FEATURE_FLAGS`
   (`api/services.py`).
4. Document its `FEATURE_*` and model-directory variables on the environment-variables docs page.

OpenCLIP ViT-B/32 (`service/tags/openclip/`, registry entry `openclip_vitb32`) is the only image-text
model. `scripts/build_openclip_onnx.py` builds its ONNX bundle in a throwaway torch venv and
`scripts/calibrate_openclip.py` sets its thresholds; `OPENCLIP_MODEL_DIR` points the sidecar and the
golden tests at a local bundle.

## Windows standalone build

`scripts/build_standalone.py --zip` (needs `requirements.standalone.txt`, MSVC and Node 24) compiles
`librephotos_standalone.py` with Nuitka into one `librephotos.exe` that runs the server, qcluster and
every sidecar (`librephotos/standalone.py` dispatches on `run`/`manage`/`service`) with
`librephotos.settings.standalone`. `.github/workflows/standalone-windows.yml` builds it in CI.
