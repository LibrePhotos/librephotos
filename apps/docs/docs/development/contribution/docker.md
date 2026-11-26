---
title: "Docker"
description: "Contributing to LibrePhotos Docker infrastructure."
sidebar_position: 4
last_modified_at: 2024-12-14
---

## Overview

The `deploy/` directory in the monorepo contains the Docker configuration for running LibrePhotos. This includes:

- `deploy/compose/docker-compose.yml` - Base configuration (published images), used in both dev and prod
- `deploy/compose/docker-compose.dev.yml` - Development overrides (builds from local source, hot reload)
- `deploy/compose/docker-compose.unified.yml` - Single-container image with PostgreSQL; reads the same `librephotos.env` as `docker-compose.yml`, and `api/tests/infra/test_compose_files_in_sync.py` keeps the backend environment of the two files equal
- `deploy/compose/docker-compose.e2e.yml` - End-to-end test stack (builds from local source)
- `deploy/docker/backend/` - Backend Dockerfile (app layer) and `entrypoint.sh`, the one entrypoint of the backend and unified images. Image differences are guarded blocks in it (`SERVE_FRONTEND` for unified) or `ENV` defaults in a Dockerfile; `api/tests/infra/test_deploy_images.py` fails on a second copy
- `deploy/docker/backend/base/` - Backend base image Dockerfile (Wolfi with Python, perl, the Vulkan loader and Mesa's Vulkan drivers for the GPU), published separately
- `deploy/docker/frontend/` - Frontend Dockerfiles (production and development)
- `deploy/docker/proxy/` - Nginx reverse proxy configuration
- `deploy/docker/unified/` - Single-container image ([Single Container Deployment](../../installation/unified-deployment.md)) with its own standalone Dockerfile; build it locally from the repo root with `docker build -f deploy/docker/unified/Dockerfile .`

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

The backend image is built in two tiers. `deploy/docker/backend/Dockerfile` starts `FROM reallibrephotos/librephotos-base:${BASE_TAG}` (`BASE_TAG` defaults to `dev`), then pip-installs `requirements.txt` and copies in `apps/backend/`. The requirements files are copied and installed before the source, so a change that only touches Python code reuses the cached dependency layers. The only system-level dependencies are Python and perl (for the ExifTool wheel), in the separate `deploy/docker/backend/base/Dockerfile`; libvips, LibRaw, ExifTool, ffmpeg, libpq and OpenCV come from pip as prebuilt wheels (the ones PyPI lacks are built by `.github/workflows/prebuilt-wheels.yml`, and ffmpeg by `.github/workflows/ffmpeg-wheel.yml`, see [The ffmpeg build](backend/ffmpeg-build.md)). There is no PyTorch: the ML models run on ONNX Runtime, which is a plain pip package in `requirements.txt`.

<Since version="1.7.0" /> The base is [Wolfi](https://github.com/wolfi-dev) (`cgr.dev/chainguard/wolfi-base`), a glibc distribution that rebuilds its packages as soon as a fix is out, so the manylinux wheels from PyPI run on it unchanged. Up to 1.6.0 it was Ubuntu 26.04, which left about 90 known vulnerabilities without a fix in every image (Python 3.14, perl, OpenSSL, SQLite and others). The goal is that [Trivy](https://trivy.dev) finds no known vulnerability in `librephotos-base`, `librephotos` and `librephotos-unified`, fixed or not:

```bash
docker build -t reallibrephotos/librephotos-base:dev deploy/docker/backend/base
trivy image --scanners vuln reallibrephotos/librephotos-base:dev
```

What the base Dockerfile installs:

- `bash`, `python-3.14` and `py3.14-pip`, with `python` linked to `python3` in `/usr/local/bin`. pip comes from the Wolfi package, it is not upgraded with pip.
- `perl` for the ExifTool wheel, and `IO::Compress::Brotli` (version and SHA-256 pinned in the Dockerfile), built from CPAN in a separate stage because Wolfi has no package for it. ExifTool needs it to read the Brotli-compressed `brob` metadata boxes of JPEG XL files.
- `vulkan-loader-libs` (`libvulkan.so.1`) and `mesa`, which brings the AMD (RADV) and software (lavapipe) Vulkan drivers, and `spirv-tools`, which the drivers of the next item link.
- Mesa's Vulkan drivers that Wolfi's `mesa` leaves out: Intel (`intel` for Gen9 and newer, `intel_hasvk` for Haswell and Broadwell), `virtio` (Venus, for virtual machines) and `asahi` (Apple silicon under Asahi Linux). The `mesa-vulkan` build stage compiles just these from the Mesa release in `MESA_VERSION`, with SPIRV-LLVM-Translator (`SPIRV_LLVM_TRANSLATOR_VERSION`, which has to match the major version of the `llvm-23` packages of that stage) as a build-time tool; both are pinned by version and SHA-256. Trivy does not see the files this stage installs, so bump `MESA_VERSION` when Mesa ships a fix; Renovate opens those pull requests (see [What the image scan cannot see](../vulnerability-scanning.md#what-the-image-scan-cannot-see)). Ubuntu's `mesa-vulkan-drivers` also had `nouveau` (NVK) and `gfxstream`; the images no longer include them. NVK needs a Rust toolchain with bindgen to build, and with NVIDIA's own driver the GPU is reached through the NVIDIA Container Toolkit as before.

The `FROM` lines pin `wolfi-base:latest` by digest; Renovate opens the digest updates. The packages themselves are the current Wolfi ones at build time, the same way `apt-get` worked before. To add a system package in an image of your own built on these, use `apk add --no-cache <package>` instead of `apt-get install`; the names are Wolfi's (for example `openjdk-25-jre`, which the `MLVALIDATION` build installs). The images still run as root, keep `/bin/sh` (BusyBox) next to `bash`, and keep the same ports, environment and entrypoint.

The base is **pulled, not built**: `docker compose build backend`, even with `--no-cache`, will not rebuild it. To test a change to the base locally, build and tag it yourself first, then rebuild the backend:

```bash
# from the monorepo root
docker build -t reallibrephotos/librephotos-base:dev deploy/docker/backend/base

# then rebuild the app layer (from deploy/compose/)
docker compose -f docker-compose.yml -f docker-compose.dev.yml build backend
```

The base image is published to Docker Hub by `.github/workflows/image-backend-base.yml`, which runs on pushes to `dev` that touch `deploy/docker/backend/base/**`, and by hand (**Run workflow** on `dev`) to take newer Wolfi packages. A pull request that touches the base or the backend requirements runs `.github/workflows/image-backend-check.yml`, which builds the base and the backend image on amd64 and arm64 without pushing, checks that every Vulkan driver in the base resolves all its libraries and that every ICD file names an existing driver, and scans both images with Trivy.

Compiling Mesa takes about an hour per architecture on a GitHub runner, so both workflows keep the BuildKit cache of every stage in the GitHub Actions cache (`type=gha`, `mode=max`, scopes `librephotos-base-amd64` and `librephotos-base-arm64`). A pull request reads the cache `dev` wrote, so a requirements bump reuses the `mesa-vulkan` and `perl-brotli` stages and only rebuilds them when one of their `ARG`s or the `wolfi-base` digest changes. The final stage is named `runtime` and is never taken from the cache (`no-cache-filters`), so every build installs the current Wolfi packages. `image-backend-check` allows 120 minutes for a build without a cache. The unified image (`deploy/docker/unified/`) also builds `FROM` this base, so a base change affects it too. A release does not rebuild the base: it promotes the current `:dev` to `:<release-tag>`, and the release builds of the backend and unified images pass `BASE_TAG=<release-tag>`, so a published release keeps the base it shipped with.

### Modifying the Frontend Dockerfile

The frontend has two Dockerfiles:

- `deploy/docker/frontend/Dockerfile` - Production build (multi-stage: `node:24-slim` builds `dist/`, `golang` builds [static-file-server](https://github.com/halverneus/static-file-server) from source, and the `scratch` image serves `dist/` with it on port 3000 behind the nginx proxy; see [Vulnerability scanning](../vulnerability-scanning.md#the-frontend-and-proxy-images))
- `deploy/docker/frontend/Dockerfile.dev` - Development build (hot reload)

### Modifying the Proxy (Nginx)

The proxy configuration is in `deploy/docker/proxy/nginx.conf`, run by `nginx:1.30-alpine-slim` (Alpine, no `curl`, no dynamic modules; see [Vulnerability scanning](../vulnerability-scanning.md#the-frontend-and-proxy-images)). After changes:

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

The dev overlay bind-mounts `apps/backend`, `apps/frontend` and `packages` (the frontend compiles the shared `packages/api-client` from source) by path relative to `deploy/compose/`, so there is no environment variable for the source-code location.

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

<Since version="1.5.0" /> There is no separate GPU image. The backend and unified images ship ONNX Runtime's WebGPU plugin (`onnxruntime-ep-webgpu` in `apps/backend/requirements.txt`), and their base image installs the Vulkan loader and Mesa's Vulkan drivers for Intel, AMD and the CPU (lavapipe). `apps/backend/service/onnx_session.py` puts every model on the GPU when the plugin finds one, and on the CPU otherwise. To try a GPU, give the `backend` service `/dev/dri` (Intel, AMD) or an NVIDIA device reservation with `NVIDIA_DRIVER_CAPABILITIES=compute,utility,graphics`, as [Utilizing GPU Acceleration](../../installation/environment-variables.md#utilizing-gpu-acceleration) shows. The base image change only reaches a local build after you rebuild the base (see [Modifying the Backend Base Image](#modifying-the-backend-base-image)).

Up to 1.4.0, `deploy/docker/backend-gpu/` built a separate NVIDIA-only image, `reallibrephotos/librephotos-gpu`, on CUDA 12.1.1 and Ubuntu 22.04 (Python 3.10). It is gone, and so is the Python 3.10 floor it set.

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
