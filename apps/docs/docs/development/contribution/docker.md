---
title: "🐋 Docker"
description: "Contributing to LibrePhotos Docker infrastructure."
sidebar_position: 4
last_modified_at: 2024-12-14
---

## Overview

The `deploy/` directory in the monorepo contains the Docker configuration for running LibrePhotos. This includes:

- `deploy/compose/docker-compose.yml` - Base configuration (published images), used in both dev and prod
- `deploy/compose/docker-compose.dev.yml` - Development overrides (builds from local source, hot reload)
- `deploy/compose/docker-compose.e2e.yml` - End-to-end test stack (builds from local source)
- `deploy/docker/backend/` - Backend Dockerfile (app layer) and entrypoint
- `deploy/docker/backend/base/` - Backend base image Dockerfile (system dependencies), published separately
- `deploy/docker/backend-gpu/` and `deploy/docker/backend-gpu/base/` - CUDA (GPU) equivalents of the backend and its base
- `deploy/docker/frontend/` - Frontend Dockerfiles (production and development)
- `deploy/docker/proxy/` - Nginx reverse proxy configuration
- `deploy/docker/unified/` - Single-container image ([Single Container Deployment](../../installation/unified-deployment.md)) with its own standalone Dockerfile and compose file

## ✨ Code Standards

When modifying Docker files, please ensure:

1. **Cross-platform compatibility**: Test on both Linux and macOS/Windows (WSL2)
2. **ARM64 support**: Images should build on both AMD64 and ARM64 (Apple Silicon, Raspberry Pi). The GPU images (`deploy/docker/backend-gpu/`) are the exception — they are AMD64-only by design, because the CUDA base has no ARM64 build. CI opts them out with `amd64-only: true` (see `.github/workflows/_build-image.yml`)
3. **Layer optimization**: Order commands to maximize Docker layer caching
4. **Security**: Don't run services as root when avoidable; use minimal base images

## Architecture

### Container Relationships

```
                    ┌─────────────┐
                    │   proxy     │ :80
                    │   (nginx)   │  also serves /data, /protected_media,
                    └──────┬──────┘  /original from its own bind mounts
                           │
                ┌──────────┴──────────┐
          ┌─────▼─────┐         ┌─────▼─────┐
          │ frontend  │         │  backend  │
          │  (React)  │         │ (Django)  │
          └───────────┘         └─────┬─────┘
                                      │
                                ┌─────▼─────┐
                                │    db     │
                                │(Postgres) │
                                └───────────┘
```

### Development vs Production

| File | Purpose |
|------|---------|
| `docker-compose.yml` | Base configuration, used in both dev and prod |
| `docker-compose.dev.yml` | Development overrides (hot reload, mounted source, pgadmin on `:3001`) |

## Making Changes

### Modifying the Backend Dockerfile

The backend Dockerfile (`deploy/docker/backend/Dockerfile`) builds the Django application:

```bash
cd librephotos/deploy/compose

# Test your changes
docker compose -f docker-compose.yml -f docker-compose.dev.yml build backend
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d backend

# Check logs for errors
docker compose logs -f backend
```

### Modifying the Backend Base Image

The backend image is built in two tiers. `deploy/docker/backend/Dockerfile` starts `FROM reallibrephotos/librephotos-base:dev`, then only copies `apps/backend/` and pip-installs `requirements.txt`. All system-level dependencies — ffmpeg, libvips, ImageMagick, LibRaw, ExifTool, CPU PyTorch — live in the separate `deploy/docker/backend/base/Dockerfile`.

The base is **pulled, not built**: `docker compose build backend`, even with `--no-cache`, will not rebuild it. To test a change to the base locally, build and tag it yourself first, then rebuild the backend:

```bash
# from the monorepo root
docker build -t reallibrephotos/librephotos-base:dev deploy/docker/backend/base

# then rebuild the app layer (from deploy/compose/)
docker compose -f docker-compose.yml -f docker-compose.dev.yml build backend
```

The base image is published to Docker Hub by `.github/workflows/image-backend-base.yml`, which runs only on pushes to `dev` that touch `deploy/docker/backend/base/**`. The GPU build has the same split — `deploy/docker/backend-gpu/base/Dockerfile` produces `reallibrephotos/librephotos-base-gpu:dev` — and the unified image (`deploy/docker/unified/`) also builds `FROM` the CPU base, so a base change affects it too.

### Modifying the Frontend Dockerfile

The frontend has two Dockerfiles:

- `deploy/docker/frontend/Dockerfile` - Production build (multi-stage: `node:20-slim` builds `dist/`, then `halverneus/static-file-server` serves it on port 3000 behind the nginx proxy)
- `deploy/docker/frontend/Dockerfile.dev` - Development build (hot reload)

### Modifying the Proxy (Nginx)

The proxy configuration is in `deploy/docker/proxy/nginx.conf`. After changes:

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml build proxy
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d proxy
```

## Environment Variables

Environment variables are loaded from the `.env` file. Key variables for Docker:

| Variable | Purpose | Default |
|----------|---------|---------|
| `tag` | Docker image tag to use | `latest` |
| `httpPort` | Host port for the application | `3000` |
| `scanDirectory` | Path to photo library | - |
| `data` | Path to persistent data | - |

The dev overlay bind-mounts `apps/backend` and `apps/frontend` by path relative to `deploy/compose/`, so there is no environment variable for the source-code location.

## Testing Changes

Before submitting a PR, from `deploy/compose/`. Include the dev overlay on every command — the base `docker-compose.yml` uses published images and defines no `build:` sections, so `docker compose build` on its own rebuilds nothing and starts the images pulled from Docker Hub instead of your change:

1. **Clean build**: `docker compose -f docker-compose.yml -f docker-compose.dev.yml build --no-cache` (this does not refresh the base image — see [Modifying the Backend Base Image](#modifying-the-backend-base-image))
2. **Fresh start**: `docker compose -f docker-compose.yml -f docker-compose.dev.yml down -v && docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d`
3. **Check all services**: `docker compose -f docker-compose.yml -f docker-compose.dev.yml ps` (all should be "healthy" or "running")
4. **Test basic functionality**: Upload a photo, trigger a scan, verify it works

:::note
On a fresh stack, uploads are **off** by default: `librephotos.env` ships without an `allowUpload` entry, so `docker-compose.yml` passes `ALLOW_UPLOAD=false` and the upload button is hidden in the UI entirely. Enable it by adding `allowUpload=true` to your `.env` before the first start, or by turning on **Allow uploads** under the app's Admin → Site Settings.
:::

## GPU Support

The `deploy/docker/backend-gpu/` directory contains the GPU-enabled Dockerfile for NVIDIA CUDA support. There is no compose overlay for GPU — the image is built and published separately as `reallibrephotos/librephotos-gpu` by `.github/workflows/image-backend-gpu.yml`.

To build it locally, run from the **monorepo root** (the Dockerfile's build context is the repo root, not `deploy/compose/`):

```bash
docker build -f deploy/docker/backend-gpu/Dockerfile \
  --build-arg IMAGE_TAG=dev \
  -t reallibrephotos/librephotos-gpu:dev .
```

This pulls `reallibrephotos/librephotos-base-gpu:dev` as its base rather than building it.

:::note
The GPU images are built for `linux/amd64` only; ARM is not supported. Do not spend effort making these Dockerfiles ARM64-compatible.
:::

To run it, point the `backend` service in `deploy/compose/docker-compose.yml` at the GPU image and add a device reservation — see [Utilizing GPU Acceleration](../../installation/environment-variables.md#utilizing-gpu-acceleration).

Ensure you have:
- NVIDIA drivers installed
- nvidia-container-toolkit configured
- Docker configured to use the nvidia runtime

## Common Issues

### Image Size

Keep images small by:
- Using multi-stage builds
- Cleaning apt/pip caches in the same layer
- Using `.dockerignore` to exclude unnecessary files

### Build Performance

- Order Dockerfile commands from least to most frequently changed
- Copy dependency files before source code for better caching
- Use `--parallel` flag for multi-service builds

### Volume Permissions

If you encounter permission issues with mounted volumes on Linux:

```bash
# Check the UID/GID of files in the container
docker exec -it backend ls -la /data

# You may need to adjust ownership
sudo chown -R $(id -u):$(id -g) ./librephotos/data
```
