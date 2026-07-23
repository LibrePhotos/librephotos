# Contributing to LibrePhotos

Thank you for your interest in contributing to LibrePhotos! This guide will help you get started with the development process.

## Table of Contents

- [Development Environment Setup](#development-environment-setup)
- [Docker & Docker Compose](#docker--docker-compose)
- [IDE Recommendations](#ide-recommendations)
- [Code Quality Standards](#code-quality-standards)
- [Logging](#logging)
- [How to Open a Pull Request](#how-to-open-a-pull-request)
- [Getting Help](#getting-help)

---

## Development Environment Setup

### Prerequisites

- **Git** - for version control
- **Docker** and **Docker Compose** - for running the development environment
- **Node.js 18+** and **Yarn** - for frontend development (optional, if developing outside Docker)
- **Python 3.11+** - for backend development (optional, if developing outside Docker)

### Step 1: Clone the Monorepo

Create a directory for the project and clone the LibrePhotos monorepo. All apps (backend, frontend, mobile, docs) and the deploy configs live in a single repository.

**Linux/macOS:**
```bash
export codedir=~/dev
mkdir -p $codedir
cd $codedir

git clone https://github.com/LibrePhotos/librephotos.git
cd librephotos
```

**Windows (PowerShell):**
```powershell
$Env:codedir = "$HOME\dev"
New-Item -ItemType Directory -Force -Path $Env:codedir
Set-Location $Env:codedir

git clone https://github.com/LibrePhotos/librephotos.git
Set-Location librephotos
```

### Step 2: Configure Environment

Navigate to the `deploy/compose` directory and create your `.env` file:

```bash
cd deploy/compose
cp librephotos.env .env
```

Edit the `.env` file and set these critical variables:

```bash
# Path to your photo library (for testing)
scanDirectory=/path/to/your/test/photos

# Path to LibrePhotos data
data=./librephotos/data

# IMPORTANT: Path to the monorepo checkout
codedir=~/dev/librephotos
```

### Step 3: Start the Development Environment

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d
```

This command:
- Builds development images with hot-reload enabled
- Mounts your local source code into the containers
- Starts all required services (backend, frontend, database, proxy)

Access LibrePhotos at: **http://localhost:3000**

### Rebuilding After Dependency Changes

If you add new dependencies to `requirements.txt` or `package.json`:

```bash
# Rebuild backend
docker compose -f docker-compose.yml -f docker-compose.dev.yml build --no-cache backend

# Rebuild frontend
docker compose -f docker-compose.yml -f docker-compose.dev.yml build --no-cache frontend

# Restart containers
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d
```

---

## Docker & Docker Compose

### Architecture Overview

LibrePhotos uses a microservices architecture with four main containers:

| Container   | Purpose                                              |
|-------------|------------------------------------------------------|
| `backend`   | Django API server, ML models, background jobs        |
| `frontend`  | React web application                                |
| `proxy`     | Nginx reverse proxy, serves static files             |
| `db`        | PostgreSQL database                                  |

### Useful Docker Commands

```bash
# View running containers
docker compose ps

# View logs (all containers)
docker compose -f docker-compose.yml -f docker-compose.dev.yml logs -f

# View logs (specific container)
docker compose -f docker-compose.yml -f docker-compose.dev.yml logs -f backend

# Restart a container
docker compose -f docker-compose.yml -f docker-compose.dev.yml restart backend

# Stop all containers
docker compose -f docker-compose.yml -f docker-compose.dev.yml down

# Stop and remove volumes (fresh start)
docker compose -f docker-compose.yml -f docker-compose.dev.yml down -v

# Execute command in container
docker exec -it backend bash
docker exec -it frontend sh

# Run Django management commands
docker exec -it backend python manage.py migrate
docker exec -it backend python manage.py createsuperuser
```

### Development vs Production

| Aspect            | Development (`docker-compose.dev.yml`)              | Production (`docker-compose.yml`)    |
|-------------------|-----------------------------------------------------|--------------------------------------|
| Source code       | Mounted from local filesystem                       | Built into image                     |
| Hot reload        | ✅ Enabled                                           | ❌ Disabled                           |
| Debug mode        | ✅ `DEBUG=1`                                         | ❌ `DEBUG=0`                          |
| Build time        | Longer (builds from source)                         | Fast (pulls pre-built images)        |
| Additional tools  | pgAdmin available on port 3001                      | Minimal                              |

---

## IDE Recommendations

### VS Code (Recommended)

VS Code is the recommended IDE with excellent Docker and Python support.

**Recommended Extensions:**
- **Python** - Python language support
- **Pylance** - Fast Python language server
- **Docker** - Docker container management
- **Remote - Containers** - Develop inside Docker containers
- **ESLint** - JavaScript/TypeScript linting
- **Prettier** - Code formatting

**Workspace Settings:**

The repository includes VS Code settings in `deploy/vscode/settings.json` that are automatically mounted into the backend container.

**Attaching to Backend Container:**

For the best development experience, you can attach VS Code directly to the running backend container:

1. Install the "Remote - Containers" extension
2. Open Command Palette (`Ctrl+Shift+P`)
3. Run "Remote-Containers: Attach to Running Container"
4. Select the `backend` container
5. Open the `/code` folder

### PyCharm

PyCharm Professional supports Docker interpreters natively:

1. Go to Settings → Project → Python Interpreter
2. Add Interpreter → On Docker Compose
3. Select the `docker-compose.yml` and `docker-compose.dev.yml` files
4. Choose the `backend` service

### Other IDEs

Any IDE with Python and TypeScript support will work. Key requirements:
- Python 3.11+ interpreter support
- ESLint/Prettier integration for frontend
- Docker integration (optional but helpful)

---

## Code Quality Standards

### Backend (Python/Django)

**Linting and Formatting:**

We use `ruff` for linting and formatting (configured in `pyproject.toml`). The
version is pinned in `pyproject.toml` (`required-version`) so that everyone gets
the same findings — install the version from `requirements.dev.txt`, any other
one refuses to run:

```bash
# Inside the backend container
cd /code
pip install "$(grep ^ruff== requirements.dev.txt)"
ruff check .
ruff format .
```

**Pre-commit Hooks:**

Install pre-commit hooks for automatic formatting:

```bash
pip install pre-commit
pre-commit install
```

**Code Style:**
- Line length: 88 characters
- Use type hints where practical
- Follow PEP 8 naming conventions
- Write docstrings for public functions

### Frontend (React/TypeScript)

**Linting and Formatting:**

```bash
# Inside frontend container or locally
yarn lint:error        # Check for errors
yarn lint:warning:fix  # Fix linting issues
```

**Code Style:**
- Line length: 120 characters
- Use Prettier for formatting (configured in `prettier.config.cjs`)
- Prefer TypeScript types over interfaces (project convention)
- Use functional components with hooks
- Follow the slice pattern for Redux state management

### Pull Request Checklist

Before submitting a PR, ensure:

- [ ] Code follows the project's style guidelines
- [ ] All linting passes without errors
- [ ] New features include tests (if applicable)
- [ ] Documentation is updated (if needed)
- [ ] Commit messages are clear and descriptive
- [ ] The PR addresses a single concern/feature

---

## Logging

`ownphotos.log` is what users attach to a bug report, so it is a shared resource: everything you log competes for space with the line that would have explained someone else's crash.

### Getting a logger

```python
import logging

logger = logging.getLogger(__name__)
```

Use this in new code and in code you are already touching. `from api.util import logger` still works and is what most modules do today; it is not deprecated. The module-scoped logger just tells you where a line came from and lets one noisy module be silenced on its own.

### Levels

The rule a reviewer actually applies: **`INFO` volume must be O(number of jobs/requests), never O(number of photos).** Per-photo, per-file and per-request detail is `DEBUG`.

| Level | Use it for |
| --- | --- |
| `DEBUG` | The per-item detail: this file, this photo, this request. Off by default, so this is the one level where volume may scale with the library. |
| `INFO` | A job or request started, finished, or took a decision an admin would want to see afterwards. One line per job, not per item. |
| `WARNING` | Something was skipped, retried or fell back, and the work carried on. A single unreadable photo is a `WARNING`. |
| `ERROR` | The job or request failed and the user will notice. |
| `CRITICAL` | The process cannot run at all - an unwritable log directory, an unreachable database. Rare. |

`logger.exception()` (an `ERROR` plus the traceback) belongs where the job actually died. One failed item inside a loop that keeps going is a `WARNING` - otherwise a folder of corrupt files produces a traceback per photo and buries the real failure.

### Writing the line

- **Lazy `%` args, never f-strings.** The arguments are only formatted if the line is actually written, so a `DEBUG` call costs nothing when `LOG_LEVEL` is `INFO`. Ruff's `G` rules are on and already reject `.format()`, `+` concatenation and `exc_info=True`; the f-string rule `G004` is the one exception, muted in `pyproject.toml` because ~257 call sites predate it and get converted area by area. Do not add new ones.

  ```python
  logger.info("job %s: scan finished, %s photos added", job_id, count)   # yes
  logger.info(f"job {job_id}: scan finished, {count} photos added")      # no
  ```

- **Always carry the identifier** somebody would need to follow the line: the job id, the `image_hash`, the user id. `api/api_util.py:88` and the `"job %s: ..."` lines in `api/autoalbum.py` are the shape to copy.

- **No personal data above `DEBUG`.** Usernames, absolute media paths, captions, LLM prompts, addresses and search terms do not belong at `INFO` or above - log the user id and the `image_hash` instead. Plenty of existing code predates this rule; do not add more.

Set `LOG_LEVEL=DEBUG` on the backend container to see the verbose stream.

---

## How to Open a Pull Request

### Step 1: Fork the Repository

1. Navigate to the repository you want to contribute to on GitHub
2. Click the "Fork" button in the top right corner
3. Clone your fork locally:

```bash
git clone https://github.com/YOUR-USERNAME/librephotos.git
cd librephotos
git remote add upstream https://github.com/LibrePhotos/librephotos.git
```

### Step 2: Create a Feature Branch

Always create a new branch for your work:

```bash
git checkout -b feature/my-awesome-feature
# or
git checkout -b fix/bug-description
```

### Step 3: Make Your Changes

1. Write your code following the code quality standards above
2. Test your changes thoroughly
3. Commit your changes with descriptive messages:

```bash
git add .
git commit -m "feat: add support for XYZ"
# or
git commit -m "fix: resolve issue with ABC"
```

**Commit Message Guidelines:**
- Use present tense ("add feature" not "added feature")
- Keep the first line under 72 characters
- Reference issues when applicable: `fix: resolve login bug (#123)`

### Step 4: Push and Create Pull Request

```bash
git push origin feature/my-awesome-feature
```

Then on GitHub:
1. Navigate to your fork
2. Click "Compare & pull request"
3. Fill out the PR template with:
   - Clear description of changes
   - Reference to related issues
   - Screenshots (for UI changes)
   - Testing instructions

### Step 5: Respond to Review

- Address reviewer feedback promptly
- Make requested changes in new commits
- Be open to suggestions and discussion

---

## Getting Help

- **Discord:** [Join our Discord server](https://discord.gg/xwRvtSDGWb)
- **GitHub Issues:** [Report bugs or request features](https://github.com/LibrePhotos/librephotos/issues)
- **Documentation:** [docs.librephotos.com](https://docs.librephotos.com)
- **Development Videos:** [Niaz Faridani-Rad's YouTube channel](https://www.youtube.com/channel/UCZJ2pk2BPKxwbuCV9LWDR0w)

### Debugging Tips

**Backend (Django):**

Use `pdb` for debugging:

```python
import pdb; pdb.set_trace()
```

Then attach to the container:

```bash
docker attach $(docker ps --filter name=backend -q)
```

Press `Ctrl+P` followed by `Ctrl+Q` to detach without stopping the container.

**Frontend (React):**

- Use React DevTools browser extension
- Use Redux DevTools for state debugging
- Enable [WDYR](https://github.com/welldone-software/why-did-you-render), which logs why each
  component re-rendered, by setting `VITE_APP_WDYR=true` in `deploy/compose/.env` and restarting
  the frontend container. The value must be the lowercase string `true`.

**API Documentation:**

After starting LibrePhotos, access the API docs at:
- Swagger: http://localhost:3000/api/swagger
- ReDoc: http://localhost:3000/api/redoc

---

## License

By contributing to LibrePhotos, you agree that your contributions will be licensed under the MIT License.

Thank you for contributing! 🎉

