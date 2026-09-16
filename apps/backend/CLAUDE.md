# LibrePhotos Backend Agent Guidelines

## Build & Development Commands

**Note:** Django management commands are normally run inside the backend Docker container (`docker exec -it backend bash`). For running tests outside Docker (e.g. in a CI sandbox), see the Testing section below.

### Django Management
- **Run Migrations**: `python manage.py migrate`
- **Make Migrations**: `python manage.py makemigrations`
- **Create Superuser**: `python manage.py createsuperuser`
- **Collect Static**: `python manage.py collectstatic`
- **Shell**: `python manage.py shell`
- **Custom Commands**: `python manage.py <command_name>` (see `api/management/commands/`)

### Running Services
- **API Server (uvicorn, ASGI)**: Runs automatically in container
- **Background Jobs (django-q2)**: Runs automatically via `qcluster` command
- **Image Similarity Service**: Flask app for semantic search
- **Thumbnail Service**: Separate process for image processing

### Linting & Formatting
- **Lint**: `ruff check .`
- **Format**: `ruff format .`
- **Lint + Fix**: `ruff check --fix .`

### Testing

**Inside the Docker container** (the default environment):
- **Run All Tests**: `python manage.py test api.tests`
- **Run Specific Test**: `python manage.py test api.tests.test_module`
- **Run with Verbosity**: `python manage.py test api.tests -v 2`

**Outside Docker** (e.g. in a CI sandbox or local virtualenv):

1. Install system and Python dependencies (one-time setup):
   ```bash
   bash scripts/setup_test_env.sh
   ```
   This installs perl and all Python
   packages from `requirements.txt` and `requirements.dev.txt`.

2. Run the tests using the SQLite in-memory settings and pointing the runtime
   directories to a writable location:
   ```bash
   BASE_LOGS=/tmp/librephotos/logs \
   BASE_DATA=/tmp/librephotos \
   SECRET_KEY=test-secret-key \
   DJANGO_SETTINGS_MODULE=librephotos.settings.test_sqlite \
   python manage.py test api.tests
   ```

3. Run a single test module:
   ```bash
   BASE_LOGS=/tmp/librephotos/logs \
   BASE_DATA=/tmp/librephotos \
   SECRET_KEY=test-secret-key \
   DJANGO_SETTINGS_MODULE=librephotos.settings.test_sqlite \
   python manage.py test api.tests.test_photo_metadata
   ```

   The `test_sqlite` settings module (`librephotos/settings/test_sqlite.py`) uses
   an in-memory SQLite database so no PostgreSQL instance is required.

**Natively on Windows (no Docker):** Python 3.11; everything else comes from pip. `requirements.txt`
carries the Windows variants behind `sys_platform` markers; `insightface`, `timezonefinder`,
`exiftool-bin` (ExifTool wrapped by `scripts/build_exiftool_wheel.py`; a Perl variant
serves Linux/macOS) and `ffmpeg-bin` (BtbN's GPL build, `scripts/build_ffmpeg_wheel.py`; macOS
needs `brew install ffmpeg`) come as wheels from the `windows-wheels-*` GitHub release (`.github/workflows/prebuilt-wheels.yml`
rebuilds them, including manylinux insightface wheels for the images and CI, `api/tests/infra/test_requirements_windows_wheels.py` keeps the versions in
step).

```powershell
py -3.11 -m venv .venv; .\.venv\Scripts\pip install -r requirements.txt -r requirements.dev.txt
$env:DJANGO_SETTINGS_MODULE = "librephotos.settings.test_sqlite"; $env:SECRET_KEY = "x"
$env:BASE_DATA = "$PWD\.testtmp"; $env:BASE_LOGS = "$PWD\.testtmp\logs"; $env:NO_COVERAGE = "1"
.\.venv\Scripts\python manage.py test api.tests
.\scripts\dev_windows.ps1 -DataDir C:\devdata   # dev server: exif sidecar + qcluster + uvicorn :8000
```

`dev_windows.ps1` uses `librephotos.settings.dev_windows` (SQLite on disk, Django serves
media). Uploads only get dated/thumbnailed because `qcluster` and the exif sidecar run.
ML sidecars are not started and their `FEATURE_*` flags default off there; set one to `1`
and `python manage.py start_service <name>` after downloading the models. The POSIX
permission and mount tests in `test_serving_permissions` are skipped on Windows.

Frontend against that backend: `cd apps/frontend`, copy `.env.development.example` to
`.env.development`, set `VITE_BACKEND_URL=http://localhost:8000`, then `yarn install` and
`yarn start` (Node 22). Vite proxies `/api` and `/media` so the app stays same-origin.

### Debugging
- **PDB Breakpoint**: Add `import pdb; pdb.set_trace()` in code
- **Attach to Container**: `docker attach $(docker ps --filter name=backend -q)`
- **Silk Profiler**: Access `/api/silk` (dev mode only)
- **Detach**: `Ctrl+P` then `Ctrl+Q`

## Code Style & Conventions

- **Formatting**: Ruff with 88 char line width (configured in `pyproject.toml`)
- **Imports**: Sorted by isort (via Ruff)
- **Target Python**: 3.11+
- **Framework**: Django 5.x with Django REST Framework
- **Async Jobs**: django-q2 with ORM broker
- **ML Runtime**: ONNX Runtime for every model (no PyTorch); tokenizers via the `tokenizers` package

## Project Structure

### `api/` - Main Application
- `models/` - Django ORM models (Photo, Face, Person, Album, etc.)
- `views/` - API endpoints using Django REST Framework
- `serializers/` - JSON serialization for models
- `management/commands/` - CLI commands (`python manage.py <cmd>`)
- `migrations/` - Database migrations
- `tests/` - Test suite
- `geocode/` - Reverse geocoding functionality
- `feature/` - Feature extraction utilities

### `service/` - Microservices
- `clip_embeddings/` - CLIP ViT-B/32 (ONNX) embeddings for semantic search
- `face_recognition/` - Face detection and recognition
- `image_captioning/` - Image captioning (LFM2.5-VL, ONNX; prompted with names and places)
- `thumbnail/` - Thumbnail generation
- `tags/` - Zero-shot tagging (MobileCLIP-S2, SigLIP 2; ONNX)
- `exif/` - EXIF metadata extraction

### `image_similarity/` - Similarity Search
- FAISS-based image retrieval index
- Flask REST API for similarity queries

### Key Files
- `manage.py` - Django management script
- `requirements.txt` - Python dependencies
- `pyproject.toml` - Ruff/project configuration
- `librephotos/settings/` - Django settings (base, dev, prod)
- `librephotos/urls.py` - URL routing

## Environment Variables

Key environment variables (set in Docker or `.env`):
- `DEBUG` - Enable debug mode (0 or 1)
- `SECRET_KEY` - Django secret key
- `DB_*` - Database connection settings
- `MAPBOX_API_KEY` - For map features
- `WEB_CONCURRENCY` - uvicorn worker count

## Common Patterns

### Adding a New API Endpoint
1. Create/update model in `api/models/`
2. Create serializer in `api/serializers/`
3. Create view in `api/views/`
4. Add URL in `librephotos/urls.py`
5. Run migrations if model changed

### Adding a New Background Job
1. Define task function in `api/all_tasks.py` or relevant module
2. Use `@shared_task` decorator for django-q2
3. Queue with `async_task()` or schedule in admin

### Adding a New ML Model
1. Add model loading in `api/ml_models.py`
2. Create service wrapper in `service/<model_name>/`
3. Integrate with API views as needed

