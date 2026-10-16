---
title: "🚀 Single Container Deployment"
description: "Simplified single-container deployment with internal or external database"
sidebar_position: 1
---

## Overview

Single container deployment serves both the LibrePhotos API and frontend from one unified container. Choose between internal database (SQLite) or external PostgreSQL.

## 🐋 Option 1: All-in-One (SQLite Database)

**Best for: Simple home servers, quick testing, first-time users**

### Quick Start

1. **Create directories for data**
   ```bash
   mkdir -p /home/yourusername/librephotos/{db,protected_media,logs}
   ```

2. **Start LibrePhotos**
   ```bash
   sudo docker run -d \
     --name librephotos \
     --restart unless-stopped \
     -p 3000:8001 \
     -v /home/yourusername/librephotos/db:/db \
     -v /home/yourusername/librephotos/protected_media:/protected_media \
     -v /home/yourusername/librephotos/logs:/logs \
     -v /path/to/your/photos:/data \
     -e SERVE_FRONTEND=true \
     -e DB_BACKEND=sqlite \
     reallibrephotos/librephotos-unified:latest
   ```

3. **Access**: [http://localhost:3000](http://localhost:3000)


**Notes:**
- **Secret key**: Optional - if not provided, one will be generated and saved to `/protected_media/secret.key` (`/logs/secret.key` in 1.3.0 and older; a newer release moves it on its first start). Do not delete this file (see [Internal files](../user-guide/internal-files.md)). To supply your own, pass `-e SECRET_KEY=...`
- **Database**: SQLite file will be created automatically in the `/db` directory. Before an update migrates it, the container copies it into `/db/backups` and keeps the newest three (not released yet; see [Automatic backups](upgrading.md#sqlite-backups))
- **Updates**: while the container updates the database, the page says "LibrePhotos is updating" and opens LibrePhotos by itself when it is done; a failed update stays on a page that says why instead of restarting the container (not released yet; see ["LibrePhotos is updating"](upgrading.md#updating-screen))
- **Photos**: You can mount your photo directory read-only (`-v /path/to/photos:/data:ro`), but this disables uploading, deleting photos, and writing metadata back to files — uploads are otherwise written to an `uploads/` folder inside `/data`. Uploads are on by default, so if you use `:ro`, also pass `-e ALLOW_UPLOAD=false` (or turn off "Allow Upload" in the setup wizard). See [Why is the scan directory not mounted read-only?](../user-guide/faq.md#why-is-the-scan-directory-not-mounted-read-only)

## 🗄️ Option 2: External PostgreSQL Database

**Best for: Cloud deployments, existing PostgreSQL, production setups**

### 1. PostgreSQL Setup

**Existing PostgreSQL:**

Create the database and a user that owns it. On first start the container runs `manage.py migrate` as this user, so it must be able to create tables — and since PostgreSQL 15, `GRANT ALL PRIVILEGES ON DATABASE` no longer conveys that. Make the app user the database owner instead:

```sql
CREATE USER librephotos_user WITH PASSWORD 'your_secure_password';
CREATE DATABASE librephotos OWNER librephotos_user;
```

If the database already exists, run `ALTER DATABASE librephotos OWNER TO librephotos_user;`. For a database carried over from PostgreSQL 14 or earlier, also connect to it (`\c librephotos`) and run `GRANT ALL ON SCHEMA public TO librephotos_user;`.

**New PostgreSQL container:**

Create a shared network first so the database and LibrePhotos containers can reach each other by name, then start PostgreSQL on it (creating the database through `POSTGRES_USER`/`POSTGRES_DB` makes `librephotos_user` its owner, so no extra grants are needed):

```bash
sudo docker network create librephotos-net

sudo docker run -d \
  --name librephotos-db \
  --network librephotos-net \
  --restart unless-stopped \
  -e POSTGRES_DB=librephotos \
  -e POSTGRES_USER=librephotos_user \
  -e POSTGRES_PASSWORD=your_secure_password \
  -v /home/yourusername/postgres_data:/var/lib/postgresql \
  postgres:18
```

PostgreSQL 18 is the major the Compose setup runs. From 18 on, the image keeps its data under `/var/lib/postgresql`, not `/var/lib/postgresql/data`. If you started the database with an older version of this page (`postgres:17`, mounted at `/var/lib/postgresql/data`), recreate that container with its old tag and mount: the official image does not upgrade an existing data directory, and pointing `postgres:18` at it starts an empty database.

### 2. LibrePhotos Container

```bash
sudo docker run -d \
  --name librephotos \
  --network librephotos-net \
  --restart unless-stopped \
  -p 3000:8001 \
  -v /home/yourusername/librephotos/protected_media:/protected_media \
  -v /home/yourusername/librephotos/logs:/logs \
  -v /path/to/your/photos:/data \
  -e SERVE_FRONTEND=true \
  -e DB_BACKEND=postgresql \
  -e DB_NAME=librephotos \
  -e DB_USER=librephotos_user \
  -e DB_PASS=your_secure_password \
  -e DB_HOST=librephotos-db \
  -e DB_PORT=5432 \
  reallibrephotos/librephotos-unified:latest
```

Set `DB_HOST` to match your database:

- **Sibling `librephotos-db` container**: keep `--network librephotos-net` and use `-e DB_HOST=librephotos-db` (the container name), as shown above. `DB_HOST=localhost` will not work — inside the container it points back at LibrePhotos itself, not the database.
- **Existing PostgreSQL server**: drop `--network librephotos-net` and set `-e DB_HOST=<hostname or IP of that server>`. If it runs on the Docker host itself, add `--add-host=host.docker.internal:host-gateway` and use `-e DB_HOST=host.docker.internal`, and make sure PostgreSQL listens on all interfaces with a matching `pg_hba.conf` entry.

## Behind a reverse proxy

If you put this container behind an HTTPS reverse proxy (Traefik, Caddy, a cloud load balancer), add `-e CSRF_TRUSTED_ORIGINS=https://photos.example.com` (comma-separated for several origins; each must include the scheme and match the browser-visible address exactly). The unified image starts with an empty trusted-origin list, so without it the Django admin at `/api/django-admin/` rejects logins with a CSRF error. The photo app itself is unaffected — it authenticates with JWT and its API endpoints are CSRF-exempt.

Also add `-e NUM_PROXIES=1`, so the sign-in rate limits count each client by the address your proxy passes on instead of counting everyone as the proxy (see [Sign-in rate limits](environment-variables.md#sign-in-rate-limits)).

## Next Steps

Once LibrePhotos is running, you'll be guided through a **First Time Setup Wizard** that will help you:

1. Create your admin account
2. Configure site settings (uploads, user registration)
3. Set up your photo scan directory

For more details, see the [first steps guide](../user-guide/first-steps.md). 