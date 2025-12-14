---
title: "🐋 Docker"
excerpt: "Contributing to LibrePhotos Docker infrastructure."
last_modified_at: 2024-12-14
category: 5
---

## Overview

The `librephotos-docker` repository contains the Docker configuration for running LibrePhotos. This includes:

- `docker-compose.yml` - Production configuration
- `docker-compose.dev.yml` - Development overrides
- `backend/` - Backend Dockerfile and entrypoint
- `frontend/` - Frontend Dockerfile and development config
- `proxy/` - Nginx reverse proxy configuration

## ✨ Code Standards

When modifying Docker files, please ensure:

1. **Cross-platform compatibility**: Test on both Linux and macOS/Windows (WSL2)
2. **ARM64 support**: Images should build on both AMD64 and ARM64 (Apple Silicon, Raspberry Pi)
3. **Layer optimization**: Order commands to maximize Docker layer caching
4. **Security**: Don't run services as root when avoidable; use minimal base images

## Architecture

### Container Relationships

```
                    ┌─────────────┐
                    │   proxy     │ :80
                    │   (nginx)   │
                    └──────┬──────┘
                           │
            ┌──────────────┼──────────────┐
            │              │              │
      ┌─────▼─────┐  ┌─────▼─────┐  ┌─────▼─────┐
      │ frontend  │  │  backend  │  │  static   │
      │  (React)  │  │ (Django)  │  │  files    │
      └───────────┘  └─────┬─────┘  └───────────┘
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
| `docker-compose.dev.yml` | Development overrides (hot reload, mounted source, debug tools) |

## Making Changes

### Modifying the Backend Dockerfile

The backend Dockerfile (`backend/Dockerfile`) builds the Django application:

```bash
cd librephotos-docker

# Test your changes
docker compose -f docker-compose.yml -f docker-compose.dev.yml build backend
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d backend

# Check logs for errors
docker compose logs -f backend
```

### Modifying the Frontend Dockerfile

The frontend has two Dockerfiles:

- `frontend/Dockerfile` - Production build (static files served by nginx)
- `frontend/Dockerfile.dev` - Development build (hot reload)

### Modifying the Proxy (Nginx)

The proxy configuration is in `proxy/nginx.conf`. After changes:

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
| `codedir` | (Dev only) Path to source code | - |
| `scanDirectory` | Path to photo library | - |
| `data` | Path to persistent data | - |

## Testing Changes

Before submitting a PR:

1. **Clean build**: `docker compose build --no-cache`
2. **Fresh start**: `docker compose down -v && docker compose up -d`
3. **Check all services**: `docker compose ps` (all should be "healthy" or "running")
4. **Test basic functionality**: Upload a photo, trigger a scan, verify it works

## GPU Support

The `backend-gpu/` directory contains GPU-enabled Dockerfiles for NVIDIA CUDA support:

```bash
# Build GPU image
docker compose -f docker-compose.yml -f docker-compose.gpu.yml build

# Run with GPU
docker compose -f docker-compose.yml -f docker-compose.gpu.yml up -d
```

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
