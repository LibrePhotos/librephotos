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
- **API Server (Gunicorn)**: Runs automatically in container
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
   This installs `libvips-dev`, `libimage-exiftool-perl`, `libmagic1`, and all Python
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

**On Windows (native dev box, no Docker):** the full pinned dependency set installs
natively on Python 3.11 from prebuilt wheels — see `requirements.windows.txt`, which
reuses every pin from `requirements.txt`/`requirements.dev.txt` and only swaps in the
Windows-friendly variants (`pyvips[binary]`, `python-magic-bin`, `psycopg[binary]`,
and the llama-cpp-python CPU wheel index). One-time setup + run:

```powershell
# requires Python 3.11 (winget install --id Python.Python.3.11) and winget
./scripts/setup_windows.ps1          # venv .venv-win + deps + exiftool/ImageMagick + libmagic shim
./scripts/run_tests_windows.ps1                              # whole suite (in-memory SQLite)
./scripts/run_tests_windows.ps1 api.tests.test_photo_metadata
```

Notes: `insightface` has no prebuilt wheel and compiles from sdist, so an MSVC v143
C++ toolchain (Visual Studio 2022 / Build Tools) must be present. `exiftool.exe` is
required (migration 0009 starts it at test-DB setup). `python-magic` needs the bundled
`libmagic.dll` ahead of Git-for-Windows' MSYS one on PATH — `setup_windows.ps1` writes
a venv shim (`_lp_win_magic_shim.pth`) that handles this automatically. `gunicorn`
installs but can't serve on Windows (no `fcntl`); use `manage.py runserver` for a dev
server.

*Lightweight alternative (no native deps / no C++ compiler):* install
`requirements.windows-test.txt` (pure-Python subset) and run with
`DJANGO_SETTINGS_MODULE=librephotos.settings.test_windows`, which stubs the native/ML
modules (`magic`, `pyvips`, `torch`, `insightface`, ...) via a meta-path finder so the
app imports and the pure-Python logic tests run. Tests that exercise real native
behaviour are expected to fail under the stubs.

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
- **ML Framework**: PyTorch for machine learning models

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
- `clip_embeddings/` - CLIP model for semantic search
- `face_recognition/` - Face detection and recognition
- `image_captioning/` - Image captioning (im2txt, BLIP)
- `thumbnail/` - Thumbnail generation
- `llm/` - LLM integration for chat features
- `tags/` - Tag extraction (places365)
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
- `WEB_CONCURRENCY` - Gunicorn worker count

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

