---
title: "Development"
description: "Set up a LibrePhotos development environment and contribute to the backend, frontend, and mobile apps."
sidebar_position: 4
---

## Architecture

Currently the standard setup is split up into four different containers. In this document the general architecture and reason for the components will be explained.

LibrePhotos also ships a single-container image (`reallibrephotos/librephotos-unified`, built from `deploy/docker/unified/`), which is the deployment the installation docs recommend for most users. In that mode there is no NGINX proxy and no separate frontend container: the frontend build is collected into Django's static files and served by WhiteNoise from Gunicorn on port 8001 (`SERVE_FRONTEND=true`), and the database defaults to SQLite. See [Single Container Deployment](../installation/unified-deployment.md) for the details.

### Backend

The Backend uses Django as a Framework. Everything the generally applies to Django can be applied to LibrePhotos. If there is some feature that is in Django, but not yet in LibrePhotos, then this would be quite easy to add.

In general there are around ten processes running in the backend.

- As a webserver and for the handling of general API calls we use Gunicorn. Scaling works here with the worker count Gunicorn provides, set via the `WEB_CONCURRENCY` env variable.
- For long running jobs we use django_q2 with the ORM broker. The worker pool is sized by the `WORKER_CONCURRENCY` env variable (set as `workerConcurrency` in the compose `.env`, see `deploy/compose/librephotos.env`); left unset, django-q falls back to one worker per CPU core. The "Limiting CPU and memory usage" section of [Advanced docker-compose usage](../installation/environment-variables.md) covers how to tune it.
- On top of those, `manage.py start_service all` (run from the container entrypoint) launches a set of small HTTP sidecar services, each on its own port, and registers a django_q2 schedule (`api.services.check_services`) that health-checks them every minute and restarts any that died. The authoritative list and ports live in the `SERVICES` dict in `apps/backend/api/services.py`; it currently covers image similarity (8002), thumbnails (8003), face recognition (8005), CLIP embeddings (8006), image captioning (8007), the LLM chat service (8008), EXIF extraction (8010) and tag extraction (8011). The LLM service is skipped on CPUs that lack the AVX/SSE4.2 instruction sets it needs, so the exact process count varies.
  - The **image similarity** service uses faiss and powers "similar photos" lookups. It is also the second hop of semantic search: a text query is first sent to the **CLIP embeddings** service (8006) to be turned into an embedding, which is then handed to the image similarity service (8002) to find matching photos.
  - The **thumbnail** service generates thumbnails. It runs as its own process only because PyTorch and ImageMagick do not play nice together in the same one.

### Frontend

Pretty simple container. In production this is just a static webserver with the build frontend project. The dev version installs the right packages with the right node versions to seamlessly work. (The single-container image has no separate frontend container; Django serves the built frontend itself.)

### Proxy

We use a reverse proxy to handle traffic from outside to the frontend and backend. We use NGINX for it. Serving actual images and videos is also done with NGINX, because it is better at it then Django. (The single-container image has no proxy; Django serves everything itself.)

### Database

The split-container setup uses PostgreSQL, which is hardcoded in `apps/backend/librephotos/settings/production.py`. The single-container image supports both backends, selected with the `DB_BACKEND` environment variable - `sqlite` (the default) or `postgresql` - configured in `apps/backend/librephotos/settings/production_noproxy.py`. That module imports `production.py` and overrides only what running without a proxy changes, so settings added to `production.py` reach both deployments. Backend code should therefore stay portable across both engines.
