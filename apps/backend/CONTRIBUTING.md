# Contributing to LibrePhotos

Thank you for your interest in contributing to LibrePhotos! This guide will help you get started with the development process.

## Table of Contents

- [Development Environment Setup](#development-environment-setup)
- [Docker & Docker Compose](#docker--docker-compose)
- [IDE Recommendations](#ide-recommendations)
- [Code Quality Standards](#code-quality-standards)
- [How to Open a Pull Request](#how-to-open-a-pull-request)
- [Getting Help](#getting-help)

---

## Development Environment Setup

### Prerequisites

- **Git** - for version control
- **Docker** and **Docker Compose** - for running the development environment
- **Node.js 18+** and **Yarn** - for frontend development (optional, if developing outside Docker)
- **Python 3.11+** - for backend development (optional, if developing outside Docker)

### Step 1: Clone the Repositories

Create a directory for the project and clone all required repositories:

**Linux/macOS:**
```bash
export codedir=~/dev/librephotos
mkdir -p $codedir
cd $codedir

git clone https://github.com/LibrePhotos/librephotos-frontend.git
git clone https://github.com/LibrePhotos/librephotos.git
git clone https://github.com/LibrePhotos/librephotos-docker.git
```

**Windows (PowerShell):**
```powershell
$Env:codedir = "$HOME\dev\librephotos"
New-Item -ItemType Directory -Force -Path $Env:codedir
Set-Location $Env:codedir

git clone https://github.com/LibrePhotos/librephotos-frontend.git
git clone https://github.com/LibrePhotos/librephotos.git
git clone https://github.com/LibrePhotos/librephotos-docker.git
```

### Step 2: Configure Environment

Navigate to the `librephotos-docker` directory and create your `.env` file:

```bash
cd librephotos-docker
cp librephotos.env .env
```

Edit the `.env` file and set these critical variables:

```bash
# Path to your photo library (for testing)
scanDirectory=/path/to/your/test/photos

# Path to LibrePhotos data
data=./librephotos/data

# IMPORTANT: Path where you cloned the repositories
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

The repository includes VS Code settings in `librephotos-docker/vscode/settings.json` that are automatically mounted into the backend container.

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

We use `ruff` for linting and formatting (configured in `pyproject.toml`):

```bash
# Inside the backend container
cd /code
pip install ruff
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
- Enable WDYR by setting `WDYR=True` in your `.env`

**API Documentation:**

After starting LibrePhotos, access the API docs at:
- Swagger: http://localhost:3000/api/swagger
- ReDoc: http://localhost:3000/api/redoc

---

## License

By contributing to LibrePhotos, you agree that your contributions will be licensed under the MIT License.

Thank you for contributing! 🎉

