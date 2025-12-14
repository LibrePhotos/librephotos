# LibrePhotos Backend Agent Guidelines

## Build & Development Commands

**Note:** All commands should be run inside the backend Docker container (`docker exec -it backend bash`).

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
- **Run All Tests**: `python manage.py test api.tests`
- **Run Specific Test**: `python manage.py test api.tests.test_module`
- **Run with Verbosity**: `python manage.py test api.tests -v 2`

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

