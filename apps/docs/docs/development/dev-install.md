---
title: "👷‍♂️ Development Installation"
description: "How to install LibrePhotos for Developers"
sidebar_position: 1
last_modified_at: 2024-12-14
---

[![Quality Gate Status](https://sonarcloud.io/api/project_badges/measure?project=LibrePhotos_ownphotos&metric=alert_status)](https://sonarcloud.io/dashboard?id=LibrePhotos_ownphotos) ![Discord](https://img.shields.io/discord/784619049208250388?style=plastic) ![Website](https://img.shields.io/website?down_color=lightgrey&down_message=offline&style=plastic&up_color=blue&up_message=online&url=https%3A%2F%2Flibrephotos.com) ![GitHub contributors](https://img.shields.io/github/contributors/librephotos/librephotos?style=plastic)

## Prerequisites

Before you begin, ensure you have the following installed:

- **Git** - for version control
- **Docker** (v20.10+) and **Docker Compose** (v2.0+)
- **8GB+ RAM** recommended for ML models

:::info

- Use absolute paths (not relative) when configuring `scanDirectory` in your `.env` file
- Docker Compose v2 uses `docker compose` (with a space) instead of `docker-compose` (with a hyphen)

:::

## Quick Start (30 Minutes)

### Step 1: Clone the Monorepo

Create a project directory and clone the LibrePhotos monorepo. All apps (backend, frontend, mobile, docs) and the deploy configs live in a single repository.

**Linux/macOS:**
```bash
export devdir=~/dev
mkdir -p $devdir
cd $devdir

git clone https://github.com/LibrePhotos/librephotos.git
cd librephotos
```

**Windows (PowerShell):**
```powershell
$Env:devdir = "$HOME\dev"
New-Item -ItemType Directory -Force -Path $Env:devdir
Set-Location $Env:devdir

git clone https://github.com/LibrePhotos/librephotos.git
Set-Location librephotos
```

### Step 2: Configure Environment

Navigate to the `deploy/compose` directory and create your environment file:

```bash
cd deploy/compose
cp librephotos.env .env
```

Edit the `.env` file with your preferred editor and set these important variables:

```bash
# Path to test photos (create a folder with some sample images)
scanDirectory=/home/youruser/dev/test-photos

# Internal data directory
data=./librephotos/data
```

### Step 3: Start Development Environment

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d
```

The first startup takes 10-20 minutes:
- The image build downloads the base images and installs the Python dependencies.
- On first start the frontend container runs `yarn install`. It does this on every start, so the first start is the slowest.

ML models are **not** downloaded during this step. They are fetched in the background the first time something needs them — saving ML settings, starting a photo scan, or running face recognition — and total several GB.

### Step 4: Access LibrePhotos

Once the containers are running, access the application:

- **Application**: http://localhost:3000
- **API Documentation (Swagger)**: http://localhost:3000/api/swagger
- **API Documentation (ReDoc)**: http://localhost:3000/api/redoc
- **pgAdmin (Database UI)**: http://localhost:3001 (user: `admin@admin.com`, pass: `admin` — override with `PGADMIN_DEFAULT_EMAIL` / `PGADMIN_DEFAULT_PASSWORD` in your `.env`)

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

# Now inside the container (/code is apps/backend):
python manage.py migrate
python manage.py shell
python manage.py test api.tests
ruff check .      # lint
ruff format .     # format
```

CI runs `ruff check apps/backend` and `ruff format --check apps/backend` on every pull request, so run these before pushing or the required `lint-backend` check will fail.

**Frontend (Node.js):**
```bash
docker exec -it frontend sh

# Now inside the container:
yarn lint:error
yarn test
```

### Rebuilding After Dependency Changes

**Backend (`requirements.txt` / `requirements.dev.txt`)** — Python packages are installed into the image at build time, so rebuild the image and recreate the container:

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml build backend
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d backend
```

A plain `build` already re-runs `pip install`, because copying the changed source invalidates the cache; add `--no-cache` only if you suspect a stale layer.

**Frontend (`package.json`)** — no image rebuild is needed. The dev image contains no `node_modules`; the entrypoint runs `yarn install` into the bind-mounted `apps/frontend` every time the container starts. Just restart it:

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml restart frontend
```

### Common Docker Commands

```bash
# Check container status
docker compose ps

# Restart a container
docker compose -f docker-compose.yml -f docker-compose.dev.yml restart backend

# Stop all containers
docker compose -f docker-compose.yml -f docker-compose.dev.yml down

# Stop containers and remove anonymous volumes. NOTE: your photos and database
# live in host bind mounts (the `data` / `scanDirectory` paths in your .env) and
# are NOT deleted by this — see "Database Issues" below for a real reset.
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
- **WDYR (Why Did You Render)**: Set `VITE_APP_WDYR=true` in `deploy/compose/.env` to log component
  re-render reasons to the browser console. The value must be the lowercase string `true`; anything
  else leaves WDYR off. Recreate the frontend container to pick up the change:

  ```bash
  docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d frontend
  ```

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
# Reset the database. The Postgres data is a host bind mount, not a Docker
# volume, so `down -v` will NOT clear it — you must delete the directory.
docker compose -f docker-compose.yml -f docker-compose.dev.yml down

# Remove the DB directory under your `data` path (default ./librephotos/data,
# relative to deploy/compose/). The files are root-owned, hence sudo.
sudo rm -rf ./librephotos/data/db

docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d

# Run migrations manually
docker exec -it backend python manage.py migrate
```

### Port Already in Use

If port 3000 is in use, change `httpPort` in your `.env` file:
```bash
httpPort=3080
```

Avoid `3001`: in the dev stack that host port is already taken by the pgAdmin service, whose port is fixed and not configurable through `.env`.

### Source Code Not Updating

The dev stack bind-mounts the source into the containers (`../../apps/backend` and `../../apps/frontend`). Compose resolves those relative paths against the location of the compose files you pass to `-f` — not your shell's current directory — so the code that runs is whatever clone contains the `deploy/compose` files you launched. If your edits don't appear, make sure you're editing the same checkout you started the stack from, not a copy of it.

You can check what is actually mounted with:

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml config
```

and reading the resolved `volumes:` source paths (or run `docker inspect backend`).

## Next Steps

- Read the [Architecture Overview](./index.md) to understand the system design
- Check [Contribution Guidelines](./contribution/index.md) to learn about pull requests
- Take a look at [First Steps](../user-guide/first-steps.md) to set up your first scan
