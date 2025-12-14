---
title: "👷‍♂️ Development Installation"
excerpt: "How to install LibrePhotos for Developers"
last_modified_at: 2024-12-14
category: 1
---

[![Quality Gate Status](https://sonarcloud.io/api/project_badges/measure?project=LibrePhotos_ownphotos&metric=alert_status)](https://sonarcloud.io/dashboard?id=LibrePhotos_ownphotos) ![Discord](https://img.shields.io/discord/784619049208250388?style=plastic) ![Website](https://img.shields.io/website?down_color=lightgrey&down_message=offline&style=plastic&up_color=blue&up_message=online&url=https%3A%2F%2Flibrephotos.com) ![GitHub contributors](https://img.shields.io/github/contributors/librephotos/librephotos?style=plastic)

## Prerequisites

Before you begin, ensure you have the following installed:

- **Git** - for version control
- **Docker** (v20.10+) and **Docker Compose** (v2.0+)
- **8GB+ RAM** recommended for ML models

:::info

- Use absolute paths (not relative) when configuring `codedir` and `scanDirectory` in your `.env` file
- Docker Compose v2 uses `docker compose` (with a space) instead of `docker-compose` (with a hyphen)

:::

## Quick Start (30 Minutes)

### Step 1: Clone All Repositories

Create a project directory and clone the three required repositories:

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

Navigate to the `librephotos-docker` directory and create your environment file:

```bash
cd librephotos-docker
cp librephotos.env .env
```

Edit the `.env` file with your preferred editor and set these important variables:

```bash
# Path to test photos (create a folder with some sample images)
scanDirectory=/home/youruser/dev/librephotos/test-photos

# Internal data directory
data=./librephotos/data

# CRITICAL: Path where you cloned the repositories
# This must match where you ran the git clone commands
codedir=/home/youruser/dev/librephotos
```

:::warning

The `codedir` variable must be an absolute path and match exactly where you cloned the repositories. Docker will mount the source code from this location.

:::

### Step 3: Start Development Environment

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d
```

The first build will take 10-20 minutes as it:
- Downloads base images
- Installs Python dependencies
- Installs Node.js dependencies
- Downloads ML models

### Step 4: Access LibrePhotos

Once the containers are running, access the application:

- **Application**: http://localhost:3000
- **API Documentation (Swagger)**: http://localhost:3000/api/swagger
- **API Documentation (ReDoc)**: http://localhost:3000/api/redoc
- **pgAdmin (Database UI)**: http://localhost:3001 (user: admin@admin, pass: admin)

Create your admin account through the web interface or via command line:

```bash
docker exec -it backend python manage.py createsuperuser
```

## Development Workflow

### Hot Reload

Both frontend and backend support hot reload:

- **Frontend**: Changes to React/TypeScript files automatically refresh the browser
- **Backend**: Django auto-reloads when Python files change (you may need to refresh the page)

### Viewing Logs

```bash
# All containers
docker compose -f docker-compose.yml -f docker-compose.dev.yml logs -f

# Specific container
docker compose -f docker-compose.yml -f docker-compose.dev.yml logs -f backend
docker compose -f docker-compose.yml -f docker-compose.dev.yml logs -f frontend
```

### Running Commands Inside Containers

**Backend (Django):**
```bash
docker exec -it backend bash

# Now inside the container:
python manage.py migrate
python manage.py shell
python manage.py test api.tests
```

**Frontend (Node.js):**
```bash
docker exec -it frontend sh

# Now inside the container:
yarn lint:error
yarn test
```

### Rebuilding After Dependency Changes

When you modify `requirements.txt` (backend) or `package.json` (frontend):

```bash
# Rebuild the affected container
docker compose -f docker-compose.yml -f docker-compose.dev.yml build --no-cache backend
# or
docker compose -f docker-compose.yml -f docker-compose.dev.yml build --no-cache frontend

# Restart containers
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d
```

### Common Docker Commands

```bash
# Check container status
docker compose ps

# Restart a container
docker compose -f docker-compose.yml -f docker-compose.dev.yml restart backend

# Stop all containers
docker compose -f docker-compose.yml -f docker-compose.dev.yml down

# Stop and remove all data (fresh start)
docker compose -f docker-compose.yml -f docker-compose.dev.yml down -v

# Access container shell
docker exec -it backend bash
docker exec -it frontend sh
docker exec -it db psql -U docker -d librephotos
```

## IDE Setup

### VS Code (Recommended)

VS Code with the Remote Containers extension provides the best experience:

1. Install extensions:
   - Python
   - Pylance
   - Docker
   - Remote - Containers
   - ESLint
   - Prettier

2. Attach to the backend container:
   - Open Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`)
   - Run "Remote-Containers: Attach to Running Container"
   - Select the `backend` container
   - Open the `/code` folder

The repository includes VS Code settings that are automatically mounted.

### PyCharm Professional

1. Go to Settings → Project → Python Interpreter
2. Add Interpreter → On Docker Compose
3. Select both `docker-compose.yml` and `docker-compose.dev.yml`
4. Choose the `backend` service

## Debugging

### Backend (Python/Django)

**Using pdb:**

Add a breakpoint in your Python code:
```python
import pdb; pdb.set_trace()
```

Attach to the container to use the debugger:
```bash
docker attach $(docker ps --filter name=backend -q)
```

When done, press `Ctrl+P` followed by `Ctrl+Q` to detach without stopping the container.

**Using Django Silk:**

In development mode, access `/api/silk` for request profiling and SQL query analysis.

### Frontend (React)

- **React DevTools**: Install the [browser extension](https://chrome.google.com/webstore/detail/react-developer-tools/fmkadmapgofadopljbjfkapdkoienihi)
- **Redux DevTools**: Install the [browser extension](https://chrome.google.com/webstore/detail/redux-devtools/lmhkpmbekcpmknklioeibfkpmmfibljd)
- **WDYR (Why Did You Render)**: Set `WDYR=True` in your `.env` to see component re-render reasons

## Troubleshooting

### Container Won't Start

```bash
# Check logs for errors
docker compose -f docker-compose.yml -f docker-compose.dev.yml logs backend

# Rebuild the container
docker compose -f docker-compose.yml -f docker-compose.dev.yml build --no-cache backend
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d
```

### Database Issues

```bash
# Reset the database
docker compose -f docker-compose.yml -f docker-compose.dev.yml down -v
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d

# Run migrations manually
docker exec -it backend python manage.py migrate
```

### Port Already in Use

If port 3000 is in use, change `httpPort` in your `.env` file:
```bash
httpPort=3001
```

### Source Code Not Updating

Ensure your `codedir` path in `.env` exactly matches where you cloned the repositories. The path must be absolute (starting with `/` on Linux/macOS).

## Next Steps

- Read the [Architecture Overview](./index.md) to understand the system design
- Check [Contribution Guidelines](./contribution/index.md) to learn about pull requests
- Take a look at [First Steps](../user-guide/first-steps.md) to set up your first scan
